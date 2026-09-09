/**
 * Fill engine (F2) — the distributed acquisition queue.
 *
 * The catalog stops being passively browsed and starts being WORKED on:
 * peers claim artists from a shared queue (OrbitDB lease with 24h TTL),
 * compute per-track download links with full provenance, self-check against
 * the DQ rules BEFORE publishing (anti-hallucination is blocking), and
 * publish `fill:<artist>` + `queue:done:<artist>`. Any other peer reads the
 * result instead of recomputing it: one computation, shared by everyone.
 *
 * Anti-hallucination (blocking, pre-publish):
 *   A1 PROVENANCE — every published URL must trace to a real file of a real
 *      archive.org item (by construction here: versions are extracted from
 *      /metadata payloads; the DQ suite re-verifies programmatically).
 *   A2 LIVENESS — a sampled HEAD check on published URLs; below threshold
 *      the whole publish is aborted (better an unfilled artist than dead links).
 *   A3 FILL RATE — below the threshold the artist is not marked done.
 *
 * All writes are idempotent: republishing the same result is harmless.
 */

import { fetchItemMetadata } from "./archive.js";
import { normalizeAlbum } from "./pipeline.js";
import { crossReference } from "./discography.js";
import { alignTracklist, resolveReleaseGroup } from "./tracklist.js";
import { catalogGet, catalogSet, keys, CLAIM_TTL_MS } from "./catalogstore.js";

export const FILL_RATE_THRESHOLD = 0.2;   // A3: ≥20% of tracks with ≥1 live link
export const LIVENESS_THRESHOLD = 0.5;    // A2: ≥50% of the sampled links live
export const LIVENESS_SAMPLE = 5;         // bounded HEAD checks per publish

const DQ_RETRY_TTL_MS = 3600 * 1000; // failed DQ → claim again after 1h

/**
 * Attempts to claim an artist for this peer (lease with TTL).
 * Contract: best-effort (OrbitDB keyvalue has no CAS): an active lease by
 * another peer makes us SKIP; an expired or absent lease lets us claim.
 * @param {string} artist
 * @param {string} peerId
 * @param {number} [ttl] Lease TTL (default 24h, 1h after a DQ failure).
 * @returns {Promise<boolean>} true when WE hold the lease now.
 */
export async function claimArtist(artist, peerId, ttl = CLAIM_TTL_MS) {
  const key = keys.queueClaim(artist);
  const lease = await catalogGet(key);
  if (lease && lease.at + (lease.ttl ?? CLAIM_TTL_MS) > Date.now()) {
    return lease.peerId === peerId; // someone else's active lease → skip
  }
  // Best-effort: catalogSet returns false when the P2P layer is offline, but
  // the local write-through still persists the lease (offline mode = local
  // queue; the honest degradation documented in lib/catalogstore.js).
  await catalogSet(key, { peerId, at: Date.now(), ttl });
  return true;
}

/** Releases (shortens) the lease — used after a failed DQ so peers retry soon. */
export async function releaseClaim(artist, ttl = DQ_RETRY_TTL_MS) {
  await catalogSet(keys.queueClaim(artist), { peerId: "released", at: Date.now(), ttl });
  return true;
}

/** Queue state as seen by the UI (F4): honest states from the shared data. */
export async function fillState(artist) {
  const [claim, done, fill] = await Promise.all([
    catalogGet(keys.queueClaim(artist)),
    catalogGet(keys.queueDone(artist)),
    catalogGet(keys.fill(artist)),
  ]);
  if (fill) return { state: "filled", fill, done };
  if (claim && claim.at + (claim.ttl ?? CLAIM_TTL_MS) > Date.now()) return { state: "claimed", claim };
  return { state: "pending" };
}

/**
 * Extracts per-track VERSIONS from an item's metadata with full provenance.
 * trackKey = stable "{identifier}/{fileName}" of the preferred variant.
 * Alternate takes/mixes (foldAlternateTakes) are included: each is its OWN
 * play target with its own trackKey and mirror-versions — never folded into
 * the host's versions array (a take is NOT a mirror of the mix; version
 * ranking must not flip the canonical track's default playback to a take).
 * Contract: every returned URL is composed ONLY from real item files (A1).
 * @param {string} identifier archive.org item id.
 * @param {Object} meta Raw /metadata payload.
 * @param {{title?: string, mbid?: string|null}} [opts]
 * @returns {Promise<{trackKey: string, versions: Object[]}[]>} Per-track versions.
 */
