/**
 * Podcast feed model (F6) — RSS/Atom parsing with the SAME infrastructural
 * rules as music: TTL-cached shared snapshots (epfeed:), provenance on every
 * episode, restricted-content guard at the source, zero servers.
 *
 * Parsing uses the native DOMParser (browser-only): no dependencies, bounded
 * work on the main thread, one feed parse per fetch.
 *
 * CORS reality: many podcast feeds ship no Access-Control-Allow-Origin. The
 * fetch strategy is declared and measured (DQ: feed-parse success %):
 *   1. direct fetch (works for CORS-clean feeds);
 *   2. fallback through a public CORS proxy (allorigins) — a declared,
 *      documented fallback, not our own server (the app stays zero-backend).
 *
 * Enclosure audio plays DIRECTLY (enclosures are plain files on CDNs); the
 * restricted guard only HEAD-checks when the episode declares no length.
 */

import { catalogGet, catalogSet, keys, EPFEED_TTL_MS } from "./catalogstore.js";

/**
 * Proxy chain (public, keyless, browser-only project): direct first (feeds
 * with CORS), then fallbacks for feeds that send none. Public proxies are
 * FLAKY (allorigins/codetabs observed 520/522) — each attempt is bounded by
 * a hard timeout and the chain degrades honestly; the shared epfeed snapshot
 * (36h, OrbitDB) makes ONE success serve every peer for 36h.
 */
const CORS_PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, // JSON-wrapped
];
const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal }); } finally { clearTimeout(t); }
}

/**
 * Fetches feed XML: direct first, then the proxy chain.
 * @param {string} feedUrl
 * @returns {Promise<string>} Raw XML text.
 */
export async function fetchFeedXml(feedUrl) {
  let lastErr = "unknown";
  try {
    const res = await fetchWithTimeout(feedUrl);
    if (res.ok) return await res.text();
    lastErr = `direct HTTP ${res.status}`;
  } catch (e) { lastErr = `direct ${e?.name === "AbortError" ? "timeout" : e?.message ?? "failed"}`; }
  for (const proxy of CORS_PROXIES) {
    try {
      const res = await fetchWithTimeout(proxy(feedUrl));
      if (!res.ok) { lastErr = `proxy HTTP ${res.status}`; continue; }
      const text = await res.text();
      // allorigins /get wraps: {contents: "<xml…"} — unwrap when present.
      if (text.startsWith("{")) {
        try { const j = JSON.parse(text); if (typeof j?.contents === "string") return j.contents; } catch {}
      }
      if (text.includes("<rss") || text.includes("<feed") || text.includes("<channel")) return text;
      lastErr = "proxy returned non-XML";
    } catch (e) { lastErr = `proxy ${e?.name === "AbortError" ? "timeout" : "failed"}`; }
  }
  throw new Error(`feed unreachable (${lastErr})`);
}

/** Relative-date formatter (single Intl instance, honest locale fallback). */
const rtf = typeof Intl !== "undefined" && Intl.RelativeTimeFormat
  ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }) : null;

/** Human relative date ("3 days ago"); falls back to ISO when Intl is absent. */
export function relativeDate(ms) {
  if (!ms) return "";
  if (!rtf) return new Date(ms).toISOString().slice(0, 10);
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const units = [
    [60_000, "second"], [3_600_000, "minute"], [86_400_000, "hour"],
    [2_592_000_000, "day"], [31_536_000_000, "month"], [Infinity, "year"],
  ];
  for (const [limit, unit] of units) {
    if (abs < limit) {
      const div = unit === "second" ? 1000 : unit === "minute" ? 60_000
        : unit === "hour" ? 3_600_000 : unit === "day" ? 86_400_000
        : unit === "month" ? 2_592_000_000 : 31_536_000_000;
      return rtf.format(Math.round(diff / div), unit);
    }
  }
  return "";
}

/**
 * Parses one RSS <item> (or Atom <entry>) into an episode record.
 * Every field is factual (read from the feed, never invented).
 */
function parseItem(node, feedUrl) {
  const get = (tag) => node.querySelector(tag)?.textContent?.trim() ?? "";
  const guid = get("guid") || get("id") || get("link");
  if (!guid) return null;
  const enclosure = node.querySelector("enclosure");
  const url = enclosure?.getAttribute("url") ?? "";
  const type = enclosure?.getAttribute("type") ?? "";
  const durationRaw = get("duration");
  // iTunes duration: "1:23:45" | "83:45" | seconds.
  let durationMs = null;
  if (/^\d+$/.test(durationRaw)) durationMs = Number(durationRaw) * 1000;
  else if (/^[\d:]+$/.test(durationRaw)) {
    durationMs = durationRaw.split(":").reduce((s, p) => s * 60 + Number(p), 0) * 1000;
  }
  // podcast:transcript (Podcasting 2.0) — we only LINK it, never fabricate.
  const transcriptUrl = node.querySelector("podcast\\:transcript")?.getAttribute("url") ?? null;
  // podcast:chapters JSON url — starts[] come from the chapters file at play
  // time (same contract as lib/tracklist.js compound starts[]).
  const chaptersUrl = node.querySelector("podcast\\:chapters")?.getAttribute("url") ?? null;
  const pubDateMs = Date.parse(get("pubDate") || get("updated") || get("published")) || null;
  return {
    guid,
    feedUrl,
    title: get("title") || "Untitled episode",
    url,
    type,
    durationMs,
    sizeBytes: Number(enclosure?.getAttribute("length") ?? 0) || null,
    pubDateMs,
    transcriptUrl,
    chaptersUrl,
    description: get("description").replace(/<[^>]+>/g, "").slice(0, 500),
    at: Date.now(),
  };
}

