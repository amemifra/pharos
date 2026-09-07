"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { crossReference, resolveArtistMbid } from "@/lib/discography";

/**
 * Catalog coverage panel — the inverse process made visible.
 *
 * Shows the artist's canonical discography (MusicBrainz, community-curated)
 * with each entry marked as:
 *   [Available] — matched an archive.org item → playable now
 *   [Missing]   — exists officially but no legal open source found yet
 * The missing list is the acquisition queue: it drives catalog growth instead
 * of leaving it to chance.
 *
 * @param {{artist: string}} props
 */
export default function CatalogCoverage({ artist }) {
  const [data, setData] = useState(null);
  const [showMissing, setShowMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    crossReference(artist)
      .then((r) => alive && setData(r))
      .catch(() => {});
    return () => { alive = false; };
  }, [artist]);

  if (!data || !data.entries.length) return null;

  const pct = Math.round(data.coverage * 100);
  const missing = data.entries.filter((e) => e.status === "missing");
  const available = data.entries.filter((e) => e.status === "available");

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">
          Canonical catalog <span className="text-sm font-normal text-zinc-500">· MusicBrainz cross-reference</span>
        </h2>
        <span className="text-sm">
          <span className="text-emerald-400 font-semibold">{data.available}</span>
          <span className="text-zinc-500"> / {data.entries.length} available · coverage {pct}%</span>
        </span>
      </div>

      {/* Coverage bar: objective measure of the gap */}
      <div className="mt-2 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>

      {/* Available entries: playable now */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {available.slice(0, showMissing ? 6 : 12).map((e) => (
          <Link
            key={e.mbid}
            href={`/album?id=${encodeURIComponent(e.match.id)}&n=${encodeURIComponent(artist)}`}
            className="flex items-center gap-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 px-3 py-2 transition"
          >
            <span className="text-emerald-500 text-xs font-bold">✓</span>
            <span className="flex-1 truncate text-sm">{e.title}</span>
            {e.year && <span className="text-xs text-zinc-600 tabular-nums">{e.year}</span>}
          </Link>
        ))}
      </div>

      {/* Missing entries: the acquisition queue, collapsed by default */}
      <button
        onClick={() => setShowMissing((v) => !v)}
        className="mt-4 text-xs text-zinc-500 hover:text-zinc-300"
      >
        {showMissing ? "▾" : "▸"} Not available ({data.missing}) — canonical releases with no open legal source yet
      </button>
      {showMissing && (
        <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {missing.slice(0, 20).map((e) => (
            <li key={e.mbid} className="flex items-center gap-3 rounded-lg border border-zinc-800/60 px-3 py-1.5">
              <span className="text-zinc-600 text-xs">✗</span>
              <span className="flex-1 truncate text-sm text-zinc-500">{e.title}</span>
              {e.year && <span className="text-xs text-zinc-700 tabular-nums">{e.year}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
