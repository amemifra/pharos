/**
 * New-episode local notifications (PWA installable) — zero servers, opt-in.
 *
 * Mirrors lib/subscribe.js storage (pf.subs, pf.subseen:<feedUrl>) and the
 * documented manual-refresh decision: NOTHING runs until the user enables
 * the toggle with an explicit gesture (permission is requested inside that
 * click, never on page load). When enabled:
 *   1. On app open: diff each subscribed feed's newest episode against the
 *      last-seen marker (same "sezione nuovi episodi" semantics as the
 *      podcast page) and fire one local summary Notification.
 *   2. Push a sync snapshot to the service worker and register
 *      periodicSync (tag pharos-new-episodes) where supported, so the check
 *      also runs while the app is closed. Unsupported browsers (incl. iOS
 *      standalone) degrade silently to check-on-open.
 *
 * The service worker shows the notification (it survives page teardown);
 * the page only updates the last-seen markers after a successful check.
 * Contract: never throws; a failed check is a silent no-op.
 */

import { BASE_PATH, assetPath } from "./basepath";
import { listSubs, feedLastSeen, markFeedSeen } from "./subscribe";

const NOTIFY_KEY = "pf.notify";
export const SYNC_TAG = "pharos-new-episodes";

/** Toggle state: {enabled:boolean, at:number} — default OFF. */
export function notifyState() {
  try {
    const s = JSON.parse(localStorage.getItem(NOTIFY_KEY) ?? "null");
    return s && typeof s.enabled === "boolean" ? s : { enabled: false, at: 0 };
  } catch { return { enabled: false, at: 0 }; }
}

export function setNotifyEnabled(enabled) {
  try { localStorage.setItem(NOTIFY_KEY, JSON.stringify({ enabled: !!enabled, at: Date.now() })); } catch {}
}