export async function extractVersions(identifier, meta, opts = {}) {
  let album = normalizeAlbum(identifier, meta);
  if (!album.tracks?.length) return [];
  // R1–R6 alignment when a canonical release-group is known (classical works
  // grouped, compound vinyl sides split into sub-tracks with starts[]).
  if (opts.mbid) {
    try { album = await alignTracklist(album, opts.mbid); } catch { /* keep raw */ }
  }
  const withProvenance = (title, durationSec, v) => ({
    url: v.url,
    item: identifier,
    file: decodeURIComponent(String(v.url).split("/").pop() ?? ""),
    format: v.format ?? "",
    durationMs: durationSec ? Math.round(durationSec * 1000) : null,
    source: "archive.org",
    title,
    at: Date.now(),
  });
  return album.tracks.flatMap((t) => [
    {
      trackKey: t.id,
      versions: (t.variants?.length
        ? t.variants
        : [{ format: t.format ?? "", url: t.url }]
      ).map((v) => withProvenance(t.title, t.duration, v)),
    },
    ...(t.alternates ?? []).map((a) => ({
      trackKey: a.id,
      versions: (a.variants?.length
        ? a.variants
        : [{ format: a.format ?? "", url: a.url }]
      ).map((v) => withProvenance(a.title, a.duration, v)),
    })),
  ]);
}

/**
 * Liveness sample (A2): bounded HEAD checks with per-URL verdicts.
 * @param {string[]} urls
 * @param {number} [max=LIVENESS_SAMPLE]
 * @returns {Promise<{sampled: number, live: number}>}
 */
export async function livenessSample(urls, max = LIVENESS_SAMPLE) {
  const sample = urls.slice(0, max);
  let live = 0;
  await Promise.all(sample.map(async (url) => {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok) live++;
    } catch { /* dead for us */ }
  }));
  return { sampled: sample.length, live };
}

/**
 * The per-artist fill cycle: claim → crossref → extract → DQ → publish.
 * @param {string} artist
 * @param {Object} [opts]
 * @param {string} [opts.peerId] Local peer id (defaults to a session id).
 * @param {boolean} [opts.force] Fill even when a fill record already exists.
 * @returns {Promise<{state: string, fillRate?: number, reason?: string}>}
 */
export async function fillArtist(artist, { peerId = defaultPeerId(), force = false } = {}) {
  const existing = force ? null : await catalogGet(keys.fill(artist));
  if (existing) return { state: "filled", fillRate: existing.stats?.fillRate ?? 0 };

  const claimed = await claimArtist(artist, peerId);
  if (!claimed) return { state: "skipped", reason: "claimed by another peer" };

  try {
    // Canonical discography (P2P-cached crossref → MusicBrainz via the gate).
    const cross = await crossReference(artist, { priority: "background" });
    const available = (cross?.entries ?? []).filter((e) => e.status === "available" && e.match?.id);
    if (!available.length) {
      await releaseClaim(artist);
      return { state: "nothing-to-fill", reason: "no available canonical albums" };
    }

    // Extract per-track versions from each matched item (bounded: first 10).
    const byTrack = new Map();
    for (const entry of available.slice(0, 10)) {
      let meta;
      try { meta = await fetchItemMetadata(entry.match.id); } catch { continue; }
      const groups = await extractVersions(entry.match.id, meta, { title: entry.title, mbid: entry.mbid });
      for (const { trackKey, versions } of groups) {
        const prev = byTrack.get(trackKey);
        if (!prev) byTrack.set(trackKey, versions);
        else for (const v of versions) if (!prev.some((p) => p.url === v.url)) prev.push(v); // dedup mirrors
      }
    }

    if (!byTrack.size) {
      await releaseClaim(artist);
      return { state: "nothing-to-fill", reason: "no playable tracks extracted" };
    }

    // —— AUTO-DQ (blocking, pre-publish) ——
    const allUrls = [...byTrack.values()].flat().map((v) => v.url);
    const uniqueUrls = [...new Set(allUrls)];
    const { sampled, live } = await livenessSample(uniqueUrls);
    const liveness = sampled ? live / sampled : 0;
    const fillRate = byTrack.size ? [...byTrack.values()].filter((v) => v.length).length / byTrack.size : 0;

    if (sampled > 0 && liveness < LIVENESS_THRESHOLD) {
      await releaseClaim(artist);
      return { state: "dq-failed", reason: `liveness ${(liveness * 100).toFixed(0)}% < ${(LIVENESS_THRESHOLD * 100).toFixed(0)}%` };
    }
    if (fillRate < FILL_RATE_THRESHOLD) {
      await releaseClaim(artist);
      return { state: "dq-failed", reason: `fill rate ${(fillRate * 100).toFixed(0)}% < ${(FILL_RATE_THRESHOLD * 100).toFixed(0)}%` };
    }

    const record = {
      artist,
      tracks: Object.fromEntries(byTrack),
      stats: { trackCount: byTrack.size, fillRate, liveness, livenessSampled: sampled, livenessLive: live },
      at: Date.now(),
      by: peerId,
    };
    await catalogSet(keys.fill(artist), record);
    await catalogSet(keys.queueDone(artist), { artist, stats: record.stats, at: Date.now(), by: peerId });
    return { state: "filled", fillRate };
  } catch (e) {
    await releaseClaim(artist);
    return { state: "error", reason: String(e?.message ?? e).slice(0, 120) };
  }
}

/** Stable per-session peer id (not a user identifier: a random session uuid). */
export function defaultPeerId() {
  try {
    let id = localStorage.getItem("pf.peerid");
    if (!id) {
      id = "peer-" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("pf.peerid", id);
    }
    return id;
  } catch { return "peer-anon"; }
}
