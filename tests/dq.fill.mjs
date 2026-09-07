/**
 * DQ suite for the fill engine (F5) — same threshold discipline as
 * tests/dq.test.mjs, applied to the DISTRIBUTED acquisition queue.
 *
 * Checks (real archive.org data, real network):
 *   1. ANTI-HALLUCINATION 100% — every published URL traces to a real file of
 *      a real archive.org item (programmatic re-verification of the published
 *      fill record against fresh /metadata payloads).
 *   2. LIVENESS — sampled HEAD checks on published URLs ≥ threshold.
 *   3. FILL RATE — per-artist published fill rate ≥ threshold.
 *   4. LEASE INTEGRITY — no double claim within TTL; expiry frees the lease.
 *   5. DEDUP — no duplicate URLs inside a track's version list.
 *   6. METADATA COMPLETENESS — every version carries format + duration fields.
 *   7. NO REPEATED BASE TITLES — take/mix alternates folded into their host
 *      work (foldAlternateTakes): numbered tracks never repeat a base title,
 *      and folded alternates survive as playable version groups (own trackKey,
 *      provenance traced to real item files).
 *   8. TOP-DOWN CANDIDATE ORDER — the warm-up queue starts from user intent
 *      and the canonical catalog; the archive.org crawl is last.
 *
 * Usage: node tests/dq.fill.mjs
 */

// Node: give the storage-backed modules a minimal localStorage shim (the app
// targets browsers; the shim keeps the fill engine unit-testable honestly).
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { fillArtist, extractVersions, claimArtist, releaseClaim, FILL_RATE_THRESHOLD, LIVENESS_THRESHOLD } =
  await import("../lib/fillengine.js");
const { catalogGet, catalogSet, keys, ttlForKey, CLAIM_TTL_MS } = await import("../lib/catalogstore.js");
const { fetchItemMetadata, creatorStats } = await import("../lib/archive.js");
const { urlHash } = await import("../lib/versions.js");

let passed = 0;
let failed = 0;
const checks = [];

