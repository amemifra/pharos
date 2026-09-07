"use client";

import AlbumCard from "@/components/AlbumCard";
import SkeletonCard from "@/components/SkeletonCard";

/**
 * Horizontally scrollable album row, Spotify-style.
 * Contract: renders skeletons while loading; empty shelves render nothing.
 * @param {{title: string, albums?: Object[], loading?: boolean, anchorId?: string}} props
 */
export default function ShelfRow({ title, albums, loading = false, anchorId }) {
  return (
    <section id={anchorId} className="mb-10 scroll-mt-6">
      <h2 className="mb-4 text-xl font-bold tracking-tight">{title}</h2>
      <div className="shelf-scroll flex gap-4 overflow-x-auto pb-3 -mx-4 px-4 md:-mx-8 md:px-8">
        {loading && Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}
        {!loading && (albums ?? []).map((a) => (
          <div key={a.id} className="w-40 sm:w-44 shrink-0">
            <AlbumCard album={a} />
          </div>
        ))}
      </div>
    </section>
  );
}