/** Active SW registration, or null (never throws). */
export async function swRegistration() {
  try {
    if (!("serviceWorker" in navigator)) return null;
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch { return null; }
}

/** Register the service worker (idempotent; call once from the shell). */
export function registerServiceWorker() {
  try {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(assetPath("/sw.js")).catch(() => {});
  } catch {}
}

/** Snapshot for the worker: subscribed feeds + last-seen markers. */
function syncSnapshot() {
  const subs = listSubs().slice(0, 10).map((s) => ({ feedUrl: s.feedUrl, title: s.title ?? "" }));
  const lastSeen = {};
  for (const s of subs) lastSeen[s.feedUrl] = feedLastSeen(s.feedUrl);
  return { subs, lastSeen };
}

/** Push the snapshot to the SW (feeds + lastSeen) for periodicSync use. */
async function pushSyncState() {
  const reg = await swRegistration();
  if (!reg?.active) return;
  try { reg.active.postMessage({ type: "pharos:sync-state", state: syncSnapshot() }); } catch {}
}

/** Register the opt-in periodic sync (graceful: no-op where unsupported). */
async function registerPeriodicSync() {
  try {
    const reg = await swRegistration();
    if (reg && "periodicSync" in reg) {
      const status = await navigator.permissions?.query({ name: "periodic-background-sync" });
      if (!status || status.state === "granted") {
        await reg.periodicSync.register(SYNC_TAG, { minInterval: 12 * 60 * 60 * 1000 });
      }
    }
  } catch { /* unsupported → check-on-open only */ }
}

export function unregisterPeriodicSync() {
  try {
    swRegistration().then((reg) => reg?.periodicSync?.unregister(SYNC_TAG)).catch(() => {});
  } catch {}
}

/** Show the summary notification from the page context (used on open). */
async function showSummary(fresh) {
  const reg = await swRegistration();
  if (!reg) return false;
  try {
    await reg.showNotification("Pharos — new episodes", {
      body: `${fresh.length} new episode${fresh.length === 1 ? "" : "s"} across ${new Set(fresh.map((f) => f.showTitle || f.feedUrl)).size} show${new Set(fresh.map((f) => f.showTitle || f.feedUrl)).size === 1 ? "" : "s"} you follow.`,
      icon: assetPath("/icons/icon-192.png"),
      badge: assetPath("/icons/icon-192.png"),
      tag: SYNC_TAG,
      data: { url: BASE_PATH + "/podcast/" },
    });
    return true;
  } catch { return false; }
}

/**
 * Check-on-open: for each subscribed feed, load the (cached, TTL'd) feed via
 * lib/podcast.loadFeed — the SAME read path the podcast page uses — diff the
 * newest publish date against pf.subseen:<feedUrl>, fire one summary
 * notification, then advance the markers so a visiting the page doesn't
 * double-count. Bounded: newest 10 feeds. Returns {checked, notified}.
 */
export async function checkNewEpisodesOnOpen() {
  const state = notifyState();
  if (!state.enabled) return { checked: 0, notified: false };
  const reg = await swRegistration();
  if (!reg || (Notification?.permission !== "granted")) {
    console.debug("[pharos:notify] skip check:", { reg: !!reg, permission: Notification?.permission });
    return { checked: 0, notified: false };
  }
  const { loadFeed } = await import("./podcast");
  const subs = listSubs().slice(0, 10);
  const fresh = [];
  let checked = 0;
  for (const s of subs) {
    if (!s?.feedUrl) continue;
    try {
      const feed = await loadFeed(s.feedUrl); // shared epfeed snapshot (TTL 36h)
      const newest = (feed.episodes ?? []).reduce((m, ep) => Math.max(m, Number(ep.pubDateMs) || 0), 0);
      if (newest > feedLastSeen(s.feedUrl)) {
        fresh.push({ feedUrl: s.feedUrl, showTitle: feed.show?.title ?? s.title ?? "", pubDateMs: newest });
      }
      checked++;
    } catch (e) { console.debug("[pharos:notify] feed check failed:", s.feedUrl, String(e).slice(0, 120)); /* one dead feed must not hide the others */ }
  }
  let notified = false;
  if (fresh.length) notified = await showSummary(fresh);
  for (const f of fresh) markFeedSeen(f.feedUrl, f.pubDateMs);
  return { checked, notified };
}

/* ---------- build update notice (non-looping) ---------- */

/** Handler invoked AT MOST ONCE per build version change (set by the shell). */
let updateHandler = null;

export function onUpdateNotice(fn) { updateHandler = typeof fn === "function" ? fn : null; }

/** The build version inlined into THIS page bundle (null on dev). */
function pageBuildVersion() {
  const v = process.env.NEXT_PUBLIC_PHAROS_BUILD ?? null;
  return v && v !== "dev" ? v : null;
}

/** Ask the active controller for its build version (null if unavailable). */
function activeSwVersion() {
  return new Promise((resolve) => {
    try {
      const ctl = navigator.serviceWorker.controller;
      if (!ctl) return resolve(null);
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(null), 1500);
      ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data?.version ?? null); };
      ctl.postMessage({ type: "pharos:get-version" }, [ch.port2]);
    } catch { resolve(null); }
  });
}

/** Keep only the current version's seen marker (bounded localStorage). */
function pruneSeenKeys(current) {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("pf.updateNoticeSeen:") && k !== `pf.updateNoticeSeen:${current}`) {
        localStorage.removeItem(k);
      }
    }
  } catch {}
}

/**
 * Show the notice AT MOST ONCE per PAGE build version — the single guard
 * used by every trigger (controller change, version mismatch). When the
 * page build is unknown (old bundle) fall back to a once-per-page-session
 * guard so the notice can never loop.
 */
function showUpdateNoticeOnce() {
  try {
    const pageVersion = pageBuildVersion();
    if (pageVersion) {
      const key = `pf.updateNoticeSeen:${pageVersion}`;
      if (localStorage.getItem(key)) return false;
      localStorage.setItem(key, String(Date.now()));
      pruneSeenKeys(pageVersion);
    } else {
      if (sessionStorage.getItem("pf.updateNoticeShown")) return false;
      sessionStorage.setItem("pf.updateNoticeShown", "1");
    }
  } catch { return false; }
  updateHandler?.();
  return true;
}

let watchInstalled = false;
let hadControllerAtLoad = null;

