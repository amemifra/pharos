/**
 * Podcast Index API adapter (F6) — podcast DISCOVERY.
 *
 * The API key is OPTIONAL (localStorage `pf.pixkey`): without a key the app
 * remains fully usable via direct RSS feed URLs (loadFeed in lib/podcast.js).
 * With a key, /search/byterm and /trending power the search page's Podcast
 * medium. Authentication is the documented PODCAST INDEX scheme:
 *   headers: X-Auth-Date, X-Auth-Key, Authorization = sha1(apiKey+apiSecret+date)
 * The secret never leaves localStorage and is only used to compute the SHA-1
 * auth header client-side (documented tradeoff: zero-backend means the
 * browser holds the secret — same class as the ListenBrainz token).
 */

const API = "https://api.podcastindex.org/api/1.1";

async function sha1Hex(text) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Credentials from localStorage, or null (app stays RSS-usable). */
function credentials() {
  try {
    const pair = JSON.parse(localStorage.getItem("pf.pixkey") ?? "null");
    return pair?.key && pair?.secret ? pair : null;
  } catch { return null; }
}

/** True when discovery is enabled (key present). */
export function enabled() {
  return !!credentials();
}

/** Authenticated GET against the Podcast Index API. */
async function apiGet(path) {
  const creds = credentials();
  if (!creds) throw new Error("no Podcast Index key configured");
  const date = Math.floor(Date.now() / 1000);
  const auth = await sha1Hex(creds.key + creds.secret + date);
  const res = await fetch(`${API}${path}`, {
    headers: { "X-Auth-Date": String(date), "X-Auth-Key": creds.key, Authorization: auth },
  });
  if (!res.ok) throw new Error(`podcastindex HTTP ${res.status}`);
  return res.json();
}

/**
 * Search shows by term.
 * @param {string} term
 * @returns {Promise<{feedUrl: string, title: string, image: string|null, description: string}[]>}
 */
export async function searchShows(term) {
  const json = await apiGet(`/search/byterm?q=${encodeURIComponent(term)}`);
  return (json.feeds ?? []).map((f) => ({
    feedUrl: f.url,
    title: f.title,
    image: f.image ?? f.artwork ?? null,
    description: String(f.description ?? "").slice(0, 300),
  }));
}

/** Trending shows (discovery shelf). Same shape as searchShows. */
export async function trendingShows(count = 10) {
  const json = await apiGet(`/trending?max=${count}`);
  return (json.feeds ?? []).map((f) => ({
    feedUrl: f.url,
    title: f.title,
    image: f.image ?? f.artwork ?? null,
    description: String(f.description ?? "").slice(0, 300),
  }));
}

/** Latest episodes of a feed by id (used after search by feedId). */
export async function episodesByFeedId(feedId) {
  const json = await apiGet(`/episodes/byfeedid?id=${encodeURIComponent(feedId)}&max=50`);
  return json.items ?? [];
}