/**
 * Parses a podcast feed into a show + episodes.
 * Contract: throws on unparseable XML (caller decides); every episode
 * carries its source feedUrl (provenance, same rule as fill versions).
 * @param {string} xml Raw feed XML.
 * @param {string} feedUrl Source feed URL.
 * @param {number} [cap=500] Bounded episode snapshot (footprint discipline).
 * @returns {{show: Object, episodes: Object[]}}
 */
export function parseFeed(xml, feedUrl, cap = 500) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("unparseable feed XML");
  const ch = doc.querySelector("channel") ?? doc.querySelector("feed");
  if (!ch) throw new Error("no channel/feed element");
  const get = (tag) => ch.querySelector(tag)?.textContent?.trim() ?? "";
  // Cover art: itunes:image (square, authoritative) first — selected via
  // getElementsByTagName because namespaced selectors ("itunes\\:image") are
  // unreliable across browsers; then RSS <image><url>; then media:thumbnail.
  // Some publishers put the WRONG art in <image><url> (brand banner) — the
  // itunes tag is the one podcast apps actually display.
  const itunesImg = ch.getElementsByTagName("itunes:image")[0]?.getAttribute("href") ?? null;
  const rssImg = ch.querySelector("image > url")?.textContent?.trim() ?? null;
  const mediaImg = ch.getElementsByTagName("media:thumbnail")[0]?.getAttribute("url") ?? null;
  const show = {
    feedUrl,
    title: get("title") || feedUrl,
    description: get("description").replace(/<[^>]+>/g, "").slice(0, 800),
    image: itunesImg || rssImg || mediaImg,
    link: get("link"),
    at: Date.now(),
  };
  const items = [...doc.querySelectorAll("item"), ...doc.querySelectorAll("entry")];
  const episodes = items.map((n) => parseItem(n, feedUrl)).filter(Boolean).slice(0, cap);
  return { show, episodes };
}

/**
 * Apple chart/lookup art comes as CDN thumbnails (…/55x55bb.png) — request
 * the 600×600 rendition of the SAME asset (documented Apple CDN convention:
 * the NxNbb suffix selects the resize). Pure string composition.
 * @param {string|null} url
 * @returns {string|null}
 */
export function bigArt(url) {
  if (!url) return null;
  return String(url).replace(/\/\d+x\d+bb\.(png|jpg|webp)(\?.*)?$/i, "/600x600bb.$1");
}

/**
 * Local-first shared snapshot: read `epfeed:<feedUrl>` (36h TTL); on miss,
 * fetch + parse + publish so other peers read instead of re-parsing (the
 * "one computation, shared" rule applied to feeds).
 * @param {string} feedUrl
 * @returns {Promise<{show: Object, episodes: Object[], source: "cache"|"network"}>}
 */
export async function loadFeed(feedUrl) {
  const key = keys.epFeed(feedUrl);
  const cached = await catalogGet(key);
  if (cached?.show) return { ...cached, source: "cache" };
  const xml = await fetchFeedXml(feedUrl);
  const parsed = parseFeed(xml, feedUrl);
  await catalogSet(key, parsed); // TTL 36h via the epfeed: namespace
  return { ...parsed, source: "network" };
}

/**
 * Restricted-content guard for an enclosure: HEAD-check → 401/403 maps to the
 * same restricted class as archive.org's `-access-restricted-item` (excluded
 * at the source, never shown as playable).
 * @param {Object} episode
 * @returns {Promise<boolean>} true when the episode is playable for us.
 */
export async function isPlayable(episode) {
  if (!episode.url) return false;
  try {
    const res = await fetch(episode.url, { method: "HEAD" });
    if (res.status === 401 || res.status === 403) return false;
    return res.ok || res.status === 405; // some CDNs refuse HEAD: allow GET
  } catch {
    return false;
  }
}

/** Chapters file (Podcasting 2.0 JSON) → starts[] (tracklist contract). */
export async function fetchChapters(chaptersUrl) {
  if (!chaptersUrl) return null;
  try {
    const res = await fetch(chaptersUrl);
    if (!res.ok) return null;
    const json = await res.json();
    const chapters = Array.isArray(json.chapters) ? json.chapters : [];
    return chapters.map((c) => ({ title: c.title ?? "", starts: [Math.round(c.startTime ?? 0)] }));
  } catch {
    return null;
  }
}
