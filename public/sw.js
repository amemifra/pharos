/**
 * Pharos service worker (PWA installable — zero servers, static export).
 *
 * Served from public/sw.js → basePath/sw.js on GitHub Pages; everything is
 * derived from self.registration.scope so the same file works at repo root
 * (local build) and under /pharos/ (Pages).
 *
 * Cache strategy (docs/ux-architecture.md "Offline behavior"):
 *   - cache-first  : same-origin immutable assets (/_next/static, icons)
 *   - SWR          : same-origin navigations (pages) — serve cache, refresh
 *   - network-first: cross-origin feed fetches (archive.org RSS) with cache
 *                    fallback so the app opens offline
 *
 * Local notifications WITHOUT any server: the page pushes a sync snapshot
 * (subscribed feeds + per-feed last-seen, mirroring lib/subscribe.js pf.*
 * keys) via postMessage; on periodicsync (tag "pharos-new-episodes", opt-in
 * only) the worker re-fetches each feed, diffs publish dates against the
 * last-seen markers and fires ONE local summary notification with a deep
 * link to /podcast. Where periodicSync is unsupported the page performs the
 * same check on open (lib/notify.js). iOS: standalone install only, no Web
 * Push — documented fallback, never a broken promise.
 *
 * The pure diff logic (pickNewEpisodes) is exported for node tests
 * (tests/e2e/pwa-probe.mjs) — behavior gates never run on real network.
 */

const STATIC_CACHE = "pharos-static-v1";
const PAGES_CACHE = "pharos-pages-v1";
const FEEDS_CACHE = "pharos-feeds-v1";
const SYNC_CACHE = "pharos-sync-v1";
const SYNC_TAG = "pharos-new-episodes";
const SYNC_KEY = "pharos:sync-state";
/** Cap: at most this many feeds per background check (bounded work). */
const SYNC_FEED_CAP = 10;

/** Trailing-slash base path derived from the SW scope. */
function basePath() {
  const p = new URL(self.registration.scope).pathname;
  return p.endsWith("/") ? p : p + "/";
}

/* ---------- pure logic (node-testable) ---------- */

/** First <pubDate> (epoch ms) + guid of an RSS document. */
function firstItemOf(xml) {
  const item = /<item[\s>][\s\S]*?<\/item>/i.exec(xml)?.[0] ?? "";
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(item)?.[1] ?? "")
    .replace(/<!\[CDATA\[|\]\]>/g, "").trim();
  const guid = (/<guid[^>]*>([\s\S]*?)<\/guid>/i.exec(item)?.[1] ?? "")
    .replace(/<!\[CDATA\[|\]\]>/g, "").trim();
  const pub = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i.exec(item)?.[1] ?? "";
  const pubDateMs = pub ? Date.parse(pub.trim()) : NaN;
  return { guid, title, pubDateMs: Number.isFinite(pubDateMs) ? pubDateMs : 0 };
}

/**
 * Pure diff: which subscribed feeds have a newest episode newer than their
 * last-seen marker. @returns [{feedUrl, title, pubDateMs, guid}]
 */
function pickNewEpisodes(snapshot, latest) {
  const out = [];
  const lastSeen = snapshot?.lastSeen ?? {};
  for (const l of latest ?? []) {
    if (!l?.feedUrl || !(l.pubDateMs > 0)) continue;
    if (l.pubDateMs > (Number(lastSeen[l.feedUrl]) || 0)) {
      out.push({ feedUrl: l.feedUrl, title: l.title ?? "", pubDateMs: l.pubDateMs, guid: l.guid ?? "" });
    }
  }
  return out;
}

/* ---------- sync state (page → worker via postMessage) ---------- */

async function saveSyncState(state) {
  const cache = await caches.open(SYNC_CACHE);
  await cache.put(
    new Request(basePath() + SYNC_KEY),
    new Response(JSON.stringify({ subs: [], lastSeen: {}, ...state, at: Date.now() }), {
      headers: { "content-type": "application/json" },
    }),
  );
}

async function readSyncState() {
  try {
    const cache = await caches.open(SYNC_CACHE);
    const res = await cache.match(basePath() + SYNC_KEY);
    return res ? await res.json() : null;
  } catch { return null; }
}

