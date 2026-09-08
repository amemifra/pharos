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

/** Subscribe to a show; idempotent. Also publishes the show to the SHARED
 *  podcast registry (OrbitDB via the catalog layer, additive merge): shows
 *  added by any peer become part of the app's collective catalog — the same
 *  data plane the charts (podchart:) already use.
 *  Contract: pure side effect; never throws; P2P failure degrades to local. */
export function subscribe(show) {
  try {
    const subs = listSubs().filter((s) => s.feedUrl !== show.feedUrl);
    subs.unshift({ ...show, subscribedAt: Date.now() });
    localStorage.setItem(SUBS_KEY, JSON.stringify(subs.slice(0, 200)));
    publishCommunityShow(show);
  } catch {}
}

/** Additive merge into the shared `podsubs` registry (counts-only consensus
 *  style: republishing the same feed just bumps `at`). Never throws. */
function publishCommunityShow(show) {
  if (!show?.feedUrl) return;
  import("./catalogstore.js").then(async ({ catalogGet, catalogSet }) => {
    const shared = (await catalogGet("podsubs")) ?? {};
    shared[show.feedUrl] = {
      title: show.title ?? "",
      image: show.image ?? null,
      description: String(show.description ?? "").slice(0, 300),
      at: Date.now(),
    };
    // Footprint cap: 2000 most recently touched shows.
    const entries = Object.entries(shared).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).slice(0, 2000);
    await catalogSet("podsubs", Object.fromEntries(entries));
  }).catch(() => {});
}

/**
 * Community registry: shows added by any peer (shared OrbitDB catalog).
 * @returns {Promise<{feedUrl: string, title: string, image: string|null}[]>}
 */
export async function communityShows() {
  try {
    const { catalogGet } = await import("./catalogstore.js");
    const shared = (await catalogGet("podsubs")) ?? {};
    return Object.entries(shared)
      .map(([feedUrl, s]) => ({ feedUrl, title: s?.title ?? feedUrl, image: s?.image ?? null }))
      .sort((a, b) => (shared[b.feedUrl]?.at ?? 0) - (shared[a.feedUrl]?.at ?? 0));
  } catch {
    return [];
  }
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

/**
 * Last-seen marker per subscribed feed (owner: “sezione nuovi episodi”).
 * Written when the user VISITS the show page; the landing page compares each
 * feed's newest episode against it to count/list what's genuinely new.
 *   pf.subseen:<feedUrl> → epoch ms
 */
export function markFeedSeen(feedUrl, ms = Date.now()) {
  try { localStorage.setItem(`pf.subseen:${feedUrl}`, JSON.stringify(ms)); } catch {}
}

export function feedLastSeen(feedUrl) {
  try { return Number(JSON.parse(localStorage.getItem(`pf.subseen:${feedUrl}`) ?? "0")) || 0; } catch { return 0; }
}

/** Converts a parsed feed's episodes into playable tracks (player contract). */
/** True when the episode's enclosure is a video file (honest UI label:
 *  the island player is audio-only for now — it plays the audio track). */
export function isVideoEnclosure(ep) {
  return String(ep?.type ?? "").startsWith("video/") || /\.(m4v|mp4|webm|mov)(\?|#|$)/i.test(ep?.url ?? "");
}

export function episodesToTracks(episodes, showImage = null) {
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
    // Show artwork (feed itunes:image) — resolved from the catalog-cached
    // feed snapshot, so the player shows the real cover with ZERO extra
    // network calls (owner: covers/metadata live in the shared catalog with
    // a long lifecycle; refetches are the source of CORS flakes).
    cover: showImage ?? null,
    // Video podcasts (owner: legal via RSS enclosures — same distribution as
    // audio, publisher's own CDN). The island player is audio-only for now:
    // flagged so the UI can label honestly instead of pretending.
    video: isVideoEnclosure(ep),
  }));
}
