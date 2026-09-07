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
        const collab = await import(/* webpackIgnore: true */ "./collab.js");
        return await collab.startCollab();
      } catch {
        return null; // offline / unsupported: local cache only
      }
    })();
  }
  return dbPromise;
}

function localGet(key) {
  try {
    const hit = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) ?? "null");
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
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
};
