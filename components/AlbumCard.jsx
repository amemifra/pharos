"use client";

import { useRouter } from "next/navigation";
import { usePlayer } from "@/components/PlayerProvider";
import { useState } from "react";
import { fetchItemMetadata, thumbUrl } from "@/lib/archive";
import { normalizeAlbum } from "@/lib/pipeline";

/**
 * Album card.
 *
 * STRUCTURE CONSTRAINT (hydration): the card root is a <div>, NOT a <Link>.
 * A Link containing another Link (artist) produced "a cannot contain a nested
 * a", which broke hydration — React never attached event handlers, so Play
 * clicks silently did nothing (the island stayed empty). Navigation is done
 * programmatically on card click; interactive children stopPropagation.
 *
 * Cover: official archive.org thumbnail (no metadata fetch needed); the
 * tracklist is prefetched only on Play (nothing eager, low-end friendly).
 */
export default function AlbumCard({ album }) {
  const router = useRouter();
  const { playQueue } = usePlayer();
  const [loading, setLoading] = useState(false);
  const [restricted, setRestricted] = useState(false);

  /** Play: fetch metadata once, normalize, hand the queue to the island.
   *  Access guard: archive.org exposes lending/restricted items in the audio
   *  search index (files 401 on download) — never queue them. */
  const play = async (e) => {
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

  /** Open the album page (card body click). */
  // Static-export URL scheme: nested album lives at /album?id=…&n=<artist>.
  const open = () => router.push(`/album?id=${encodeURIComponent(album.id)}&n=${encodeURIComponent(album.artist || "artist")}`);

  return (
    <div
      onClick={open}
      className="group cursor-pointer rounded-xl bg-zinc-900 hover:bg-zinc-800 transition p-3 flex flex-col"
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
          className="absolute bottom-2 right-2 h-10 w-10 rounded-full bg-emerald-600 text-white shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 max-sm:opacity-100 transition"
          aria-label={`Play ${album.title}`}
        >
          {restricted ? "🔒" : loading ? "…" : "▶"}
        </button>
        {restricted && (
          <span className="absolute top-2 left-2 rounded bg-amber-900/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
            Lending
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-sm font-medium">{album.title}</p>
      <button
        onClick={(e) => { e.stopPropagation(); router.push(`/artist?n=${encodeURIComponent(album.artist)}`); }}
        className="truncate text-left text-xs text-zinc-500 hover:text-emerald-400"
      >
        {album.artist}
      </button>
      {album.year ? <p className="text-xs text-zinc-600">{album.year}</p> : null}
    </div>
  );
}