function check(name, value, threshold, cmp = (v, t) => v >= t) {
  const ok = cmp(value, threshold);
  ok ? passed++ : failed++;
  checks.push({ name, value, threshold, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${name}: ${typeof value === "number" ? value.toFixed(1) : value} (threshold ${threshold})`);
}
const pct = (n, d) => (d === 0 ? 0 : (100 * n) / d);

console.log("\n═══ DQ: fill engine (lease integrity, offline-first) ═══");

// — 4) Lease integrity: pure lease semantics with the storage shim —
check("claim succeeds when absent", await claimArtist("__dq_artist__", "peer-A"), 1, (v, t) => v === !!t);
check("no double claim within TTL", await claimArtist("__dq_artist__", "peer-B"), 0, (v, t) => v === !!t);
{
  // Expiry: a lease older than its TTL is free again.
  const key = keys.queueClaim("__dq_artist__");
  const lease = await catalogGet(key);
  await catalogSet(key, { ...lease, at: Date.now() - lease.ttl - 1000 });
  check("expired lease frees the claim", await claimArtist("__dq_artist__", "peer-B"), 1, (v, t) => v === !!t);
  await releaseClaim("__dq_artist__");
}
check("lease TTL default is 24h", CLAIM_TTL_MS / 3600_000, 24, (v, t) => v === t);
check("epfeed namespace TTL 36h", ttlForKey("epfeed:x") / 3600_000, 36, (v, t) => v === t);
check("claim namespace TTL is lease TTL", ttlForKey("queue:claim:x"), CLAIM_TTL_MS, (v, t) => v === t);

// — Version selection: aggregate basis —
{
  const { chooseVersion } = await import("../lib/versions.js");
  const versions = [
    { url: "https://a/flac", format: "Flac" },
    { url: "https://a/mp3", format: "VBR MP3" },
  ];
  const stats = [{ urlHash: urlHash("https://a/mp3"), plays: 50, completes: 45 }];
  const pick = chooseVersion(versions, stats, "tk");
  check("aggregate elects most-completed version", pick.version.url === "https://a/mp3" ? 1 : 0, 1, (v, t) => v === t);
  check("basis is aggregate", pick.basis === "aggregate" ? 1 : 0, 1, (v, t) => v === t);
  const honest = chooseVersion(versions, []);
  check("no data → honest quality basis", honest.basis === "quality" ? 1 : 0, 1, (v, t) => v === t);
}

// — 7) NO REPEATED BASE TITLES among numbered tracks (DQ stage:
// foldAlternateTakes) — the "repeated tracks" failure (canonical 1–14 plus
// takes/mixes rendered as separate numbered entries) is structurally
// impossible. Base = title without trailing take/mix qualifier.
{
  const { foldAlternateTakes, trackBaseKey, normalizeAlbum } = await import("../lib/pipeline.js");
  const mk = (name, title, url) => ({ id: `${name}`, title, rawTitle: title, url, format: "VBR MP3", number: 1, duration: 200 });
  // Unit (pure): a take folds into its host work; a distinct work never folds.
  const folded = foldAlternateTakes([
    mk("a", "Taxman", "https://a/taxman.flac"),
    mk("b", "Taxman (Take 1)", "https://a/take1.flac"),
    mk("c", "Tomorrow Never Knows (Mono)", "https://a/tnk.flac"),
    mk("d", "Paperback Writer (Mono)", "https://a/pw.flac"),
  ]);
  check("fold: take merges into host (numbered ≤)", folded.length, 3, (v, t) => v <= t);
  check("fold: alternate keeps full play metadata", (folded[0].alternates ?? []).every((a) => a.id && a.url && a.title) && (folded[0].alternates ?? []).length === 1 ? 1 : 0, 1, (v, t) => v === t);
  check("fold: distinct works stay numbered", folded.some((t) => t.title === "Paperback Writer (Mono)") ? 1 : 0, 1, (v, t) => v === t);
  // Real item (the motivating case): Revolver 2022 mix deluxe.
  const DQ_ITEM = "01-taxman-2022-mix_202606";
  let meta = null;
  try { meta = await fetchItemMetadata(DQ_ITEM); } catch { /* network below */ }
  if (!meta?.files?.length) {
    console.log("  ⚠ real-item fold check skipped (network unavailable)");
  } else {
    const album = normalizeAlbum(DQ_ITEM, meta);
    const seen = new Map();
    let dupBase = 0;
    for (const t of album.tracks) {
      const k = trackBaseKey(t.rawTitle);
      if (seen.has(k)) dupBase++;
      else seen.set(k, t.title);
    }
    check(`no repeated base titles (${DQ_ITEM})`, dupBase, 0, (v, t) => v <= t);
    check(`alternates folded, never lost (${DQ_ITEM})`, album.tracks.reduce((s, t) => s + (t.alternates?.length ?? 0), 0), 1);
    check("alternates keep playable urls", album.tracks.every((t) => (t.alternates ?? []).every((a) => a.url && a.id)) ? 1 : 0, 1, (v, t) => v === t);
    // extractVersions: alternates are additional version groups (own trackKey),
    // with the same provenance contract (A1: URL ∈ real files).
    const groups = await extractVersions(DQ_ITEM, meta);
    const realFiles = new Set(meta.files.filter((f) => /\.(mp3|flac|ogg|wav|m4a)$/i.test(f.name ?? "")).map((f) => f.name));
    const altGroups = groups.filter((g) => (album.tracks.flatMap((t) => t.alternates ?? [])).some((a) => a.id === g.trackKey));
    const phantom = altGroups.flatMap((g) => g.versions).filter((v) => !realFiles.has(v.file)).length;
    check(`alternates extracted as version groups (${DQ_ITEM})`, altGroups.length, 1);
    check(`alternate versions trace to real files (${DQ_ITEM})`, phantom, 0, (v, t) => v <= t);
  }
}


// — 8) TOP-DOWN candidate order: the queue starts from user intent and the
// canonical catalog; measured popularity comes after, curated PD after that,
// and the archive.org crawl is LAST (user-ratified direction inversion).
{
  const { buildCandidates } = await import("../lib/catalogwarm.js");
  const order = buildCandidates({
    recent: ["Betty Thornton"],
    canonNames: ["wolfgang amadeus mozart", "johann sebastian bach", "mozart", "antonio vivaldi"],
    measured: [
      { name: "Ella Fitzgerald", sitelinks: 100, pageviews: 5_000_000 },
      { name: "The Chordettes", sitelinks: 5, pageviews: 10_000 },
    ],
    pd: ["Enrico Caruso"],
    crawl: ["Long Tail Ensemble"],
  });
  const src = order.map((c) => c.source);
  check("candidates: user-visited artist first", order[0].name === "Betty Thornton" ? 1 : 0, 1, (v, t) => v === t);
  check("candidates: canon before measured popularity", src.indexOf("canon") !== -1 && src.indexOf("canon") < src.indexOf("popular") ? 1 : 0, 1, (v, t) => v === t);
  check("candidates: canon alias collapse (mozart ×1)", order.filter((c) => /mozart/i.test(c.name)).length, 1, (v, t) => v <= t);
  check("candidates: canon tier order (Bach before Vivaldi)", order.findIndex((c) => /bach/i.test(c.name)) < order.findIndex((c) => c.name === "antonio vivaldi") ? 1 : 0, 1, (v, t) => v === t);
  check("candidates: measured popularity ordering (Ella > Chordettes)", order.findIndex((c) => c.name === "Ella Fitzgerald") < order.findIndex((c) => c.name === "The Chordettes") ? 1 : 0, 1, (v, t) => v === t);
  check("candidates: PD queue before crawl", src.indexOf("pd") < src.indexOf("crawl") ? 1 : 0, 1, (v, t) => v === t);
  check("candidates: crawl is last", src[src.length - 1] === "crawl" ? 1 : 0, 1, (v, t) => v === t);
}

// — 9) CANONICAL MATCHER GUARDS (matchCanonicalEntries, pure): an archive.org
// item whose title is just the artist name is a collection, not an album;
// one item stands for at most one canonical release; "<Work> (Deluxe|...)" IS
// the work (edition containment, year window waived for reissue dates).
{
  const { matchCanonicalEntries } = await import("../lib/discography.js");
  const items = [
    { id: "generic", title: "20150205 The-Beatles", year: 2015 },
    { id: "revolver-deluxe", title: "Revolver (Deluxe)", year: 2022 },
    { id: "abbey", title: "Abbey Road", year: 1969 },
  ];
  const rgs = [
    { title: "Revolver", year: 1966, mbid: "rg1" },
    { title: "Abbey Road", year: 1969, mbid: "rg2" },
    { title: "The Beatles", year: 1968, mbid: "rg3" },
    { title: "The Beatles", year: 1968, mbid: "rg3-dup" },
  ];
  const m = matchCanonicalEntries("The Beatles", rgs, items);
  const by = Object.fromEntries(m.entries.map((e) => [e.mbid, e]));
  check("matcher: edition containment (Revolver → Deluxe item)", by.rg1.status === "available" && by.rg1.match.id === "revolver-deluxe" ? 1 : 0, 1, (v, t) => v === t);
  check("matcher: identity guard (artist-named collection never matches)", m.entries.every((e) => e.match?.id !== "generic") ? 1 : 0, 1, (v, t) => v === t);
  check("matcher: one item one album (same-title RGs ≤1 available)", m.entries.filter((e) => e.title === "The Beatles" && e.status === "available").length, 1, (v, t) => v <= t);
  check("matcher: exact title match", by.rg2.status === "available" && by.rg2.match.id === "abbey" ? 1 : 0, 1, (v, t) => v === t);
}

console.log("\n═══ DQ: fill on real artists (PD-first collection) ═══");

// PD-first sample: artists from georgeblood (public domain by construction).
let artists = [];
try {
  const stats = await creatorStats("georgeblood", 60);
  artists = stats.filter((s) => s.recordings >= 2).slice(0, 2).map((s) => s.name);
} catch { /* network failure handled below */ }

if (!artists.length) {
  console.log("  ⚠ no artists sampled (network unavailable) — offline checks only");
} else {
  const results = [];
  for (const artist of artists) {
    let res = await fillArtist(artist, { peerId: "dq-peer" });
    // "nothing-to-fill" can be a transient MB unreachability (the empty
    // crossref is memoized, and releaseClaim leaves a 1h retry tombstone):
    // clear both and retry once — removing a network artifact, never a
    // threshold cut. The tombstone only exists because of this same run's
    // first attempt.
    if (res.state === "nothing-to-fill") {
      await new Promise((r) => setTimeout(r, 2000));
      localStorage.removeItem("pf.store." + keys.crossref(artist));
      localStorage.removeItem("pf.store." + keys.queueClaim(artist));
      res = await fillArtist(artist, { peerId: "dq-peer" });
    }
    results.push({ artist, res });
    console.log(`  ℹ ${artist}: ${res.state}${res.reason ? ` (${res.reason})` : ""}`);
  }

  const filled = results.filter((r) => r.res.state === "filled");
  const fills = [];
  for (const { artist } of filled) {
    const rec = await catalogGet(keys.fill(artist));
    if (rec) fills.push({ artist, rec });
  }

  // — 1) ANTI-HALLUCINATION: every URL ∈ item.files (fresh verification) —
  let totalUrls = 0;
  let hallucinated = 0;
  let dupUrls = 0;
  let missingMeta = 0;
  for (const { rec } of fills) {
    for (const versions of Object.values(rec.tracks ?? {})) {
      const seen = new Set();
      for (const v of versions) {
        totalUrls++;
        if (!v.format) missingMeta++;
        if (v.durationMs == null) missingMeta++; // duration must be a field (null allowed only if unknown upstream? fill records track durations) → count
        if (seen.has(v.url)) dupUrls++;
        seen.add(v.url);
        // Provenance: fetch the item's file list and check membership.
        try {
          const meta = await fetchItemMetadata(v.item);
          const fileNames = new Set((meta?.files ?? []).map((f) => f.name));
          if (!fileNames.has(v.file)) hallucinated++;
        } catch {
          hallucinated++; // unverifiable provenance = not publishable
        }
      }
    }
  }
  check("anti-hallucination: URLs verified against item files (%)", pct(totalUrls - hallucinated, totalUrls), 100, (v, t) => v >= t && totalUrls > 0);
  check("version URL dedup (dups allowed: 0)", dupUrls, 0, (v, t) => v <= t);
  check("version metadata completeness (%)", pct(totalUrls - missingMeta, totalUrls), 90);
  check("artists filled of sampled", filled.length, 1);

  // — 2) LIVENESS and 3) FILL RATE as published by the engine —
  const livenessVals = fills.map(({ rec }) => rec.stats?.liveness ?? 0);
  const fillRateVals = fills.map(({ rec }) => rec.stats?.fillRate ?? 0);
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  check("published liveness ≥ threshold", avg(livenessVals), LIVENESS_THRESHOLD);
  check("published fill rate ≥ threshold", avg(fillRateVals), FILL_RATE_THRESHOLD);

  // — queue:done marker consistency —
  let doneOk = 0;
  for (const { artist } of filled) {
    const done = await catalogGet(keys.queueDone(artist));
    if (done?.stats) doneOk++;
  }
  check("queue:done marker with stats", doneOk, Math.min(filled.length, 1));
}

console.log(`\n═══ RESULT: ${passed} pass, ${failed} fail ═══`);
if (failed > 0) {
  console.log("Below threshold: fix the fill engine or its data; never lower thresholds to pass.");
  process.exit(1);
}
