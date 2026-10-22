"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * BookCard — one dense catalogue entry (cover, title, creator, year, formats).
 * Shows only what archive.org returned: unknown title/creator/year are
 * labelled "Unknown", never filled in. Internal navigation via next/link so
 * the shell (and the player island) is never re-mounted.
 *
 * @param {{ book: import("@/lib/books").BookRecord }} props
 */
export default function BookCard({ book }) {
  const [coverOk, setCoverOk] = useState(true);
  const title = book.title ?? "Untitled (unknown title)";
  return (
    <Link
      href={`/books/detail/?id=${encodeURIComponent(book.id)}`}
      data-testid="book-card"
      className="group flex gap-3 rounded-lg p-2 transition-colors hover:bg-zinc-900 focus-visible:bg-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"
    >
      <span className="flex h-24 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-zinc-800/70 text-[10px] text-zinc-600">
        {coverOk ? (
          <img
            src={book.coverUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setCoverOk(false)}
            className="h-full w-full object-cover"
          />
        ) : (
          "No cover"
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-medium text-zinc-100 group-hover:text-white">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-zinc-400">
          {book.creators.length ? book.creators.join(", ") : "Unknown author"}
        </span>
        <span className="mt-0.5 block text-xs text-zinc-500">
          {book.year ?? "Year unknown"}
          {book.language ? ` · ${book.language}` : ""}
        </span>
        {book.formats.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {book.formats.map((f) => (
              <span key={f} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{f}</span>
            ))}
          </span>
        )}
      </span>
    </Link>
  );
}
