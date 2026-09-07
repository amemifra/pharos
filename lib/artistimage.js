/**
 * Artist image resolution via Wikipedia/Wikimedia (community-curated).
 *
 * Why: archive.org thumbnails are item covers (random quality, often wrong);
 * Wikipedia lead images are the community-accepted portrait of an artist.
 * Contract: returns a direct image URL, or null — never throws.
 * Cached in localStorage (30 days): portraits do not change often and low-end
 * phones must not refetch on every visit.
 */

const SUMMARY_API = "https://en.wikipedia.org/api/rest_v1/page/summary";
const TTL_MS = 30 * 24 * 3600 * 1000;

const cacheKey = (name) => `pf.artistimg.${name.toLowerCase()}`;

/**
 * Best portrait URL for an artist, from the English Wikipedia lead image.
 * @param {string} name Artist name (used as Wikipedia page title, redirects handled by the API).
 * @returns {Promise<string|null>} Image URL or null.
 */
export async function artistImage(name) {
  if (!name) return null;
  // Shared catalog first (P2P/local), Wikipedia only on miss.
  try {
    const store = await import("./catalogstore.js");
    const cached = await store.catalogGet(store.keys.artistImage(name));
    if (cached) return cached;
  } catch {}
  let url = null;
  try {
    const title = encodeURIComponent(name.replace(/\s/g, "_"));
    const res = await fetch(`${SUMMARY_API}/${title}?redirect=true`);
    if (res.ok) {
      const json = await res.json();
      url = json?.thumbnail?.source ?? json?.originalimage?.source ?? null;
    }
  } catch {}
  if (url) {
    try {
      const store = await import("./catalogstore.js");
      store.catalogSet(store.keys.artistImage(name), url);
    } catch {}
  }
  return url;
}
