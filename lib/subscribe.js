/**
 * Podcast subscriptions (F6) — all localStorage with the legacy pf.* prefix:
 *   pf.subs            → [{feedUrl, title, image, subscribedAt}]
 *   pf.played:<guid>   → {at, progressSec} per episode
 *   pf.speed:<feedUrl> → per-show playback rate (NowPlayingOverlay writes it)
 *
 * Refresh is MANUAL ONLY (documented anti-pattern decision: no background
 * feed polling, no urgency mechanics). The user opens the show and taps
 * refresh; the shared epfeed: snapshot (TTL 36h) makes other peers read the
 * parse instead of repeating it.
 */

const SUBS_KEY = "pf.subs";

export function listSubs() {
  try { return JSON.parse(localStorage.getItem(SUBS_KEY) ?? "[]") ?? []; } catch { return []; }
}

/** Subscribe to a show; idempotent. */
export function subscribe(show) {
  try {
    const subs = listSubs().filter((s) => s.feedUrl !== show.feedUrl);
    subs.unshift({ ...show, subscribedAt: Date.now() });
    localStorage.setItem(SUBS_KEY, JSON.stringify(subs.slice(0, 200)));
  } catch {}
}

/** Unsubscribe (keeps played markers — history is honest). */
export function unsubscribe(feedUrl) {
  try {
    localStorage.setItem(SUBS_KEY, JSON.stringify(listSubs().filter((s) => s.feedUrl !== feedUrl)));
  } catch {}
}

export function isSubscribed(feedUrl) {
  return listSubs().some((s) => s.feedUrl === feedUrl);
}

/** Played/progress marker for one episode. */
export function markPlayed(guid, progressSec = null) {
  try { localStorage.setItem(`pf.played:${guid}`, JSON.stringify({ at: Date.now(), progressSec })); } catch {}
}

export function playedInfo(guid) {
  try { return JSON.parse(localStorage.getItem(`pf.played:${guid}`) ?? "null"); } catch { return null; }
}

/** Converts a parsed feed's episodes into playable tracks (player contract). */
export function episodesToTracks(episodes) {
  return episodes.map((ep) => ({
    id: ep.guid,
    title: ep.title,
    artist: ep.feedUrl,
    url: ep.url,
    format: ep.type || "podcast",
    duration: ep.durationMs ? Math.round(ep.durationMs / 1000) : null,
    medium: "podcast",
    feedUrl: ep.feedUrl,
    chaptersUrl: ep.chaptersUrl ?? null,
    transcriptUrl: ep.transcriptUrl ?? null,
  }));
}
