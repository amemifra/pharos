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
 * Chart depth: NO CAP by design (user decision "cercare tutto e basta") —
 * pages are pulled until the chart is exhausted. PAGE_HARD_CAP is only an
 * abuse guard (Apple charts max out far below this in practice).
 * The RSS caps at 200 entries/request.
 */
const PAGE_LIMIT = 200;
const PAGE_HARD_CAP = 25; // 25 × 200 = 5000 shows, far past any real chart

/** Largest artwork label from an entry's image array (last = biggest). */
function bestImage(images) {
  const arr = Array.isArray(images) ? images : [];
  return arr.length ? arr[arr.length - 1]?.label ?? null : null;
}

/** Primary genre label from a chart entry (Apple publishes one per show). */
function entryGenre(entry) {
  return entry?.category?.attributes?.label ?? null;
}

const HIST_PREFIX = "podchart:hist:";
const HIST_CAP = 3000; // shared-catalog footprint bound

/**
 * DAILY LISTENS FEED: folds today's chart snapshot into the shared rank
 * history (`podchart:hist:<country>`). Public charts publish POSITION, not
 * raw listen counts — the honest aggregate over daily snapshots is the
 * average position weighted by days observed: a show steady at #1 for a
 * month has higher average listens than a flash #3. This history lives in
 * the shared OrbitDB catalog: every peer's daily visit feeds the system for
 * everyone (one snapshot/day by construction — the chart cache is 24h).
 * Contract: never throws; additive merge, bounded.
 * @param {string} country
 * @param {{id: string}[]} shows Ordered shows (index = today's rank).
 * @returns {Promise<Object>} id → {samples, rankSum, avgRank} (merged table).
 */
async function foldDailyRank(country, shows) {
  const key = `${HIST_PREFIX}${country}`;
  try {
    const { catalogGet, catalogSet } = await import("./catalogstore.js");
    const hist = (await catalogGet(key)) ?? {};
    shows.forEach((s, i) => {
      if (!s.id) return;
      const h = (hist[s.id] ??= { samples: 0, rankSum: 0, avgRank: 0 });
      h.samples += 1;
      h.rankSum += i + 1;
      h.avgRank = h.rankSum / h.samples;
      if (s.genre) h.genre = s.genre;
    });
    const entries = Object.entries(hist).slice(0, HIST_CAP);
    await catalogSet(key, Object.fromEntries(entries));
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

/**
 * Average-listens aggregate for one nation's chart (the daily public-chart
 * feed), read from the SHARED catalog — a show steady at #1 has avgRank → 1.
 * @param {string} country
 * @returns {Promise<Object>} id → {samples, rankSum, avgRank, genre?}.
 */
export async function listenStats(country) {
  try {
    const { catalogGet } = await import("./catalogstore.js");
    return (await catalogGet(`${HIST_PREFIX}${String(country).toLowerCase()}`)) ?? {};
  } catch {
    return {};
  }
}

/**
 * FULL chart for one nation (Apple charts RSS), cached in the shared
 * catalog with the schema-stamped lifecycle (charts: 24h ceiling — the
 * chart itself changes daily; do not let it live a week). Pages are pulled
 * until exhaustion (no artificial depth cap; see PAGE_HARD_CAP). Each
 * snapshot is folded into the shared daily-rank history (listenStats).
 * @param {string} code ISO-2 nation code (e.g. "it").
 * @returns {Promise<{id: string, title: string, artist: string, image: string|null, genre: string|null}[]>}
 */
export async function topPodcasts(code) {
  const country = String(code ?? "").toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) return [];
  return catalogMemo(keys.podChart(country), async () => {
    const seen = new Set();
    const shows = [];
    for (let page = 1; page <= PAGE_HARD_CAP; page++) {
      const res = await fetch(`${CHARTS_URL}/${country}/rss/toppodcasts/limit=${PAGE_LIMIT}/page=${page}/json`);
      if (!res.ok) throw new Error(`itunes charts HTTP ${res.status}`);
      const json = await res.json();
      const entries = json?.feed?.entry ?? [];
      if (!Array.isArray(entries) || !entries.length) break; // chart exhausted: everything
      let added = 0;
      for (const e of entries) {
        const id = e?.["im:id"]?.label ?? e?.id?.attributes?.["im:id"] ?? "";
        const title = e?.["im:name"]?.label ?? "";
        if (!id || !title || seen.has(id)) continue;
        seen.add(id);
        added += 1;
        shows.push({
          id, title,
          artist: e?.["im:artist"]?.label ?? "",
          image: bestImage(e?.["im:image"]),
          genre: entryGenre(e),
        });
      }
      if (!added) break; // all duplicates: the chart truly ends here
    }
    await foldDailyRank(country, shows);
    return { country, updatedAt: Date.now(), shows };
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
/**
 * Resolves ANY user-pasted podcast reference into an RSS feed url:
 *   - an RSS url (…xml, /feed, /rss) → as-is;
 *   - an Apple Podcasts show url (…/id1234567890) → iTunes lookup feedUrl;
 *   - any web page → the <link rel="alternate" type="application/rss+xml">
 *     declared in the HTML (WordPress sites ship it; many publishers only
 *     distribute via Apple/Spotify and never show the feed in the UI).
 * Honest failure: throws with the reason — the UI says WHY nothing resolved.
 * @param {string} input User input (url or feed url).
 * @returns {Promise<string>} RSS feed url.
 */
export async function resolveFeedFromInput(input) {
  const u = String(input ?? "").trim();
  if (!/^https?:\/\//i.test(u)) throw new Error("Not a url — paste a podcast page, Apple Podcasts link or RSS url.");
  if (/\.(xml|rss)([?#]|$)/i.test(u) || /\/(feed|rss|rss\.xml)([/?#]|$)/i.test(u)) return u;

  const apple = u.match(/podcasts\.apple\.com\/[^"]*?id(\d+)/i);
  if (apple) {
    const feedUrl = await resolveFeedUrl(apple[1]);
    if (feedUrl) return feedUrl;
    throw new Error("Apple has not indexed this show yet (brand-new shows can take days) — paste the RSS url directly.");
  }

  // Generic page: read the declared RSS alternate link (through the same
  // CORS-proxy chain the feeds use — many publishers send no CORS headers).
  const { fetchFeedXml } = await import("./podcast.js");
  const html = await fetchFeedXml(u);
  const link =
    html.match(/<link[^>]+rel=["']alternate["'][^>]+type=["']application\/rss\+xml["'][^>]+href=["']([^"']+)["']/i) ??
    html.match(/<link[^>]+type=["']application\/rss\+xml["'][^>]+href=["']([^"']+)["']/i);
  if (link) return new URL(link[1], u).href;
  throw new Error("No RSS link declared on this page (Spotify-only distribution?) — paste the RSS url directly.");
}

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
