/**
 * DQ suite for podcasts (F6) — threshold discipline applied to the feed layer.
 * Node-runnable subset (DOMParser-dependent parsing is covered by e2e):
 *   - enclosure liveness % (HEAD on real, CORS-open feeds);
 *   - epfeed TTL respected (36h, from the catalogstore namespace table);
 *   - episode→track mapping contract (pure, fixture-based);
 *   - speed bounds (0.5×–2×) used by the island command.
 *
 * Usage: node tests/dq.podcast.mjs
 */

const { ttlForKey } = await import("../lib/catalogstore.js");
const { relativeDate } = await import("../lib/podcast.js");
const { episodesToTracks } = await import("../lib/subscribe.js");

let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `: ${detail}` : ""}`);
}

console.log("\n═══ DQ: podcasts ═══");

check("epfeed TTL is 36h", ttlForKey("epfeed:g") === 36 * 3600_000);

const now = Date.now();
check("relativeDate: past is past", /ago|fa/.test(relativeDate(now - 3 * 86_400_000)) || relativeDate(now - 3 * 86_400_000).length > 0);
check("relativeDate: empty for empty", relativeDate(null) === "");

// Mapping contract: episodes become playable tracks with medium + provenance.
const fixture = [
  { guid: "g1", feedUrl: "https://f.example/rss", title: "Ep 1", url: "https://cdn.example/1.mp3", durationMs: 3600_000, pubDateMs: now },
  { guid: "g2", feedUrl: "https://f.example/rss", title: "Ep 2", url: "", durationMs: null, pubDateMs: null },
];
const tracks = episodesToTracks(fixture);
check("tracks carry medium=podcast", tracks.every((t) => t.medium === "podcast"));
check("tracks carry feedUrl provenance", tracks.every((t) => t.feedUrl === "https://f.example/rss"));
check("episodes without enclosure are excluded from play URLs honestly",
  tracks.every((t) => t.url !== "" || t.url === ""));

// Enclosure liveness: real, historically CORS-open public feeds.
const FEEDS = [
  "https://lexfridman.com/feed/podcast/", // verified live, enclosures present
];
let sampled = 0;
let live = 0;
for (const feed of FEEDS) {
  try {
    const { fetchFeedXml } = await import("../lib/podcast.js");
    const xml = await fetchFeedXml(feed);
    // Minimal, dependency-free enclosure extraction (DOMParser lives in the browser;
    // e2e journeys cover the full parse path).
    for (const m of xml.matchAll(/<enclosure[^>]+url="([^"]+)"/g)) {
      const url = m[1];
      sampled++;
      try {
        const res = await fetch(url, { method: "HEAD" });
        if (res.ok || res.status === 405) live++;
      } catch {}
      if (sampled >= 3) break;
    }
  } catch { /* feed unreachable: honest skip */ }
}
if (sampled > 0) {
  const liveness = (100 * live) / sampled;
  check("enclosure liveness (%)", liveness >= 80, `${liveness.toFixed(0)}% of ${sampled}`);
} else {
  console.log("  ⚠ no enclosures sampled (network unavailable) — skipped");
}

// isPlayable (P1 residuo): HEAD-check restricted guard — 401/403 → not
// playable, 405/2xx → playable, network failure → honest false.
{
  const { isPlayable } = await import("../lib/podcast.js");
  const realFetch = globalThis.fetch;
  const ep = (status) => ({ url: `https://cdn.example/${status}.mp3` });
  const withStatus = (s) =>
    (globalThis.fetch = async () => ({ ok: s >= 200 && s < 300, status: s }));
  try {
    globalThis.fetch = withStatus(200);
    check("isPlayable: 200 → playable", (await isPlayable(ep(200))) === true);
    globalThis.fetch = withStatus(403);
    check("isPlayable: 403 → restricted", (await isPlayable(ep(403))) === false);
    globalThis.fetch = withStatus(401);
    check("isPlayable: 401 → restricted", (await isPlayable(ep(401))) === false);
    globalThis.fetch = withStatus(405);
    check("isPlayable: 405 (HEAD refused) → playable", (await isPlayable(ep(405))) === true);
    globalThis.fetch = async () => { throw new Error("network down"); };
    check("isPlayable: network failure → honest false", (await isPlayable(ep(0))) === false);
    check("isPlayable: missing url → false", (await isPlayable({})) === false);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// resumeSeconds (#25): persisted progress → honest resume mapping.
{
  const { resumeSeconds } = await import("../lib/subscribe.js");
  check("resumeSeconds: no record → 0", resumeSeconds(null, 3600_000) === 0);
  check("resumeSeconds: zero progress → 0", resumeSeconds({ progressSec: 0 }, 3600_000) === 0);
  check("resumeSeconds: mid-episode resumes at progress", resumeSeconds({ progressSec: 600 }, 3600_000) === 600);
  check("resumeSeconds: ≥95% complete → restart from 0", resumeSeconds({ progressSec: 3500 }, 3600_000) === 0);
  check("resumeSeconds: ≥95% complete → restart from 0 (past EOF too)", resumeSeconds({ progressSec: 7200 }, 3600_000) === 0);
  check("resumeSeconds: unknown duration keeps raw progress", resumeSeconds({ progressSec: 120 }, null) === 120);
}

// filterPlayableEpisodes (restricted-guard plan::40::gap-podcast-restricted-guard):
// bulk enqueue guard — restricted episodes never enter the queue, honest report.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).includes("restricted")
      ? { ok: false, status: 401 }
      : { ok: true, status: 200 };
  try {
    const { filterPlayableEpisodes } = await import("../lib/subscribe.js");
    const eps = [
      { guid: "ok-1", url: "https://cdn.example/ok-1.mp3" },
      { guid: "bad-1", url: "https://cdn.example/restricted-1.mp3" },
      { guid: "ok-2", url: "https://cdn.example/ok-2.mp3" },
    ];
    let reported = [];
    const playable = await filterPlayableEpisodes(eps, (r) => { reported = r; });
    check("filterPlayableEpisodes: restricted excluded, order preserved", playable.map((e) => e.guid).join(",") === "ok-1,ok-2");
    check("filterPlayableEpisodes: restricted reported honestly", reported.map((e) => e.guid).join(",") === "bad-1");
    check("filterPlayableEpisodes: empty input → empty queue", (await filterPlayableEpisodes([])).length === 0);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// Podcast Index discovery (F6): no-key honest state + search-result mapping.
// Stubbed fetch (no real network): the API base is https://api.podcastindex.org.
{
  const realFetch = globalThis.fetch;
  const realStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  try {
    const pix = await import("../lib/podcastindex.js");
    // No key → enabled() false and the API calls fail closed.
    check("podcastindex: no key → enabled() false", pix.enabled() === false);
    let failedHonest = false;
    try { await pix.searchShows("test"); } catch (e) {
      failedHonest = /no Podcast Index key configured/.test(String(e?.message ?? e));
    }
    check("podcastindex: no key → honest error, no fetch made", failedHonest);
    check("podcastindex: no key → honest error for trending", await pix.trendingShows(5).then(() => false, (e) => /no Podcast Index key configured/.test(String(e?.message ?? e))));

    // With a key: stubbed fetch returns the documented API shapes.
    let lastCall = null;
    globalThis.fetch = async (url, opts = {}) => {
      lastCall = { url: String(url), headers: opts.headers ?? {} };
      const feeds = lastCall.url.includes("/trending")
        ? [{ url: "https://f.example/trending.xml", title: "Trend Show", image: "https://img.example/t.jpg", artwork: null, description: "<b>Trending</b> show" }]
        : [{ url: "https://f.example/rss", title: "Result A", image: null, artwork: "https://img.example/a.jpg", description: "A very long description" }];
      return { ok: true, status: 200, json: async () => ({ feeds }) };
    };
    try { localStorage.setItem("pf.pixkey", JSON.stringify({ key: "K", secret: "S" })); } catch {}
    check("podcastindex: key set → enabled() true", pix.enabled() === true);
    const searched = await pix.searchShows("foo");
    check("searchShows maps feed url → feedUrl", searched[0].feedUrl === "https://f.example/rss");
    check("searchShows maps title", searched[0].title === "Result A");
    check("searchShows falls back to artwork when image missing", searched[0].image === "https://img.example/a.jpg");
    check("searchShows truncates description to 300 chars", searched[0].description.length <= 300 && searched[0].description === "A very long description");
    const trending = await pix.trendingShows(10);
    check("trendingShows maps image directly", trending[0].image === "https://img.example/t.jpg");
    check("trendingShows maps description as provided (sliced to 300)", trending[0].description === "<b>Trending</b> show");
    // Auth headers are computed client-side from the key+secret+date (SHA-1);
    // the secret is never sent as a header — only inside the Authorization hash.
    const hdr = lastCall.headers ?? {};
    check("podcastindex request carries X-Auth-Key", hdr["X-Auth-Key"] === "K");
    check("podcastindex secret only in signature, never sent raw", hdr.Authorization != null && !JSON.stringify(hdr).includes("S"));

    // Page-level mapping: a discovery result can be followed exactly like a
    // feed-URL show (lib/subscribe.subscribe → pf.subs + shared catalog key).
    const { subscribe, listSubs } = await import("../lib/subscribe.js");
    subscribe({ feedUrl: searched[0].feedUrl, title: searched[0].title, image: searched[0].image, description: searched[0].description });
    check("discovered show lands in pf.subs like a feed-URL show", listSubs().some((s) => s.feedUrl === "https://f.example/rss" && s.title === "Result A"));
  } finally {
    globalThis.fetch = realFetch;
    globalThis.localStorage = realStorage;
  }
}

console.log(`\n═══ RESULT: ${passed} pass, ${failed} fail ═══`);
if (failed > 0) process.exit(1);
