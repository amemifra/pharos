"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loadFeed, relativeDate } from "@/lib/podcast";
import { listSubs, subscribe, unsubscribe, isSubscribed, playedInfo, episodesToTracks } from "@/lib/subscribe";
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
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Podcasts</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Add a show by its RSS feed URL. Discovery via Podcast Index is optional (pf.pixkey).
        </p>
        <SubsList subs={subs} onChange={setSubs} />
        <AddFeedForm onOpen={(u) => { window.location.href = `/podcast?url=${encodeURIComponent(u)}`; }} />
      </main>
    );
  }

  const subbed = isSubscribed(feedUrl);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {error && (
        <p className="mb-4 rounded-lg border border-red-800/50 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          Feed could not be loaded ({error}). The CORS fallback was tried; some feeds block both paths.
        </p>
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
        <ol className="mt-8 divide-y divide-zinc-800/60 rounded-xl bg-zinc-900/50">
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

function SubsList({ subs, onChange }) {
  if (!subs.length) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">Your shows</h2>
      <ul className="divide-y divide-zinc-800/60 rounded-xl bg-zinc-900/50">
        {subs.map((s) => (
          <li key={s.feedUrl} className="flex items-center gap-3 px-4 py-2.5">
            <a className="flex-1 truncate text-sm hover:text-emerald-400" href={`/podcast?url=${encodeURIComponent(s.feedUrl)}`}>
              {s.title}
            </a>
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

export default function PodcastPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-10"><p className="text-sm text-zinc-500">Loading…</p></main>}>
      <PodcastPageInner />
    </Suspense>
  );
}
