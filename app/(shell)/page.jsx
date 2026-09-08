"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { searchArchive, creatorStats } from "@/lib/archive";
import { rankArtists, canonScore } from "@/lib/popularity";
import { batchSitelinks, pageviews } from "@/lib/notability";
import { topListenedArtists } from "@/lib/feedback";
import { normalizeSearchItem, byPopularity } from "@/lib/pipeline";
import { SHELVES } from "@/lib/catalog";
import PharosMark from "@/components/PharosMark";

import AlbumCard from "@/components/AlbumCard";
import ShelfRow from "@/components/ShelfRow";
import SkeletonCard from "@/components/SkeletonCard";
import Icon from "@/components/Icon";

/**
 * Home page (phase 2, spec §3.2): popular artists + thematic shelves +
 * "Recently played" row. The search UI moved to /search (pattern: Search is a
 * dedicated tab); home keeps a compact search link in the header.
 *
 * Data flow: archive.org search API → normalization pipeline (pure, sync) →
 * quality filter → popularity ranking (objective Wikipedia signals).
 * All ranking is done client-side at render time; no server involved.
 */
export default function HomePage() {
  const [shelves, setShelves] = useState({});
  const [artists, setArtists] = useState(null);
  const [recent, setRecent] = useState([]);

  // Thematic shelves + popular artists: loaded once on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const shelf of SHELVES) {
        const { items: docs } = await searchArchive({
          query: shelf.query, collection: shelf.collection, rows: 12,
        });
        if (!alive) return;
        setShelves((prev) => ({
          ...prev,
          [shelf.id]: docs.map(normalizeSearchItem).filter((a) => a.quality >= 3).sort(byPopularity).slice(0, 10),
        }));
      }
      // Popular = who PharOS users actually listen to (shared OrbitDB chart)
      // weighted by the user's CULTURAL canon (lib/culture.js): the order
      // follows the user's culture and listening affinity, not a global one.
      const listened = await topListenedArtists(24);
      let popular = listened.map((a) => ({ name: a.name, listens: a.plays }));
      if (popular.length < 12) {
        const seen = new Set(popular.map((a) => a.name.toLowerCase()));
        const stats = await creatorStats("audio_music", 500);
        const sitelinks = await batchSitelinks(stats.map((s) => s.name));
        const enriched = stats.map((s) => ({ ...s, sitelinks: sitelinks.get(s.name) ?? 0 }));
        const notable = [...enriched].sort((a, b) => b.sitelinks - a.sitelinks).slice(0, 16);
        await Promise.all(notable.map(async (s) => { s.pageviews = await pageviews(s.name); }));
        for (const a of rankArtists(notable)) {
          if (popular.length >= 12) break;
          if (seen.has(a.name.toLowerCase())) continue;
          popular.push(a);
        }
      }
      // Cultural affinity re-rank: cultural-canon tier (the user's own canon)
      // dominates, real community listens second, encyclopedic measures last.
      popular = [...popular].sort((a, b) =>
        (canonScore(b.name) * 50 + (b.listens ?? 0)) - (canonScore(a.name) * 50 + (a.listens ?? 0)));
      if (alive) setArtists(popular.slice(0, 12));
    })();
    return () => { alive = false; };
  }, []);

  // Recently played: local history written by PlayerProvider (pf.recent).
  useEffect(() => {
    try { setRecent(JSON.parse(localStorage.getItem("pf.recent") ?? "[]")); } catch {}
  }, []);

  /** Podcasts count as listening too (owner) — but they are not archive.org
   *  albums: they render as their own row with the podcast icon, linking to
   *  the show page via /podcast?url=<feedUrl>. Legacy entries (no medium)
   *  default to music. */
  const music = recent.filter((e) => (e.medium ?? "music") === "music");
  const podcasts = recent.filter((e) => e.medium === "podcast" && e.feedUrl);
  const recentAlbums = [...new Map(music.map((e) => [e.albumId, e])).values()].slice(0, 10);
  const recentPodcasts = [...new Map(podcasts.map((e) => [e.feedUrl, e])).values()].slice(0, 10);
  const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };

  return (
    <main className="mx-auto max-w-6xl px-4 md:px-8 pt-6 md:pt-10">
      {/* Mobile header + compact search link (the full UI lives at /search) */}
      <header className="mb-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 md:hidden">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600/15">
            <PharosMark className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">
            Public<span className="text-emerald-500">Flac</span>
          </h1>
        </div>
        <Link
          href="/search"
          className="flex w-full items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-4 py-2.5 text-sm text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-400 md:ml-auto md:w-72"
        >
          <Icon name="search" className="h-4 w-4" />
          Search music…
        </Link>
      </header>

      {/* Recently played (pattern #12: history as a first-class row) */}
      {/* Recently played — podcasts first-class (owner: “valgono come musica”) */}
      {recentPodcasts.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 text-xl font-bold tracking-tight">Recently played podcasts</h2>
          <div className="shelf-scroll flex gap-5 overflow-x-auto pb-3 -mx-4 px-4 md:-mx-8 md:px-8">
            {recentPodcasts.map((e) => (
              <Link key={e.feedUrl} href={`/podcast?url=${encodeURIComponent(e.feedUrl)}`} className="w-40 sm:w-44 shrink-0">
                <div className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                  {e.cover ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={e.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <Icon name="podcast" className="h-10 w-10 text-zinc-500" />
                  )}
                </div>
                <p className="mt-2 truncate text-sm font-medium">{e.title}</p>
                <p className="truncate text-xs text-zinc-500">{e.video ? "video podcast" : "podcast"}{e.artist ? ` · ${hostOf(e.artist)}` : ""}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
      {recentAlbums.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 text-xl font-bold tracking-tight">Recently played</h2>
          <div className="shelf-scroll flex gap-5 overflow-x-auto pb-3 -mx-4 px-4 md:-mx-8 md:px-8">
            {recentAlbums.map((e) => (
              <div key={e.albumId} className="w-40 sm:w-44 shrink-0">
                <AlbumCard album={{ id: e.albumId, title: e.albumId.split("/").pop().replace(/[-_]/g, " "), artist: e.artist, quality: 3, downloads: 0 }} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Popular artists */}
      <section id="artists" className="mb-10">
        <h2 className="mb-4 text-xl font-bold tracking-tight">Popular artists</h2>
        <div className="shelf-scroll flex gap-5 overflow-x-auto pb-3 -mx-4 px-4 md:-mx-8 md:px-8">
          {artists === null && Array.from({ length: 8 }, (_, i) => <SkeletonCard key={i} circle />)}
          {artists?.map(({ name }) => (
            <Link
              key={name}
              href={`/artist?n=${encodeURIComponent(name)}`}
              className="group w-32 sm:w-36 shrink-0 text-center"
            >
              <div className="aspect-square overflow-hidden rounded-full bg-zinc-800 shadow-lg shadow-black/30 ring-1 ring-zinc-800 transition-all duration-200 group-hover:ring-emerald-600/50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://archive.org/services/img/${encodeURIComponent(name)}`}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  onError={(e) => { e.currentTarget.style.opacity = 0.2; }}
                />
              </div>
              <p className="mt-2.5 truncate text-sm font-medium">{name}</p>
              <p className="text-xs text-zinc-600">Artist</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Thematic shelves */}
      <div id="shelves">
        {SHELVES.map((shelf) => (
          <ShelfRow
            key={shelf.id}
            anchorId={`shelf-${shelf.id}`}
            title={shelf.label}
            albums={shelves[shelf.id]}
            loading={!(shelf.id in shelves)}
          />
        ))}
      </div>
    </main>
  );
}
