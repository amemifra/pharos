"use client";

import Link from "next/link";
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

  /** Plays the top result: fetch metadata → normalize → island queue. */
  const play = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const { fetchItemMetadata } = await import("@/lib/archive");
      const { normalizeAlbum } = await import("@/lib/pipeline");
      const full = normalizeAlbum(album.id, await fetchItemMetadata(album.id));
      playQueue(full.tracks, 0);
    } catch {}
  };

  return (
    <Link
      href={`/album?id=${encodeURIComponent(album.id)}&n=${encodeURIComponent(album.artist || "artist")}`}
      className="group relative col-span-2 flex flex-col justify-end overflow-hidden rounded-xl bg-zinc-900 p-4 transition-colors hover:bg-zinc-800 sm:row-span-2"
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
      <button
        onClick={play}
        className="absolute bottom-4 right-4 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-black shadow-lg shadow-black/40 transition-all hover:scale-105 hover:bg-emerald-400"
        aria-label={`Play ${album.title}`}
      >
        <Icon name="play" className="h-5 w-5" />
      </button>
    </Link>
  );
}