/** One bounded background check: fetch → diff → notify → persist lastSeen. */
async function runSyncCheck(reason = "manual") {
  const state = await readSyncState();
  if (!state?.subs?.length) return { checked: 0, notified: false };
  const subs = state.subs.slice(0, SYNC_FEED_CAP);
  const latest = [];
  let checked = 0;
  for (const s of subs) {
    if (!s?.feedUrl) continue;
    try {
      const res = await fetch(s.feedUrl, { credentials: "omit", redirect: "follow" });
      if (!res.ok) continue;
      const xml = await res.text();
      latest.push({ feedUrl: s.feedUrl, ...firstItemOf(xml) });
      try {
        const fc = await caches.open(FEEDS_CACHE);
        await fc.put(s.feedUrl, res.clone());
      } catch { /* opaque responses may reject clone — the parse already succeeded */ }
      checked++;
    } catch {
      try {
        const fc = await caches.open(FEEDS_CACHE);
        const res = await fc.match(s.feedUrl);
        if (res) { latest.push({ feedUrl: s.feedUrl, ...firstItemOf(await res.text()) }); checked++; }
      } catch { /* offline and uncached: skip this feed */ }
    }
  }
  const fresh = pickNewEpisodes(state, latest);
  if (fresh.length) {
    const shows = new Set(fresh.map((f) => f.title || f.feedUrl)).size;
    await self.registration.showNotification("Pharos — new episodes", {
      body: `${fresh.length} new episode${fresh.length === 1 ? "" : "s"} across ${shows} show${shows === 1 ? "" : "s"} you follow.`,
      icon: basePath() + "icons/icon-192.png",
      badge: basePath() + "icons/icon-192.png",
      tag: SYNC_TAG, // one summary notification, never a burst
      data: { url: basePath() + "podcast/" },
    });
    const lastSeen = { ...(state.lastSeen ?? {}) };
    for (const f of fresh) lastSeen[f.feedUrl] = f.pubDateMs;
    await saveSyncState({ ...state, lastSeen });
  }
  return { checked, notified: fresh.length > 0, fresh: fresh.length, reason };
}

/* ---------- lifecycle (only when running as a real service worker) ---------- */

if (typeof self !== "undefined" && typeof self.registration !== "undefined") {
  self.addEventListener("install", (event) => {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(PAGES_CACHE);
        // Offline shell: the app root. Pages fill SWR afterwards.
        await cache.addAll([basePath(), basePath() + "podcast/"]).catch(() => {});
        await self.skipWaiting();
      })(),
    );
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const keep = new Set([STATIC_CACHE, PAGES_CACHE, FEEDS_CACHE, SYNC_CACHE]);
        for (const name of await caches.keys()) {
          if (!keep.has(name)) await caches.delete(name); // versioned cleanup
        }
        await self.clients.claim();
      })(),
    );
  });

  self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    const base = basePath();

    if (url.origin === self.location.origin) {
      // Cache-first: immutable build assets + icons.
      if (url.pathname.startsWith(base + "_next/static/") || url.pathname.startsWith(base + "icons/")) {
        event.respondWith(
          caches.open(STATIC_CACHE).then(async (cache) => {
            const hit = await cache.match(req);
            if (hit) return hit;
            const res = await fetch(req);
            if (res.ok) cache.put(req, res.clone());
            return res;
          }),
        );
        return;
      }
      // SWR: navigations (static-export pages) — serve cached, refresh behind.
      if (req.mode === "navigate") {
        event.respondWith(
          (async () => {
            const cache = await caches.open(PAGES_CACHE);
            const cached = await cache.match(req, { ignoreSearch: false }) ?? await cache.match(basePath());
            const network = fetch(req).then(async (res) => {
              if (res.ok) cache.put(req, res.clone());
              return res;
            }).catch(() => null);
            if (cached) {
              event.waitUntil(network);
              return cached;
            }
            return (await network) ?? cache.match(basePath()) ?? Response.error();
          })(),
        );
        return;
      }
      return; // other same-origin requests: default (network, no caching)
    }

    // Network-first with cache fallback: feed fetches so the app opens offline.
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) {
            try {
              const cache = await caches.open(FEEDS_CACHE);
              await cache.put(req, res.clone());
            } catch { /* opaque/clone edge: ignore */ }
          }
          return res;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          throw new Error("offline and uncached");
        }
      })(),
    );
  });

  self.addEventListener("message", (event) => {
    const msg = event.data ?? {};
    if (msg.type === "pharos:sync-state") {
      event.waitUntil(saveSyncState(msg.state ?? {}).then(() => {
        event.source?.postMessage({ type: "pharos:sync-state-ok" });
      }));
    } else if (msg.type === "pharos:run-check") {
      event.waitUntil(runSyncCheck("message").then((r) => {
        event.source?.postMessage({ type: "pharos:check-result", result: r });
      }));
    } else if (msg.type === "pharos:skip-waiting") {
      self.skipWaiting();
    }
  });

  // Opt-in periodic check (only where the API exists; else check-on-open).
  self.addEventListener("periodicsync", (event) => {
    if (event.tag === SYNC_TAG) event.waitUntil(runSyncCheck("periodicsync"));
  });

  self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const target = event.notification.data?.url ?? basePath() + "podcast/";
    event.waitUntil(
      (async () => {
        const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of all) {
          if (client.url.includes(new URL(target, self.location.origin).pathname)) {
            await client.focus();
            client.postMessage({ type: "pharos:navigate", url: target });
            return;
          }
        }
        await self.clients.openWindow(target);
      })(),
    );
  });
}

/* ---------- node-testable exports (classic script guard) ---------- */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { firstItemOf, pickNewEpisodes };
}
