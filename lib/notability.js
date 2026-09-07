/**
 * OBJECTIVE notability measures, accepted at community level.
 *
 * We do not use memorized judgments: every signal is a public, verifiable
 * measure maintained by recognized communities:
 *
 *  1. SITELINKS — number of Wikipedia language editions covering the artist.
 *     It is the standard encyclopedic-notability proxy (Wikimedia's community
 *     decides coverage, not us). Typical range: 1 (en only) → 150+.
 *  2. PAGEVIEWS — Wikipedia visits over the last 12 months (Wikimedia REST API).
 *     Measures current attention, independent of archive.org.
 *  3. RECORDINGS — number of publications in the catalog (archive.org).
 *     Depth of the available corpus.
 *
 * Every value can be reproduced with curl and verified by anyone, and is
 * cached (localStorage 30 days + OrbitDB for P2P sharing): the measures do
 * not change enough to justify continuous refetches, and on low-end phones
 * saving network traffic is a feature.
 */

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const PAGEVIEWS_API = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user";
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;

const cacheKey = (name) => `pf.notability.${name.toLowerCase()}`;

/** Reads a TTL-cached measure; returns null when absent or expired. */
function readCache(name) {
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey(name)) ?? "null");
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  } catch {}
  return null;
}

/** Writes a TTL cache entry; silently skips when storage is unavailable. */
function writeCache(name, data) {
  try { localStorage.setItem(cacheKey(name), JSON.stringify({ at: Date.now(), data })); } catch {}
}

/**
 * Sitelinks for a batch of artists (up to 40 per request: a single call).
 * Contract: never throws; artists with failed/missing lookups map to 0;
 * cached values are served without network.
 * @param {string[]} names Artist names (Wikipedia article titles).
 * @returns {Promise<Map<string, number>>} name → sitelinks count.
 */
export async function batchSitelinks(names) {
  const result = new Map();
  const missing = [];
  for (const name of names) {
    const cached = readCache(name);
    if (cached?.sitelinks != null) result.set(name, cached.sitelinks);
    else missing.push(name);
  }
  if (!missing.length) return result;

  // Batched request with origin=* (browser CORS, no keys).
  const titles = missing.map((n) => n.replace(/\s/g, "_")).slice(0, 40).join("|");
  try {
    const res = await fetch(`${WIKI_API}?action=query&format=json&origin=*&prop=langlinks&lllimit=max&redirects=1&titles=${encodeURIComponent(titles)}`);
    if (res.ok) {
      const json = await res.json();
      const pages = json?.query?.pages ?? {};
      for (const [i, name] of missing.entries()) {
        // Titles come back normalized: match by query order index.
        const page = Object.values(pages).find((p) => p.title?.replace(/\s/g, "_") === missing[i].replace(/\s/g, "_"));
        const count = Array.isArray(page?.langlinks) ? page.langlinks.length : 0;
        result.set(name, count);
        const cached = readCache(name) ?? {};
        writeCache(name, { ...cached, sitelinks: count });
      }
    }
  } catch { /* offline: serve whatever is cached */ }
  return result;
}

/**
 * 12-month pageviews of an artist on English Wikipedia.
 * Contract: never throws; returns 0 when the measure is unavailable;
 * the result is cached for 30 days.
 * @param {string} name Artist name (Wikipedia article title).
 * @returns {Promise<number>} Sum of monthly views (0 if absent).
 */
export async function pageviews(name) {
  const cached = readCache(name);
  if (cached?.pageviews != null) return cached.pageviews;

  const title = encodeURIComponent(name.replace(/\s/g, "_"));
  // Window: 12 full months closed on last month (the current one is incomplete).
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
  const fmt = (d) => d.toISOString().slice(0, 7).replace("-", "");
  try {
    const res = await fetch(`${PAGEVIEWS_API}/monthly/${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, "0")}/${fmt(start)}/${fmt(end)}/${title}`);
    if (res.ok) {
      const json = await res.json();
      const total = (json.items ?? []).reduce((sum, it) => sum + (it.views ?? 0), 0);
      const cachedPrev = readCache(name) ?? {};
      writeCache(name, { ...cachedPrev, pageviews: total });
      return total;
    }
  } catch {}
  return cached?.pageviews ?? 0;
}
