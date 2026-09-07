/**
 * Podcast charts (F6 discovery, zero keys) — Apple iTunes public charts RSS.
 *
 * Why this source: browser-only, zero-server project. The iTunes charts RSS
 * (https://itunes.apple.com/{country}/rss/toppodcasts/limit=N/json) is public,
 * keyless, CORS-open (verified: access-control-allow-origin: *), and publishes
 * the TOP 100 most-followed podcasts per nation — "most used as streams" in
 * the sense the user asked: what people actually listen to, per country.
 * The per-show RSS feed URL is resolved lazily via the public /lookup API
 * (also keyless, also CORS-open) and cached in the shared catalog (pf.* layer,
 * schema-stamped lifecycle: charts 24h ceiling — they change daily; feed URLs
 * effectively permanent).
 *
 * Contract: never throws (degraded UI shows an honest empty state); all
 * network calls are GETs against public Apple endpoints, one per nation.
 */

import { catalogMemo, keys } from "./catalogstore.js";

/** The 50 leading nations by podcast consumption (ISO-2, iTunes store codes). */
export const TOP_NATIONS = [
  { code: "us", name: "United States", flag: "🇺🇸" },
  { code: "cn", name: "China", flag: "🇨🇳" },
  { code: "in", name: "India", flag: "🇮🇳" },
  { code: "br", name: "Brazil", flag: "🇧🇷" },
  { code: "gb", name: "United Kingdom", flag: "🇬🇧" },
  { code: "de", name: "Germany", flag: "🇩🇪" },
  { code: "fr", name: "France", flag: "🇫🇷" },
  { code: "jp", name: "Japan", flag: "🇯🇵" },
  { code: "it", name: "Italy", flag: "🇮🇹" },
  { code: "es", name: "Spain", flag: "🇪🇸" },
  { code: "ca", name: "Canada", flag: "🇨🇦" },
  { code: "au", name: "Australia", flag: "🇦🇺" },
  { code: "mx", name: "Mexico", flag: "🇲🇽" },
  { code: "kr", name: "South Korea", flag: "🇰🇷" },
  { code: "id", name: "Indonesia", flag: "🇮🇩" },
  { code: "tr", name: "Türkiye", flag: "🇹🇷" },
  { code: "sa", name: "Saudi Arabia", flag: "🇸🇦" },
  { code: "ar", name: "Argentina", flag: "🇦🇷" },
  { code: "za", name: "South Africa", flag: "🇿🇦" },
  { code: "eg", name: "Egypt", flag: "🇪🇬" },
  { code: "nl", name: "Netherlands", flag: "🇳🇱" },
  { code: "pl", name: "Poland", flag: "🇵🇱" },
  { code: "se", name: "Sweden", flag: "🇸🇪" },
  { code: "no", name: "Norway", flag: "🇳🇴" },
  { code: "dk", name: "Denmark", flag: "🇩🇰" },
  { code: "fi", name: "Finland", flag: "🇫🇮" },
  { code: "ie", name: "Ireland", flag: "🇮🇪" },
  { code: "pt", name: "Portugal", flag: "🇵🇹" },
  { code: "gr", name: "Greece", flag: "🇬🇷" },
  { code: "cz", name: "Czechia", flag: "🇨🇿" },
  { code: "ro", name: "Romania", flag: "🇷🇴" },
  { code: "hu", name: "Hungary", flag: "🇭🇺" },
  { code: "at", name: "Austria", flag: "🇦🇹" },
  { code: "ch", name: "Switzerland", flag: "🇨🇭" },
  { code: "be", name: "Belgium", flag: "🇧🇪" },
  { code: "il", name: "Israel", flag: "🇮🇱" },
  { code: "ae", name: "United Arab Emirates", flag: "🇦🇪" },
  { code: "th", name: "Thailand", flag: "🇹🇭" },
  { code: "vn", name: "Vietnam", flag: "🇻🇳" },
  { code: "ph", name: "Philippines", flag: "🇵🇭" },
  { code: "my", name: "Malaysia", flag: "🇲🇾" },
  { code: "sg", name: "Singapore", flag: "🇸🇬" },
  { code: "nz", name: "New Zealand", flag: "🇳🇿" },
  { code: "cl", name: "Chile", flag: "🇨🇱" },
  { code: "co", name: "Colombia", flag: "🇨🇴" },
  { code: "pe", name: "Peru", flag: "🇵🇪" },
  { code: "ng", name: "Nigeria", flag: "🇳🇬" },
  { code: "ke", name: "Kenya", flag: "🇰🇪" },
  { code: "ma", name: "Morocco", flag: "🇲🇦" },
  { code: "ua", name: "Ukraine", flag: "🇺🇦" },
];