/**
 * Non-looping update notice: when a NEW service worker version takes control
 * of a page that was ALREADY controlled at load (a real update, not the
 * first install/claim), notify once — guarded by the new build's version so
 * a reload after the notice never shows it again, and the shell reload keeps
 * the user on the new build with zero further prompts.
 * Contract: never throws; at most one notice per version change, ever.
 */
export function watchForUpdates() {
  try {
    if (!("serviceWorker" in navigator) || watchInstalled) return;
    watchInstalled = true;
    // Capture BEFORE the SW registers: first-claim controllerchange (no prior
    // controller) is not an update and must never notify.
    hadControllerAtLoad = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadControllerAtLoad) return; // first claim, not an update
      hadControllerAtLoad = false; // this update is now consumed
      showUpdateNoticeOnce();
    });
  } catch {}
}

/**
 * One-notice-per-build-version guard: compare the PAGE build (inlined by
 * next.config.mjs at build time) against the service worker's build. Any
 * mismatch means a new deploy landed (page newer than the SW, or the SW
 * updated before a reload) — show the notice ONCE per page build version;
 * the localStorage marker makes a reload on the same version silent.
 */
async function verifyBuildVersion() {
  try {
    const pageVersion = process.env.NEXT_PUBLIC_PHAROS_BUILD ?? null;
    if (!pageVersion || pageVersion === "dev") return; // dev server: no build pairing
    // Give the worker a beat to register/activate before the comparison.
    const reg = await Promise.race([
      navigator.serviceWorker.ready.catch(() => null),
      new Promise((r) => setTimeout(() => r(null), 5000)),
    ]);
    if (!reg?.active) return;
    // Ask the browser to check for a newer worker right away (standard
    // practice): without this the update check can be deferred for hours.
    try { reg.update().catch(() => {}); } catch {}
    // A new build may arrive LATER in the page's life: when the browser's
    // navigation update-check installs a new worker it first sits in
    // "waiting" — surface it as soon as it appears (bounded poll).
    if (reg.waiting) showUpdateNoticeOnce();
    else {
      const t0 = Date.now();
      const poll = setInterval(() => {
        try {
          if (reg.waiting) { clearInterval(poll); showUpdateNoticeOnce(); }
          else if (Date.now() - t0 > 60_000) clearInterval(poll);
        } catch { clearInterval(poll); }
      }, 1000);
    }
    const swVersion = await activeSwVersion();
    if (!swVersion) return; // old worker without version support: stay silent
    // A new build has landed when the active worker's build differs from
    // this page's build.
    if (swVersion !== pageVersion) showUpdateNoticeOnce();
  } catch {}
}

/**
 * Full boot sequence (call from the shell on mount): register the SW, then
 * — only if the user opted in — run the check-on-open and refresh the SW
 * snapshot + periodicSync registration. Never prompts: permission was (or
 * will be) granted only inside the toggle's click handler.
 */
export async function bootNotifications() {
  watchForUpdates();
  registerServiceWorker();
  verifyBuildVersion().catch(() => {});
  const state = notifyState();
  if (!state.enabled) return;
  // Give the SW a beat to activate before messaging it.
  const reg = await swRegistration();
  if (reg && !reg.active) await new Promise((r) => setTimeout(r, 500));
  await checkNewEpisodesOnOpen();
  await pushSyncState();
  await registerPeriodicSync();
}

/**
 * Toggle click handler (the ONLY place Notification.requestPermission is
 * ever called — inside the user gesture, per the no-prompt-on-load rule).
 * Returns the resulting enabled state (false if permission denied).
 */
export async function toggleNotifications(enable) {
  if (!enable) {
    setNotifyEnabled(false);
    unregisterPeriodicSync();
    return false;
  }
  let permission = Notification?.permission ?? "denied";
  try {
    if (permission === "default") permission = await Notification.requestPermission();
  } catch { permission = "denied"; }
  if (permission !== "granted") { setNotifyEnabled(false); return false; }
  setNotifyEnabled(true);
  await pushSyncState();
  await registerPeriodicSync();
  return true;
}
