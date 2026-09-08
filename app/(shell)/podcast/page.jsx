"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { loadFeed, relativeDate, bigArt, weeklyListeningHours } from "@/lib/podcast";
import { TOP_NATIONS, topPodcasts, resolveFeedUrl, listenStats } from "@/lib/podcastcharts";
import { listSubs, subscribe, unsubscribe, isSubscribed, playedInfo, episodesToTracks, communityShows, isVideoEnclosure, markFeedSeen, feedLastSeen } from "@/lib/subscribe";
import { usePlayer } from "@/components/PlayerProvider";
import Icon from "@/components/Icon";

/**
 * Podcast show page (F6) — reverse-chronological episodes, played dots,
 * subscribe/unsubscribe, "play all unplayed". Data path: epfeed: snapshot
 * (P2P-shared, 36h TTL) → direct RSS with declared CORS-proxy fallback.
 * Refresh is manual only: a button, never background polling.
 */
function PodcastPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const feedUrl = params.get("url") ? decodeURIComponent(params.get("url")) : "";
  const { playQueue } = usePlayer();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [subs, setSubs] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [played, setPlayed] = useState({});
  // isPlayable wiring (P1 residuo): episodes whose enclosure HEAD-checks as
  // restricted (401/403) or dead are never queued — honest label instead.
  const [unplayable, setUnplayable] = useState({});
  const [checking, setChecking] = useState(null);

  const load = async (force = false) => {
    setError(null);
    if (force) setRefreshing(true);
    try {
      // force → bypass the 36h snapshot by cache-busting the request path.
      const d = force
        ? await import("@/lib/podcast").then(async (m) => {
            const xml = await m.fetchFeedXml(feedUrl);
            return { ...m.parseFeed(xml, feedUrl), source: "network" };
          })
        : await loadFeed(feedUrl);
      setData(d);
      const map = {};
      for (const ep of d.episodes) { const p = playedInfo(ep.guid); if (p) map[ep.guid] = p; }
      setPlayed(map);
    } catch (e) {
      setError(String(e?.message ?? e));
    }
    setRefreshing(false);
  };

  useEffect(() => {
    setSubs(listSubs());
    if (feedUrl) {
      load(false);
      // Last-seen marker (owner: “new episodes” section on the landing):
      // visiting the show marks its episodes as seen.
      markFeedSeen(feedUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedUrl]);

  const tracks = useMemo(() => (data ? episodesToTracks(data.episodes, data.show?.image ?? null) : []), [data]);
  const firstUnplayed = useMemo(() => {
    if (!data) return 0;
    const i = data.episodes.findIndex((ep) => !played[ep.guid]);
    return i === -1 ? 0 : i;
  }, [data, played]);

  if (!feedUrl) {
    // Navigation via router (next/navigation): basePath-aware. Plain
    // window.location/anchor hrefs drop the /pharos base → GitHub Pages 404.
    const open = (u) => router.push(`/podcast?url=${encodeURIComponent(u)}`);
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* Podcast-platform header (restyle): compact hero, one-line promise */}
        <header className="mb-8 rounded-2xl bg-gradient-to-r from-emerald-900/60 via-zinc-900 to-zinc-950 px-6 py-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400/90">Podcasts</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Your shows, in one place</h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-400">
            Follow shows by RSS, get new episodes as they drop, and browse the charts. Listening time is the only metric we count — never plays.
          </p>
        </header>

        {/* NEW EPISODES (owner): what dropped since the last visit per show */}
        <NewEpisodesSection subs={subs} onOpen={open} />

        {/* LATEST RELEASES (owner): newest drops across followed (or top chart) shows */}
        <LatestReleasesSection subs={subs} onOpen={open} />

        <YourShowsSection subs={subs} onOpen={open} onChange={setSubs} />

        <AddFeedForm onOpen={open} />
        <CommunitySection onOpen={open} />
        <ChartsSection onOpen={open} />
      </main>
    );
  }

  const subbed = isSubscribed(feedUrl);
  const loading = !data && !error;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {error && (
        <div className="mb-4 rounded-lg border border-red-800/50 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          Feed could not be loaded ({error}). The CORS fallback chain was tried.
          <button onClick={() => load(true)} className="ml-3 rounded-full border border-red-700/60 px-3 py-0.5 text-xs font-semibold hover:bg-red-500/20">
            Retry
          </button>
        </div>
      )}
      {loading && (
        <div aria-busy="true">
          <div className="flex items-start gap-5">
            <div className="h-28 w-28 shrink-0 animate-pulse rounded-xl bg-zinc-900" />
            <div className="min-w-0 flex-1 space-y-3 pt-2">
              <div className="h-3 w-20 animate-pulse rounded bg-zinc-900" />
              <div className="h-7 w-3/4 animate-pulse rounded bg-zinc-900" />
              <div className="h-4 w-full animate-pulse rounded bg-zinc-900" />
              <div className="h-8 w-40 animate-pulse rounded-full bg-zinc-900" />
            </div>
          </div>
          <p className="mt-10 text-sm text-zinc-500">Loading episodes… (feeds without CORS go through a public proxy — this can take a few seconds)</p>
          <div className="mt-4 space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-zinc-900/70" />
            ))}
          </div>
        </div>
      )}
      {data && (
        <header className="-mx-4 md:-mx-0 bg-gradient-to-b from-emerald-900/60 via-zinc-900/40 to-transparent px-4 md:px-8 pt-8 pb-6">
          <div className="mx-auto flex max-w-3xl items-start gap-5">
            {data.show.image && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={bigArt(data.show.image) ?? data.show.image} alt="" className="h-32 w-32 shrink-0 rounded-xl object-cover shadow-2xl shadow-black/50 md:h-40 md:w-40" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400/90">Podcast</p>
              <h1 className="mt-1 truncate text-2xl font-extrabold tracking-tight md:text-3xl">{data.show.title}</h1>
              <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{data.show.description}</p>
              <p className="mt-1 text-xs text-zinc-600">{data.episodes.length} episodes · {subbed ? "in your shows" : "not followed"}</p>
            </div>
          </div>
          <div className="mx-auto mt-4 flex max-w-3xl flex-wrap items-center gap-2">
            <button
              onClick={() => { subbed ? unsubscribe(feedUrl) : subscribe(data.show); setSubs(listSubs()); }}
              className={`rounded-full px-5 py-2 text-xs font-semibold ${
                subbed ? "border border-zinc-700 text-zinc-300 hover:border-zinc-500" : "bg-emerald-600 text-white hover:bg-emerald-500"
              }`}
            >
              {subbed ? "✓ In your shows" : "+ Follow"}
            </button>
            {tracks.length > 0 && (
              <button
                onClick={() => playQueue(tracks, firstUnplayed)}
                className="rounded-full border border-zinc-700 px-5 py-2 text-xs font-semibold text-zinc-300 hover:text-white"
              >
                ▶ Play
              </button>
            )}
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="rounded-full border border-zinc-700 px-5 py-2 text-xs font-semibold text-zinc-400 hover:text-white disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <span className="text-[11px] text-zinc-600">
              {data.source === "cache" ? "shared snapshot" : "fetched live"}
            </span>
          </div>
        </header>
      )}

      {data && (
        <ol className="mt-8 divide-y divide-zinc-800/60 rounded-xl bg-zinc-900/50" aria-label="Episodes">
          {data.episodes.length === 0 && (
            <li className="px-4 py-6 text-sm text-zinc-500">This feed has no episodes.</li>
          )}
          {data.episodes.map((ep) => {
            const p = played[ep.guid];
            const isPlayed = !!p?.progressSec;
            const dead = unplayable[ep.guid];
            return (
              <li key={ep.guid}>
                <button
                  onClick={async () => {
                    if (dead || checking === ep.guid) return;
                    // Restricted/dead guard (lib/podcast.isPlayable): a 401/403
                    // enclosure is treated exactly like a lending-restricted
                    // archive item — never queued, honest feedback instead.
                    setChecking(ep.guid);
                    try {
                      const { isPlayable } = await import("@/lib/podcast");
                      if (!(await isPlayable(ep))) {
                        setUnplayable((m) => ({ ...m, [ep.guid]: true }));
                        return;
                      }
                      const t = episodesToTracks([ep], data?.show?.image ?? null);
                      markPlayedAndPlay(ep, p, playQueue, t);
                    } finally {
                      setChecking(null);
                    }
                  }}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left ${dead ? "opacity-50" : "hover:bg-zinc-800/60"}`}
                >
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${isPlayed ? "bg-emerald-500" : "border border-zinc-600"}`} aria-label={isPlayed ? "played" : "unplayed"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{ep.title}</span>
                    <span className="mt-0.5 block text-xs text-zinc-500">
                      {dead ? (
                        <span className="text-amber-400">🔒 unavailable — the publisher restricts this episode (401/403)</span>
                      ) : checking === ep.guid ? (
                        "checking availability…"
                      ) : (
                        <>
                          {relativeDate(ep.pubDateMs)}
                          {ep.durationMs ? ` · ${Math.round(ep.durationMs / 60000)} min` : ""}
                          {isVideoEnclosure(ep) ? " · video podcast" : ""}
                        </>
                      )}
                    </span>
                  </span>
                  <Icon name={dead ? "close" : "play"} className="mt-1 h-4 w-4 text-zinc-500" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}

/** Marks the episode started and plays it (progress tracked by the player). */
async function markPlayedAndPlay(ep, prev, playQueue, track) {
  const { markPlayed } = await import("@/lib/subscribe");
  markPlayed(ep.guid, prev?.progressSec ?? 0);
  playQueue(track, 0);
}

/**
 * NEW EPISODES (owner): episodes dropped since the user last visited each
 * followed show (pf.subseen:<feedUrl> markers, lib/subscribe.js). Feeds come
 * from the shared epfeed: snapshot (36h TTL) — repeats are cheap, no polling.
 */
function NewEpisodesSection({ subs, onOpen }) {
  const { playQueue } = usePlayer();
  const [items, setItems] = useState(null); // null = loading
  useEffect(() => {
    let alive = true;
    if (!subs.length) { setItems([]); return; }
    setItems(null);
    (async () => {
      const out = [];
      // Bounded: newest 20 subs, concurrency 3, one feed parse each (cached).
      for (const s of subs.slice(0, 20)) {
        try {
          const feed = await loadFeed(s.feedUrl);
          const seen = feedLastSeen(s.feedUrl);
          const fresh = feed.episodes.filter((ep) => ep.pubDateMs > seen);
          for (const ep of fresh.slice(0, 5)) out.push({ show: feed.show ?? s, ep, feedUrl: s.feedUrl });
        } catch { /* one dead feed must not hide the others */ }
        if (!alive) return;
      }
      out.sort((a, b) => (b.ep.pubDateMs ?? 0) - (a.ep.pubDateMs ?? 0));
      if (alive) setItems(out.slice(0, 20));
    })();
    return () => { alive = false; };
  }, [subs]);

  if (!subs.length) return null; // YourShowsSection explains HOW to follow
  const play = (item) => {
    const t = episodesToTracks([item.ep], item.show?.image ?? null);
    import("@/lib/subscribe").then((m) => m.markPlayed(item.ep.guid, 0));
    playQueue(t, 0);
  };
  return (
    <section className="mb-10" aria-label="New episodes">
      <h2 className="mb-4 text-xl font-bold tracking-tight">New episodes</h2>
      {items === null && <p className="text-sm text-zinc-500">Checking your shows for new episodes…</p>}
      {items?.length === 0 && (
        <p className="text-sm text-zinc-500">No new episodes — you are up to date.</p>
      )}
      {items?.length > 0 && (
        <ul className="divide-y divide-zinc-800/60 rounded-xl bg-zinc-900/50">
          {items.map((item) => (
            <li key={`${item.feedUrl}-${item.ep.guid}`} className="flex items-center gap-3 px-4 py-3">
              {item.show?.image && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={bigArt(item.show.image) ?? item.show.image} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-md object-cover" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.ep.title}</span>
                <button onClick={() => onOpen(item.feedUrl)} className="block max-w-full truncate text-left text-xs text-emerald-400/90 hover:underline">
                  {item.show?.title ?? item.feedUrl} · {relativeDate(item.ep.pubDateMs)}
                </button>
              </span>
              <button
                onClick={() => play(item)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-500"
                aria-label={`Play ${item.ep.title}`}
              >
                <Icon name="play" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );}

/**
 * LATEST RELEASES (owner): the newest drops across the shows the user
 * follows — or, with no subscriptions, from the top chart shows of the
 * user's nation (pf.country, default "us"). Release feed, NOT a ranking:
 * ordered strictly by publish date.
 */
function LatestReleasesSection({ subs, onOpen }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let alive = true;
    setItems(null);
    (async () => {
      let sources = subs.slice(0, 10).map((s) => ({ feedUrl: s.feedUrl, title: s.title, image: s.image }));
      if (!sources.length) {
        // No subscriptions yet: fall back to the top chart shows (honest label).
        try {
          let nation = "us";
          try { nation = localStorage.getItem("pf.country") || nation; } catch {}
          const top = (await topPodcasts(nation)).slice(0, 6);
          const resolved = [];
          for (const s of top) {
            const feedUrl = await resolveFeedUrl(s.id).catch(() => null);
            if (feedUrl) resolved.push({ feedUrl, title: s.title, image: s.image });
          }
          sources = resolved;
        } catch { /* charts unavailable: honest empty state below */ }
      }
      const out = [];
      for (const s of sources) {
        try {
          const feed = await loadFeed(s.feedUrl);
          const ep = [...feed.episodes].sort((a, b) => (b.pubDateMs ?? 0) - (a.pubDateMs ?? 0))[0];
          if (ep) out.push({ show: { ...s, ...(feed.show ?? {}) }, ep, feedUrl: s.feedUrl });
        } catch { /* one dead feed must not hide the others */ }
        if (!alive) return;
      }
      out.sort((a, b) => (b.ep.pubDateMs ?? 0) - (a.ep.pubDateMs ?? 0));
      if (alive) setItems(out);
    })();
    return () => { alive = false; };
  }, [subs]);

  const play = (item) => {
    const t = episodesToTracks([item.ep], item.show?.image ?? null);
    import("@/lib/subscribe").then((m) => m.markPlayed(item.ep.guid, 0));
    playQueue(t, 0);
  };
  return (
    <section className="mb-10" aria-label="Latest releases">
      <h2 className="mb-1 text-xl font-bold tracking-tight">Latest releases</h2>
      <p className="mb-4 text-xs text-zinc-600">Newest episode per show, by publish date{subs.length ? "" : " · from the top charts (follow shows to make it yours)"}.</p>
      {items === null && (
        <div className="shelf-scroll flex gap-4 overflow-x-auto pb-2">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-44 w-36 shrink-0 animate-pulse rounded-xl bg-zinc-900" />)}
        </div>
      )}
      {items?.length === 0 && (
        <p className="text-sm text-zinc-500">No releases available right now — the feeds could not be reached.</p>
      )}
      {items?.length > 0 && (
        <div className="shelf-scroll flex gap-4 overflow-x-auto pb-2 -mx-4 px-4">
          {items.map((item) => (
            <div key={`${item.feedUrl}-${item.ep.guid}`} className="w-36 shrink-0 sm:w-40">
              <div className="relative">
                <button onClick={() => onOpen(item.feedUrl)} className="block h-36 w-36 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 sm:h-40 sm:w-40" aria-label={`Open ${item.show?.title ?? "show"}`}>
                  {item.show?.image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={bigArt(item.show.image) ?? item.show.image} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center"><Icon name="podcast" className="h-8 w-8 text-zinc-600" /></span>
                  )}
                </button>
                <button
                  onClick={() => play(item)}
                  className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-500"
                  aria-label={`Play latest episode of ${item.show?.title ?? "show"}`}
                >
                  <Icon name="play" className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 truncate text-xs font-medium text-zinc-300">{item.show?.title}</p>
              <p className="truncate text-[11px] text-zinc-500" title={item.ep.title}>{item.ep.title}</p>
              <p className="text-[11px] text-zinc-600">{relativeDate(item.ep.pubDateMs)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * YOUR SHOWS (restyle): card grid à la podcast platforms — round artwork,
 * title, one-line host, unfollow inline.
 */
function YourShowsSection({ subs, onOpen, onChange }) {
  if (!subs.length) {
    return (
      <section className="mb-10" aria-label="Your shows">
        <h2 className="mb-3 text-xl font-bold tracking-tight">Your shows</h2>
        <p className="text-sm text-zinc-500">
          Nothing followed yet — open a chart entry below and tap <span className="text-emerald-400">+ Follow</span>, or paste an RSS URL. New episodes land here.
        </p>
      </section>
    );
  }
  return (
    <section className="mb-10" aria-label="Your shows">
      <h2 className="mb-4 text-xl font-bold tracking-tight">Your shows · {subs.length}</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
        {subs.map((s) => (
          <div key={s.feedUrl} className="group rounded-xl bg-zinc-900 p-3 transition-colors hover:bg-zinc-800">
            <button onClick={() => onOpen(s.feedUrl)} className="block w-full" aria-label={`Open ${s.title}`}>
              <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-full bg-zinc-800">
                {s.image ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={bigArt(s.image) ?? s.image} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <Icon name="podcast" className="h-8 w-8 text-zinc-600" />
                )}
              </span>
              <span className="mt-2 block truncate text-sm font-medium">{s.title}</span>
              <span className="block truncate text-xs text-zinc-500">Show</span>
            </button>
            <button
              onClick={() => { unsubscribe(s.feedUrl); onChange(listSubs()); }}
              className="mt-1 text-[11px] text-zinc-600 hover:text-red-400"
            >
              Unfollow
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function AddFeedForm({ onOpen }) {
  const [url, setUrl] = useState("");
  return (
    <form
      className="mt-6 flex gap-2"
      onSubmit={(e) => { e.preventDefault(); if (url.trim()) onOpen(url.trim()); }}
    >
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com/feed.xml"
        className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-600"
      />
      <button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
        Open
      </button>
    </form>
  );
}

/** Community registry: shows added by peers (shared OrbitDB catalog). */
function CommunitySection({ onOpen }) {
  const [shows, setShows] = useState(null);
  useEffect(() => {
    let alive = true;
    communityShows().then((s) => alive && setShows(s));
    return () => { alive = false; };
  }, []);
  if (shows === null || !shows.length) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">
        From the community · shared catalog ({shows.length})
      </h2>
      <ul className="divide-y divide-zinc-800/60 rounded-xl bg-zinc-900/50">
        {shows.slice(0, 50).map((s) => (
          <li key={s.feedUrl} className="flex items-center gap-3 px-4 py-2.5">
            {s.image && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={bigArt(s.image) ?? s.image} alt="" loading="lazy" className="h-8 w-8 rounded object-cover" />
            )}
            <a className="flex-1 truncate text-sm hover:text-emerald-400" href={`/podcast?url=${encodeURIComponent(s.feedUrl)}`} onClick={(e) => { e.preventDefault(); onOpen(s.feedUrl); }}>
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * ChartsSection — the most-used podcasts per nation, automatically (F6
 * discovery, zero keys): Apple public charts, tier-A markets 1000 shows,
 * others 100. Nation preselected from the IP's country (api.country.is,
 * keyless, CORS-open — the user asked for WHERE the connection answers, not
 * the browser language), cached in pf.country; flags live in a dropdown.
 * Click → feed URL resolved via public /lookup → show page.
 */
function ChartsSection({ onOpen }) {
  const [nation, setNation] = useState(null);
  const [shows, setShows] = useState(null);
  const [stats, setStats] = useState({});
  const [opening, setOpening] = useState(null);
  const [sort, setSort] = useState("chart"); // chart | time | latest | listens | genre | title
  const [weekHours, setWeekHours] = useState({}); // showId → est. h/week
  const [lastPub, setLastPub] = useState({}); // showId → publish date of the newest episode (ms)
  const [timeLoading, setTimeLoading] = useState(false);
  const [genre, setGenre] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    // Nation from the connection's IP (country.is, keyless), cached; browser
    // locale as fallback. Only the explicit pf.country override beats it.
    setNation(null);
    (async () => {
      let code = null;
      try { code = localStorage.getItem("pf.country"); } catch {}
      if (!code || !TOP_NATIONS.some((n) => n.code === code)) {
        try {
          const r = await fetch("https://api.country.is/");
          if (r.ok) {
            const j = await r.json();
            const c = String(j?.country ?? "").toLowerCase();
            if (c && TOP_NATIONS.some((n) => n.code === c)) {
              code = c;
              try { localStorage.setItem("pf.country", c); } catch {}
            }
          }
        } catch {}
      }
      if (!code) {
        try {
          const loc = navigator.language?.split("-")[1];
          if (loc && TOP_NATIONS.some((n) => n.code === loc.toLowerCase())) code = loc.toLowerCase();
        } catch {}
      }
      if (alive) setNation(code ?? "us");
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!nation) return;
    let alive = true;
    setShows(null);
    topPodcasts(nation).then((s) => { if (alive) { setShows(s); listenStats(nation).then((st) => alive && setStats(st)); } });
    return () => { alive = false; };
  }, [nation]);

  // Feed-scan sort (owner): "time" measures est. listening hours/week and
  // "latest" needs the publish date of each show's newest episode. One shared
  // bounded scan (top 60 shows, target 30 measured, concurrency 4, epfeed:
  // cached) serves both; shows without usable feed data rank last, honestly.
  useEffect(() => {
    if ((sort !== "time" && sort !== "latest") || !nation || !shows?.length) return;
    let alive = true;
    setTimeLoading(true);
    setWeekHours({});
    setLastPub({});
    (async () => {
      const TARGET = 30;
      const top = shows.slice(0, 60);
      const out = {};
      const pubs = {};
      let i = 0;
      const worker = async () => {
        while (alive && i < top.length && Object.keys(pubs).length < TARGET) {
          const s = top[i++];
          try {
            const feedUrl = await resolveFeedUrl(s.id);
            if (!feedUrl) continue;
            const feed = await loadFeed(feedUrl);
            const newest = Math.max(0, ...feed.episodes.map((e) => e.pubDateMs ?? 0));
            if (newest > 0) pubs[s.id] = newest;
            const h = weeklyListeningHours(feed?.episodes);
            if (h != null) out[s.id] = h;
          } catch {}
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (alive) { setWeekHours(out); setLastPub(pubs); }
    })().finally(() => { if (alive) setTimeLoading(false); });
    return () => { alive = false; };
  }, [sort, nation, shows]);

  const open = async (show) => {
    setOpening(show.id);
    try {
      const feedUrl = await resolveFeedUrl(show.id);
      if (feedUrl) onOpen(feedUrl);
    } finally {
      setOpening(null);
    }
  };

  const genres = useMemo(() => {
    const set = new Set();
    for (const s of shows ?? []) if (s.genre) set.add(s.genre);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [shows]);

  const view = useMemo(() => {
    let list = shows ?? [];
    if (genre) list = list.filter((s) => s.genre === genre);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q));
    }
    const withRank = list.map((s, i) => ({ ...s, avgRank: stats[s.id]?.avgRank ?? null, weekHours: weekHours[s.id] ?? null, lastPubMs: lastPub[s.id] ?? null }));
    switch (sort) {
      case "time": // est. listening hours/week; shows without duration data last (honest)
        return [...withRank].sort((a, b) =>
          (b.weekHours ?? -1) - (a.weekHours ?? -1) || a.title.localeCompare(b.title));
      case "latest": // owner: by publish date of each show's newest episode; no-data last
        return [...withRank].sort((a, b) =>
          (b.lastPubMs ?? 0) - (a.lastPubMs ?? 0) || (a.lastPubMs == null ? 1 : 0) - (b.lastPubMs == null ? 1 : 0) || a.title.localeCompare(b.title));
      case "listens": // average daily chart POSITION from the public-chart history (not listens!)
        return [...withRank].sort((a, b) =>
          (a.avgRank ?? 9999) - (b.avgRank ?? 9999) || (a.avgRank == null ? 1 : 0) - (b.avgRank == null ? 1 : 0));
      case "genre":
        return [...withRank].sort((a, b) => (a.genre ?? "zz").localeCompare(b.genre ?? "zz") || a.title.localeCompare(b.title));
      case "title":
        return [...withRank].sort((a, b) => a.title.localeCompare(b.title));
      default:
        return withRank; // today's public chart order
    }
  }, [shows, stats, sort, genre, query, weekHours, lastPub]);

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">
        Podcast charts · by nation (Apple public daily chart · {view.length} shows)
      </h2>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <select
          value={nation ?? ""}
          onChange={(e) => {
            setNation(e.target.value);
            try { localStorage.setItem("pf.country", e.target.value); } catch {}
          }}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-600"
          aria-label="Chart nation"
        >
          {!nation && <option value="">Detecting nation…</option>}
          {TOP_NATIONS.map((n) => (
            <option key={n.code} value={n.code}>{n.flag} {n.name}</option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-600">
          <option value="chart">Sort: chart position (Apple, daily)</option>
          <option value="latest">Sort: latest episode (newest first)</option>
          <option value="time">Sort: est. listening time (h/week)</option>
          <option value="listens">Sort: avg chart position (daily history)</option>
          <option value="genre">Sort: genre</option>
          <option value="title">Sort: title</option>
        </select>
        {genres.length > 0 && (
          <select value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Genre filter"
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-600">
            <option value="">Genre: all</option>
            {genres.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          className="w-40 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-600"
        />
      </div>
      {shows === null && <p className="py-8 text-sm text-zinc-500">Loading chart…</p>}
      {(sort === "time" || sort === "latest") && shows?.length > 0 && (
        <p className="mb-3 text-xs text-zinc-600" aria-live="polite">
          {timeLoading
            ? "Reading show feeds…"
            : sort === "time"
              ? Object.keys(weekHours).length
                ? "Estimated listening time = episodes/week × avg duration, from each show's own RSS feed. Shows without duration data rank last (no data, honestly)."
                : "No duration data available from the scanned show feeds yet."
              : Object.keys(lastPub).length
                ? "Ordered by the publish date of each show's newest episode (feed data, shared snapshots). Shows without date data rank last."
                : "No publish dates available from the scanned show feeds yet."}
        </p>
      )}
      {shows?.length === 0 && (
        <p className="py-8 text-sm text-zinc-500">Chart unavailable for this nation right now.</p>
      )}
      {shows?.length > 0 && (
        <ol className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {view.map((s, i) => (
            <li key={s.id}>
              <button
                onClick={() => open(s)}
                disabled={opening === s.id}
                title={s.genre ?? ""}
                className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-900 disabled:opacity-50"
              >
                <span className="w-7 shrink-0 text-right text-xs tabular-nums text-zinc-600">{i + 1}</span>
                {s.image && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={bigArt(s.image) ?? s.image} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-md object-cover" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-zinc-200 group-hover:text-emerald-400">{s.title}</span>
                  <span className="block truncate text-xs text-zinc-600">
                    {s.artist}
                    {s.lastPubMs != null && (
                      <span className="ml-1.5 text-zinc-500">· latest {relativeDate(s.lastPubMs)}</span>
                    )}
                    {s.weekHours != null && (
                      <span className="ml-1.5 tabular-nums text-zinc-500">· ≈{s.weekHours.toFixed(1)} h/wk</span>
                    )}
                  </span>
                </span>
                {opening === s.id && <span className="text-xs text-zinc-500">…</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function PodcastPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-10"><p className="text-sm text-zinc-500">Loading…</p></main>}>
      <PodcastPageInner />
    </Suspense>
  );
}