const CHARTS_URL = "https://itunes.apple.com";
const LOOKUP_URL = "https://itunes.apple.com/lookup";

/**
 * Chart depth by MARKET SIZE (numbers, not impressions): the six largest
 * podcast audiences get the full 1000; every other nation gets 100.
 * The RSS caps at 200 entries/request → 1000 = 5 paginated requests.
 */
const PAGE_LIMIT = 200;
const TIER_A = new Set(["us", "cn", "in", "gb", "de", "jp"]); // 1000 shows
const chartDepth = (code) => (TIER_A.has(code) ? 1000 : 100);

/** Largest artwork label from an entry's image array (last = biggest). */
function bestImage(images) {
  const arr = Array.isArray(images) ? images : [];
  return arr.length ? arr[arr.length - 1]?.label ?? null : null;
}

/**
 * Top chart podcasts for one nation (Apple charts RSS), cached in the shared
 * catalog with the schema-stamped lifecycle (charts: 24h ceiling — the chart
 * itself changes daily; do not let it live a week).
 * Depth by market size: tier-A nations (US/CN/IN/GB/DE/JP) pull 1000 shows
 * via 5 paginated requests (RSS caps 200/page), all others 100.
 * @param {string} code ISO-2 nation code (e.g. "it").
 * @returns {Promise<{id: string, title: string, artist: string, image: string|null}[]>}
 */
export async function topPodcasts(code, limit = null) {
  const country = String(code ?? "").toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) return [];
  return catalogMemo(keys.podChart(country), async () => {
    const depth = Math.min(limit ?? chartDepth(country), 1000);
    const seen = new Set();
    const shows = [];
    for (let page = 1; shows.length < depth; page++) {
      const res = await fetch(`${CHARTS_URL}/${country}/rss/toppodcasts/limit=${PAGE_LIMIT}/page=${page}/json`);
      if (!res.ok) throw new Error(`itunes charts HTTP ${res.status}`);
      const json = await res.json();
      const entries = json?.feed?.entry ?? [];
      if (!Array.isArray(entries) || !entries.length) break; // chart exhausted
      for (const e of entries) {
        const id = e?.["im:id"]?.label ?? e?.id?.attributes?.["im:id"] ?? "";
        const title = e?.["im:name"]?.label ?? "";
        if (!id || !title || seen.has(id)) continue;
        seen.add(id);
        shows.push({ id, title, artist: e?.["im:artist"]?.label ?? "", image: bestImage(e?.["im:image"]) });
        if (shows.length >= depth) break;
      }
    }
    return { country, depth, updatedAt: Date.now(), shows };
  }, {
    // Charts are a daily snapshot: beyond 24h they are unverified (stale
    // ranking) and get refetched — quality-driven lifecycle, short ceiling.
    validate: (r) => Date.now() - (r.updatedAt ?? 0) < 24 * 3600 * 1000,
  }).then((r) => r?.shows ?? []).catch(() => []);
}

/**
 * Resolves the RSS feed URL for one chart show (public /lookup API), cached
 * for good in the shared catalog — a feed URL is stable catalog metadata.
 * @param {string} id Apple podcast collection id.
 * @returns {Promise<string|null>}
 */
export async function resolveFeedUrl(id) {
  const key = `podfeed:${String(id).trim()}`;
  const hit = await catalogMemo(key, async () => {
    const res = await fetch(`${LOOKUP_URL}?id=${encodeURIComponent(id)}&entity=podcast`);
    if (!res.ok) throw new Error(`itunes lookup HTTP ${res.status}`);
    const json = await res.json();
    const r = (json?.results ?? []).find((x) => typeof x.feedUrl === "string");
    if (!r?.feedUrl) throw new Error("no feedUrl in lookup result");
    return { feedUrl: r.feedUrl, updatedAt: Date.now() };
  });
  return hit?.feedUrl ?? null;
}
