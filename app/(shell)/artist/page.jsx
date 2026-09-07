"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { searchByArtist } from "@/lib/archive";
import { normalizeSearchItem } from "@/lib/pipeline";
import { crossReference } from "@/lib/discography";
import { fillState, fillArtist } from "@/lib/fillengine";
import { looksClassical, groupByWork } from "@/lib/classical";
import { artistImage } from "@/lib/artistimage";
import AlbumCard from "@/components/AlbumCard";
import SkeletonCard from "@/components/SkeletonCard";

/**
 * Artist page — canonical-catalog-first (the inverse process).
 *
 * Layout mirrors Spotify/Apple Music artist pages, but the discography comes
 * from MusicBrainz release-groups (canonical order, official titles) cross-
 * referenced with source availability:
 *   - "Available" section: canonical albums matched to a playable item
 *     (ordered by release year — the correct order, not upload order)
 *   - "Missing" section (collapsed): the acquisition queue
 * Raw archive.org items remain visible only as a secondary section.
 * Static-export note: the artist is a QUERY param (?n=Name), not a dynamic
 * route segment — GitHub Pages cannot resolve dynamic segments. The hash
 * deep-link shim in (shell)/layout.jsx maps legacy #/artist/X URLs here.
 */
function ArtistPageInner() {
  const params = useSearchParams();
  const artist = params.get("n") ? decodeURIComponent(params.get("n")) : "";
  const [cross, setCross] = useState(null);
  const [image, setImage] = useState(null);
  const [rawItems, setRawItems] = useState(null);
  const [error, setError] = useState(null);
  const [showMissing, setShowMissing] = useState(false);
  // F4: the shared distributed queue, rendered honestly (pending/claimed/filled).
  const [fill, setFill] = useState(null);
  const [filling, setFilling] = useState(false);

  useEffect(() => {
    let alive = true;
    setFill(null);
    fillState(artist).then((s) => alive && setFill(s)).catch(() => {});
    return () => { alive = false; };
  }, [artist]);

  const fillNow = async () => {
    setFilling(true);
    try {
      await fillArtist(artist, { force: false });
      setFill(await fillState(artist));
    } catch { /* honest failure: button re-enables, state stays pending */ }
    setFilling(false);
  };

  const fillLabel = filling ? "Filling…"
    : fill?.state === "filled" ? `Filled · ${Math.round((fill.fill?.stats?.fillRate ?? 0) * 100)}% tracks`
    : fill?.state === "claimed" ? "Claimed by a peer"
    : fill?.state === "pending" ? "Queued"
    : "";

  useEffect(() => {
    let alive = true;
    setCross(null); setRawItems(null); setError(null);
    artistImage(artist).then((u) => alive && setImage(u));
    crossReference(artist)
      .then((r) => alive && setCross(r))
      .catch(() => alive && setError("Could not load the canonical catalog."));
    searchByArtist(artist)
      .then((docs) => alive && setRawItems(docs.map(normalizeSearchItem)))
      .catch(() => {});
    return () => { alive = false; };
  }, [artist]);

  // Canonical available entries, correctly ordered by release year.
  const available = useMemo(
    () => (cross?.entries ?? []).filter((e) => e.status === "available").sort((a, b) => (a.year ?? 0) - (b.year ?? 0)),
    [cross]
  );
  const missing = useMemo(() => (cross?.entries ?? []).filter((e) => e.status === "missing"), [cross]);
  const coveragePct = cross ? Math.round(cross.coverage * 100) : 0;
  // Classical artists (Beethoven, Mozart…): order by WORK, not release year.
  const isClassical = looksClassical(available);
  const classicalGroups = useMemo(() => (isClassical ? groupByWork(available) : []), [available, isClassical]);

  return (
    <main className="pb-8">
      {/* —— Hero: Wikipedia portrait + canonical stats —— */}
      <header className="bg-gradient-to-b from-emerald-900/50 via-zinc-900/40 to-zinc-950 px-4 md:px-8 pt-10 md:pt-16 pb-8">
        <div className="mx-auto max-w-6xl flex flex-col items-center gap-6 sm:flex-row sm:items-end">
          <div className="h-40 w-40 md:h-52 md:w-52 shrink-0 overflow-hidden rounded-full bg-zinc-800 shadow-2xl shadow-black/50 ring-1 ring-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image ?? `https://archive.org/services/img/${encodeURIComponent(artist)}`}
              alt={artist}
              className="h-full w-full object-cover"
              onError={(e) => { e.currentTarget.style.opacity = 0.2; }}
            />
          </div>
          <div className="text-center sm:text-left">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400/90">Artist</p>
            <h1 className="mt-1 text-3xl md:text-5xl font-extrabold tracking-tight">{artist}</h1>
            <p className="mt-2 text-sm text-zinc-400">
              {cross ? (
                <>
                  <span className="text-emerald-400 font-semibold">{cross.available}</span> / {cross.entries.length} canonical albums available
                  {" · "}<span data-testid="coverage">{coveragePct}%</span> coverage
                  {cross.entries[0]?.year ? ` · from ${Math.min(...cross.entries.map(e => e.year ?? 9999))}` : ""}
                </>
              ) : "…"}
            </p>
            {/* F4: the fill queue is actionable — on-demand processing plus the
                honest shared state. No autoplay, no urgency mechanics. */}
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={fillNow}
                disabled={filling || fill?.state === "filled"}
                data-testid="fill-now"
                className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
              >
                {fillLabel || "Fill now"}
              </button>
              {fill?.state === "claimed" && (
                <span className="text-xs text-zinc-500">Another peer is working on this artist — the result will appear here for everyone.</span>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 md:px-8 pt-8">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {cross?.unreachable && (
          <p className="mb-4 rounded-lg border border-amber-700/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
            Canonical catalog temporarily unreachable (MusicBrainz is rate limiting us — the P2P warm-up shares the same quota). Raw items below are still browsable; retry in a minute.
          </p>
        )}

        {/* Loading skeletons */}
        {!cross && !error && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* —— Canonical discography: available. Classical → grouped by work; —— */}
        {/* otherwise flat grid ordered by release year.                        */}
        {isClassical ? (
          classicalGroups.map(([label, list]) => (
            <section key={label} className="mb-10">
              <h2 className="mb-4 text-xl font-bold tracking-tight">{label}</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
                {list.map((e) => (
                  <AlbumCard key={e.mbid} album={{ id: e.match.id, title: e.title, artist, year: e.year, quality: 3, downloads: 0 }} />
                ))}
              </div>
            </section>
          ))
        ) : cross ? (
          /* Always render the header once the cross-reference is loaded — even
             with 0 available (e.g. rate-limited matching or catalog-restricted
             artists like The Beatles). Honest empty state beats a missing UI. */
          <section className="mb-10">
            <h2 className="mb-4 text-xl font-bold tracking-tight">Discography · available</h2>
            {available.length === 0 && (
              <p className="text-sm text-zinc-500">Nothing available from our open legal sources yet — see the missing list below.</p>
            )}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
              {available.map((e) => (
                <AlbumCard key={e.mbid} album={{ id: e.match.id, title: e.title, artist, year: e.year, quality: 3, downloads: 0 }} />
              ))}
            </div>
          </section>
        ) : null}

        {/* —— Missing: the acquisition queue, collapsed by default —— */}
        {missing.length > 0 && (
          <section className="mb-10">
            <button onClick={() => setShowMissing((v) => !v)} className="text-sm text-zinc-500 hover:text-zinc-300">
              {showMissing ? "▾" : "▸"} Not available ({missing.length}) — in the canonical catalog, no open legal source found yet
            </button>
            {showMissing && (
              <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {missing.map((e) => (
                  <li key={e.mbid} className="flex items-center gap-3 rounded-lg border border-zinc-800/60 px-3 py-1.5">
                    <span className="text-xs text-zinc-600">✗</span>
                    <span className="flex-1 truncate text-sm text-zinc-500">{e.title}</span>
                    {e.year && <span className="text-xs tabular-nums text-zinc-700">{e.year}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* —— Raw archive.org items: secondary, clearly labeled —— */}
        {rawItems?.length > 0 && (
          <details className="mb-10">
            <summary className="cursor-pointer text-sm text-zinc-500 hover:text-zinc-300">
              All raw catalog items ({rawItems.length}) — unfiltered archive.org results
            </summary>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
              {rawItems.map((a) => <AlbumCard key={a.id} album={a} />)}
            </div>
          </details>
        )}
      </div>
    </main>
  );
}

/**
 * Static export wrapper: useSearchParams() requires a Suspense boundary
 * during prerender (Next.js requirement for output: "export").
 */
export default function ArtistPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-10"><p className="text-sm text-zinc-500">Loading…</p></main>}>
      <ArtistPageInner />
    </Suspense>
  );
}
