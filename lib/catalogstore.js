/**
 * Shared catalog store on OrbitDB — the P2P data layer (no server).
 *
 * NAMING NOTE (legacy, do NOT rename): all localStorage keys use the `pf.*`
 * prefix (pf.queue, pf.recent, pf.canon, pf.ranker, pf.lbtoken, pf.store.* …)
 * — a relic of the pre-launch codename "PublicFlac". They are internal
 * identifiers, not brand surface: renaming them breaks every existing user's
 * caches and queues for zero benefit. New keys MUST keep the pf.* prefix.
 *
 * What lives here (all legal to share: factual metadata, MusicBrainz data is
 * CC0, availability status is our own computation):
 *
 *   crossref:<artist>   → canonical discography × availability snapshot
 *   ident:<trackId>     → community identifications (consensus votes)
 *   weights:ranker      → shared learning-to-rank weights (consensus average)
 *   artistimg:<artist>  → resolved portrait URL (Wikipedia)
 *
 * Design rules:
 *  - LAZY: Helia/OrbitDB load only when this module is actually used
 *    (dynamic import — never in the initial bundle, low-end phones first).
 *  - LOCAL-FIRST: every read falls back to localStorage cache when the P2P
 *    layer is unavailable; the app never blocks on the network layer.
 *  - WRITE-THROUGH: every computed value is published so other peers benefit.
 */

const CACHE_PREFIX = "pf.store.";
const TTL_MS = 7 * 24 * 3600 * 1000; // crossrefs get stale: sources grow

/** Per-namespace TTLs (ms). Namespaces not listed use TTL_MS. */
const NS_TTL_MS = {
  "fill:": 30 * 24 * 3600 * 1000,      // published fill results: long-lived data
  "queue:claim:": 24 * 3600 * 1000,    // work lease: expired claim = free to claim
  "queue:done:": 90 * 24 * 3600 * 1000,// completion marker: keep the stats
  "pd:": 90 * 24 * 3600 * 1000,        // PD assertions from curated sources
  "weights:": 90 * 24 * 3600 * 1000,   // aggregated feedback weights
  "epfeed:": 36 * 3600 * 1000,         // podcast episode snapshots (24–48h)
};

/** Lease TTL for the distributed fill queue (F2). Configurable constant. */
export const CLAIM_TTL_MS = NS_TTL_MS["queue:claim:"];

/** Episode-feed snapshot TTL (podcasts, F6). */
export const EPFEED_TTL_MS = NS_TTL_MS["epfeed:"];

/**
 * TTL for a catalog key: namespace prefix match, default TTL otherwise.
 * Contract: pure; the longest matching namespace prefix wins.
 * @param {string} key
 * @returns {number} TTL in ms.
 */
export function ttlForKey(key) {
  let best = null;
  for (const ns of Object.keys(NS_TTL_MS)) {
    if (key.startsWith(ns) && (!best || ns.length > best.length)) best = ns;
  }
  return best ? NS_TTL_MS[best] : TTL_MS;
}

/** @type {Promise<any>|null} Singleton db handle. */
let dbPromise = null;

/**
 * Opens (once) the shared OrbitDB keyvalue store.
 * @returns {Promise<any>} OrbitDB handle, or null when P2P is unavailable.
 */
async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        // Browser-only P2P (Helia wasm/WebRTC): in Node (tests, CLI tooling)
        // the store degrades gracefully to the local cache — never blocks.
        if (typeof window === "undefined") return null;
        const collab = await import(/* webpackIgnore: true */ "./collab.js");
        return await collab.startCollab();
      } catch {
        return null; // offline / unsupported: local cache only
      }
    })();
  }
  return dbPromise;
}

/**
 * Local cache read with per-namespace TTL: an expired entry is a MISS
 * (generic mechanism reused by `epfeed:` and `queue:claim:` leases).
 */
function localGet(key) {
  try {
    const hit = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) ?? "null");
    if (hit && Date.now() - hit.at < ttlForKey(key)) return hit.value;
  } catch {}
  return null;
}

function localSet(key, value) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), value })); } catch {}
}

/**
 * Read a catalog entry: P2P first, localStorage fallback.
 * @template T
 * @param {string} key Entry key (see module header for the namespace).
 * @returns {Promise<T|null>}
 */
export async function catalogGet(key) {
  const db = await getDb();
  if (db) {
    try {
      const remote = await db.get(key);
      if (remote != null) {
        localSet(key, remote);
        return remote;
      }
    } catch {}
  }
  return localGet(key);
}

/**
 * Write a catalog entry: publish to P2P and cache locally (write-through).
 * @template T
 * @param {string} key
 * @param {T} value
 * @returns {Promise<boolean>} true when published to the P2P layer.
 */
export async function catalogSet(key, value) {
  localSet(key, value);
  const db = await getDb();
  if (!db) return false;
  try { await db.put(key, value); return true; } catch { return false; }
}

/**
 * Cached-or-compute helper: the standard read path for expensive catalog data.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} compute Async producer (only called on miss).
 * @param {number} [minQuality=0] Skip publishing when compute returns null.
 * @returns {Promise<T|null>}
 */
export async function catalogMemo(key, compute, minQuality = 0) {
  const hit = await catalogGet(key);
  if (hit != null) return hit;
  const value = await compute();
  if (value != null && (typeof value !== "object" || !value.coverage || value.coverage > minQuality)) {
    catalogSet(key, value);
  }
  return value;
}

/** Cache-key helpers — single source of truth for the namespaces. */
export const keys = {
  crossref: (artist) => `crossref:${artist.toLowerCase()}`,
  artistImage: (artist) => `artistimg:${artist.toLowerCase()}`,
  rankerWeights: () => "weights:ranker",
  identification: (trackId) => `ident:${trackId}`,
  /** Fill results: trackKey → [{url, item, file, format, quality, durationMs, source, at, by}] */
  fill: (artist) => `fill:${artist.toLowerCase()}`,
  /** Distributed work lease {peerId, at, ttl}. */
  queueClaim: (artist) => `queue:claim:${artist.toLowerCase()}`,
  /** Completion marker + stats (fill rate, liveness sampled). */
  queueDone: (artist) => `queue:done:${artist.toLowerCase()}`,
  /** Public-domain assertion from a CURATED source (never crowd-asserted). */
  pd: (artist) => `pd:${artist.toLowerCase()}`,
  /** Community suspicion flag (may flag, never de-list). */
  pdFlag: (id) => `pd:flag:${id}`,
  /** Aggregated per-version play/completion stats. */
  versionWeights: () => "weights:versions",
  /** Podcast episode-feed snapshot (TTL 36h). */
  epFeed: (guid) => `epfeed:${guid}`,
};
