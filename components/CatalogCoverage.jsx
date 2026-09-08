"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { crossReference, resolveArtistMbid } from "@/lib/discography";
import { catalogGet, keys } from "@/lib/catalogstore";
import { warmStats } from "@/lib/catalogwarm";

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
  const [fill, setFill] = useState(null);
  const [showMissing, setShowMissing] = useState(false);
  // Warm-up data-quality badge (Fase 3.2): per-source yield of the candidate
  // streams, accumulated locally (pf.warmstats). Numbers only — the crawl
  // decision stays with the owner. Hidden until a few units give signal.
  const warmBadge = warmStats().filter((r) => r.n >= 3);

  useEffect(() => {
    let alive = true;
    setData(null);
    crossReference(artist)
      .then((r) => alive && setData(r))
      .catch(() => {});
    // F4: per-track coverage from the published fill record (tracks with ≥1
    // link vivo, not just albums available) — null until a peer filled it.
    catalogGet(keys.fill(artist)).then((f) => alive && setFill(f)).catch(() => {});
    return () => { alive = false; };
  }, [artist]);

  if (!data || !data.entries.length) return null;

  // Per-track coverage counts ALTERNATE TAKES as real targets (owner,
  // ratified): an alternate is its own play target with its own trackKey in
  // the fill record — counting it is honest coverage of the published
  // record, NOT padding. No filter is applied (ratified default, low-risk).
  const pct = Math.round(data.coverage * 100);
  const trackCount = fill ? Object.keys(fill.tracks ?? {}).length : 0;
  const filledCount = fill ? Object.values(fill.tracks ?? {}).filter((v) => v?.length).length : 0;
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
      {fill && (
        <p className="mt-1 text-xs text-zinc-500" data-testid="track-coverage">
          Track coverage: <span className="text-emerald-400">{filledCount}</span>/{trackCount} tracks with at least one verified link
          {fill.stats?.liveness != null && <> · sampled liveness {Math.round(fill.stats.liveness * 100)}%</>}
        </p>
      )}
      {warmBadge.length > 0 && (
        <p className="mt-1 text-[11px] text-zinc-600" data-testid="warmstats">
          Warm-up quality: {warmBadge.map((r) => `${r.source} ${Math.round(r.coverage * 100)}%`).join(" · ")}
        </p>
      )}

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
