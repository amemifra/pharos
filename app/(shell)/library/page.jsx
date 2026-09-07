"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePlayer } from "@/components/PlayerProvider";
import { thumbUrl } from "@/lib/archive";
import AlbumCard from "@/components/AlbumCard";
import SurfaceState from "@/components/SurfaceState";
import Icon from "@/components/Icon";

const RECENT_KEY = "pf.recent";

const readRecent = () => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; }
};

/**
 * /library — saved + history (phase 2, spec §3.1).
 * Sections:
 *   - Play queue: the live island queue (jump to any track, "Playing Next" simplified)
 *   - Recently played: last 20 tracks started, from pf.recent (written by PlayerProvider)
 * No backend features: everything is localStorage + island state, per contract.
 */
export default function LibraryPage() {
  const { queue, index, current, playing, toggle, playQueue } = usePlayer();
  const [recent, setRecent] = useState([]);

  useEffect(() => { setRecent(readRecent()); }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Jump to a queue position (island re-load + play). */
  const jumpTo = (i) => playQueue(queue, i);

  return (
    <main className="mx-auto max-w-6xl px-4 md:px-8 pt-6 md:pt-10">
      <h1 className="mb-8 text-2xl font-bold tracking-tight md:text-3xl">Library</h1>

      {/* —— Play queue —— */}
      <section className="mb-12">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">Play queue</h2>
        {queue.length === 0 ? (
          <SurfaceState
            state="empty"
            title="The queue is empty."
            hint="Play an album and it will show up here."
            emptyAction={{ label: "Search music", href: "/search" }}
          />
        ) : (
          <ol className="divide-y divide-zinc-800/60 rounded-xl bg-zinc-900/50">
            {queue.map((t, i) => {
              const isCurrent = i === index;
              return (
                <li key={`${t.id}-${i}`}>
                  <button
                    onClick={() => (isCurrent ? toggle() : jumpTo(i))}
                    className="flex w-full items-center gap-4 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-zinc-800/60"
                  >
                    <span className={`w-6 text-right text-xs tabular-nums ${isCurrent ? "text-emerald-400" : "text-zinc-600"}`}>
                      {isCurrent && playing ? <Icon name="pause" className="inline h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span className={`flex-1 truncate text-sm ${isCurrent ? "font-medium text-emerald-400" : ""}`}>{t.title}</span>
                    {t.__albumArtist && <span className="hidden truncate text-xs text-zinc-500 sm:block">{t.__albumArtist}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* —— Recently played —— */}
      <section className="mb-12">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">Recently played</h2>
        {recent.length === 0 ? (
          <SurfaceState state="empty" title="No history yet." hint="Albums you play are listed here (local only)." />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {recent.map((e) => (
              <Link
                key={e.id}
                href={`/album?id=${encodeURIComponent(e.albumId)}&n=${encodeURIComponent(e.artist || "artist")}`}
                className="group flex items-center gap-3 rounded-xl bg-zinc-900 p-2.5 transition-colors hover:bg-zinc-800"
              >
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-zinc-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbUrl(e.albumId)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                    onError={(ev) => { ev.currentTarget.style.opacity = 0.2; }}
                  />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{e.title}</p>
                  <p className="truncate text-xs text-zinc-500">{e.artist}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* —— Albums touched on this device (from history, deduped) —— */}
      {recent.length > 0 && (
        <section className="mb-12">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">Albums on this device</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {[...new Map(recent.map((e) => [e.albumId, e])).values()].slice(0, 10).map((e) => (
              <AlbumCard
                key={e.albumId}
                album={{ id: e.albumId, title: e.albumId.split("/").pop().replace(/[-_]/g, " "), artist: e.artist, quality: 3, downloads: 0 }}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
