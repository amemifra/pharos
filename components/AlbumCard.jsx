"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePlayer } from "@/components/PlayerProvider";
import { useState } from "react";
import { fetchItemMetadata, thumbUrl } from "@/lib/archive";
import { normalizeAlbum } from "@/lib/pipeline";

/**
 * Album card.
 *
 * ACCESSIBILITY (#15, WCAG 2.1.1 — keyboard parity): the card title is a
 * real stretched <Link> (after:absolute after:inset-0) covering the whole
 * card, so opening the album works with Tab+Enter exactly like a click. The
 * interactive children (play button, artist link) sit ABOVE the stretched
 * link (relative z-10) and the programmatic onClick on the root div is gone
 * — no mouse-only navigation, no nested <a> (hydration constraint kept:
 * the root is still a <div>).
 *
 * Cover: official archive.org thumbnail (no metadata fetch needed); the
 * tracklist is prefetched only on Play (nothing eager, low-end friendly).
 */

// HQ badge (#17): quality is the pipeline's 0–4 metadata-quality score; the
// badge marks the top tier (fully-formed records: title, creator, year,
// tracks) so users can tell curated results from scrape-y ones.
const HQ_MIN_QUALITY = 4;

export default function AlbumCard({ album }) {
  const router = useRouter();
  const { playQueue } = usePlayer();
  const [loading, setLoading] = useState(false);
  const [restricted, setRestricted] = useState(false);

  /** Play: fetch metadata once, normalize, hand the queue to the island.
   *  Access guard: archive.org exposes lending/restricted items in the audio
   *  search index (files 401 on download) — never queue them. */
  const play = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    try {
      const meta = await fetchItemMetadata(album.id);
      const full = normalizeAlbum(album.id, meta);
      if (full.restricted) {
        setRestricted(true);
        return;
      }
      playQueue(full.tracks, 0);
    } catch {
      /* silent: the card stays clickable */
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="group relative rounded-xl bg-zinc-900 hover:bg-zinc-800 transition p-3 flex flex-col"
      data-testid="album-card"
    >
      <div className="relative aspect-square overflow-hidden rounded-lg bg-zinc-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbUrl(album.id)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
          className="h-full w-full object-cover group-hover:scale-105 transition duration-300"
        />
        <button
          onClick={play}
          disabled={loading}
          className="absolute bottom-2 right-2 z-10 h-10 w-10 rounded-full bg-emerald-600 text-white shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 max-sm:opacity-100 transition"
          aria-label={`Play ${album.title}`}
        >
          {restricted ? "🔒" : loading ? "…" : "▶"}
        </button>
        {restricted && (
          <span className="absolute top-2 left-2 rounded bg-amber-900/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
            Lending
          </span>
        )}
        {!restricted && (album.quality ?? 0) >= HQ_MIN_QUALITY && (
          <span
            className="absolute top-2 right-2 rounded bg-emerald-900/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-300"
            title="High-quality record: complete metadata on archive.org"
          >
            HQ
          </span>
        )}
      </div>
      {/* Stretched link: the whole card opens the album, keyboard included. */}
      <p className="mt-2 truncate text-sm font-medium">
        <Link
          href={`/album?id=${encodeURIComponent(album.id)}&n=${encodeURIComponent(album.artist || "artist")}`}
          className="after:absolute after:inset-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-xl"
        >
          {album.title}
        </Link>
      </p>
      <button
        onClick={(e) => router.push(`/artist?n=${encodeURIComponent(album.artist)}`)}
        className="relative z-10 truncate text-left text-xs text-zinc-500 hover:text-emerald-400"
      >
        {album.artist}
      </button>
      {album.year ? <p className="text-xs text-zinc-600">{album.year}</p> : null}
    </div>
  );
}
