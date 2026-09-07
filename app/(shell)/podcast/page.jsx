"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { loadFeed, relativeDate } from "@/lib/podcast";
import { TOP_NATIONS, topPodcasts, resolveFeedUrl, listenStats } from "@/lib/podcastcharts";
import { listSubs, subscribe, unsubscribe, isSubscribed, playedInfo, episodesToTracks, communityShows } from "@/lib/subscribe";
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
    if (feedUrl) load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedUrl]);

  const tracks = useMemo(() => (data ? episodesToTracks(data.episodes) : []), [data]);
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
      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Podcasts</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Add a show by its RSS feed URL. Discovery via Podcast Index is optional (pf.pixkey).
        </p>
        <SubsList subs={subs} onOpen={open} onChange={setSubs} />
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
        <header className="flex items-start gap-5">
          {data.show.image && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={data.show.image} alt="" className="h-28 w-28 rounded-xl object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400/90">Podcast</p>
            <h1 className="mt-1 truncate text-2xl font-extrabold tracking-tight md:text-3xl">{data.show.title}</h1>
            <p className="mt-1 line-clamp-2 text-sm text-zinc-500">{data.show.description}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => { subbed ? unsubscribe(feedUrl) : subscribe(data.show); setSubs(listSubs()); }}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
                  subbed ? "border border-zinc-700 text-zinc-300" : "bg-emerald-600 text-white hover:bg-emerald-500"
                }`}
              >
                {subbed ? "Subscribed ✓" : "Subscribe"}
              </button>
              {tracks.length > 0 && (
                <button
                  onClick={() => playQueue(tracks, firstUnplayed)}
                  className="rounded-full border border-zinc-700 px-4 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white"
                >
                  Play all unplayed
                </button>
              )}
              <button
                onClick={() => load(true)}
                disabled={refreshing}
                className="rounded-full border border-zinc-700 px-4 py-1.5 text-xs font-semibold text-zinc-400 hover:text-white disabled:opacity-50"
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
              <span className="text-[11px] text-zinc-600">
                {data.source === "cache" ? "shared snapshot" : "fetched live"}
              </span>
            </div>
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
            return (
              <li key={ep.guid}>
                <button
                  onClick={() => {
                    const t = episodesToTracks([ep]);
                    markPlayedAndPlay(ep, p, playQueue, t);
                  }}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-zinc-800/60"
                >
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${isPlayed ? "bg-emerald-500" : "border border-zinc-600"}`} aria-label={isPlayed ? "played" : "unplayed"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{ep.title}</span>
                    <span className="mt-0.5 block text-xs text-zinc-500">
                      {relativeDate(ep.pubDateMs)}
                      {ep.durationMs ? ` · ${Math.round(ep.durationMs / 60000)} min` : ""}
                    </span>
                  </span>
                  <Icon name="play" className="mt-1 h-4 w-4 text-zinc-500" />
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

function SubsList({ subs, onOpen, onChange }) {
  if (!subs.length) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">Your shows</h2>
      <ul className="divide-y divide-zinc-800/60 rounded-xl bg-zinc-900/50">
        {subs.map((s) => (
          <li key={s.feedUrl} className="flex items-center gap-3 px-4 py-2.5">
            <button className="flex-1 truncate text-left text-sm hover:text-emerald-400" onClick={() => onOpen(s.feedUrl)}>
              {s.title}
            </button>
            <button
              onClick={() => { unsubscribe(s.feedUrl); onChange(listSubs()); }}
              className="text-xs text-zinc-500 hover:text-red-400"
            >
              Unsubscribe
            </button>
          </li>
        ))}
      </ul>
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
              <img src={s.image} alt="" loading="lazy" className="h-8 w-8 rounded object-cover" />
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
  const [sort, setSort] = useState("chart"); // chart | listens | genre | title
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
    const withRank = list.map((s, i) => ({ ...s, avgRank: stats[s.id]?.avgRank ?? null }));
    switch (sort) {
      case "listens": // average daily position from the public-chart feed
        return [...withRank].sort((a, b) =>
          (a.avgRank ?? 9999) - (b.avgRank ?? 9999) || (a.avgRank == null ? 1 : 0) - (b.avgRank == null ? 1 : 0));
      case "genre":
        return [...withRank].sort((a, b) => (a.genre ?? "zz").localeCompare(b.genre ?? "zz") || a.title.localeCompare(b.title));
      case "title":
        return [...withRank].sort((a, b) => a.title.localeCompare(b.title));
      default:
        return withRank; // today's public chart order
    }
  }, [shows, stats, sort, genre, query]);

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">
        Most played · by nation (Apple public charts, full chart · {view.length} shows)
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
          <option value="chart">Sort: chart position</option>
          <option value="listens">Sort: avg listens (daily feed)</option>
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
                  <img src={s.image} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-md object-cover" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-zinc-200 group-hover:text-emerald-400">{s.title}</span>
                  <span className="block truncate text-xs text-zinc-600">{s.artist}</span>
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
