"use client";

import Link from "next/link";
import { useState } from "react";
import { thumbUrl } from "@/lib/archive";
import { usePlayer } from "@/components/PlayerProvider";
import Icon from "@/components/Icon";

/**
 * TopResultCard — the big confident first-result card (YT Music pattern #7).
 * Justified for us because searchRanked + the LTR model give us a ranked #1.
 *
 * @param {{album: import("@/lib/pipeline").Album}} props
 */
export default function TopResultCard({ album }) {
  const { playQueue } = usePlayer();
  const [restricted, setRestricted] = useState(false);

  /** Plays the top result: fetch metadata → normalize → island queue.
   *  Access guard (same as AlbumCard): restricted items 401 — never queue. */
  const play = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const { fetchItemMetadata } = await import("@/lib/archive");
      const { normalizeAlbum } = await import("@/lib/pipeline");
      const full = normalizeAlbum(album.id, await fetchItemMetadata(album.id));
      if (full.restricted) { setRestricted(true); return; }
      playQueue(full.tracks, 0);
    } catch {
      /* silent: card stays clickable, album page owns the error state */
    }
  };

  return (
    // Container div + stretched Link (after:inset-0) so the play button is a
    // SIBLING, not a nested <button> inside <a> (invalid HTML, hydration risk).
    // next/link, never raw <a>: raw hrefs 404 under the /pharos basePath.
    <div className="group relative col-span-2 flex flex-col justify-end overflow-hidden rounded-xl bg-zinc-900 p-4 transition-colors hover:bg-zinc-800 sm:row-span-2">
      <Link
        href={`/album?id=${encodeURIComponent(album.id)}&n=${encodeURIComponent(album.artist || "artist")}`}
        className="after:absolute after:inset-0"
        aria-label={`Open album ${album.title}`}
      >
      <div className="mb-4 overflow-hidden rounded-lg shadow-lg shadow-black/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbUrl(album.id)}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-28 w-28 object-cover transition-transform duration-300 group-hover:scale-105"
          onError={(e) => { e.currentTarget.style.opacity = 0.2; }}
        />
      </div>
      <p className="truncate text-lg font-bold">{album.title}</p>
      <p className="mt-0.5 truncate text-sm text-zinc-500">
        {album.artist}{album.year ? ` · ${album.year}` : ""}
      </p>
      </Link>
      <button
        onClick={play}
        disabled={restricted}
        className="absolute bottom-4 right-4 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-black shadow-lg shadow-black/40 transition-all hover:scale-105 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-400 disabled:hover:scale-100"
        aria-label={restricted ? `${album.title} — unavailable (restricted)` : `Play ${album.title}`}
        title={restricted ? "Lending-restricted on archive.org" : undefined}
      >
        <Icon name={restricted ? "note" : "play"} className="h-5 w-5" />
      </button>
    </div>
  );
}
