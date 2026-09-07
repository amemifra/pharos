"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { fetchItemMetadata, thumbUrl } from "@/lib/archive";
import { normalizeAlbum } from "@/lib/pipeline";
import { canonicalFor, publishIdentification } from "@/lib/canonical";
import { alignTracklist, resolveReleaseGroup } from "@/lib/tracklist";
import { loadPolicy, savePolicy, FORMAT_RANK } from "@/lib/formatpolicy";
import { usePlayer } from "@/components/PlayerProvider";
import Icon from "@/components/Icon";

/** Formats seconds as m:ss; non-finite input → "—". */
const fmt = (s) => {
  if (!Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

/**
 * Format selector (album header): Best (default) / Auto (bandwidth + stalls,
 * decision table in lib/formatpolicy.js) / explicit format rank. Persisted in
 * localStorage; takes effect on the next queue load (playQueue resolves
 * variants via chooseVariant).
 */
const FORMAT_CHOICES = ["best", "auto", "flac", "24bit flac", "vbr mp3", "mp3"];
function FormatSelector() {
  const [policy, setPolicy] = useState(null);
  useEffect(() => { setPolicy(loadPolicy()); }, []);
  if (!policy) return null;
  const set = (mode, manual = null) => {
    const next = { ...policy, mode, manual: manual ?? null };
    savePolicy(next);
    setPolicy(next);
  };
  return (
    <select
      value={policy.mode === "manual" ? policy.manual : policy.mode}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "best" || v === "auto") set(v);
        else set("manual", v);
      }}
      className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300"
      aria-label="Audio format preference"
      data-testid="format-selector"
    >
      {FORMAT_CHOICES.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
    </select>
  );
}

/** Track title the pipeline considers unreliable → verification candidate. */
const JUNK_TRACK = /^[*_\-.:\s]*$|^\*+$|^(track|audio|untitled)?\s*\d*$/i;
const needsVerify = (t) => JUNK_TRACK.test(t.title) || t.title.length < 3;

/**
 * Album detail page with streamable tracklist.
 * Contract: metadata fetch + normalization run client-side; the "to verify"
 * badge appears only on unreliable titles and triggers the canonicalization
 * cascade (text → community → acoustic fingerprint).
 */
function AlbumPageInner() {
  // Static-export routing: the album is ?id=<archive.org identifier>, with
  // optional ?n=<artist> for the breadcrumb (the album object itself carries
  // the real artist once metadata loads). Legacy #/artist/X/album/Y hash
  // links are rewritten to this form by the shim in (shell)/layout.jsx.
  const params = useSearchParams();
  const identifier = params.get("id") ?? "";
  const artistSegment = params.get("n");
  const { playQueue, current, toggle, playing } = usePlayer();
  const [album, setAlbum] = useState(null);
  const [error, setError] = useState(null);
  // Map trackId → {artist, title, confidence, level} of canonical metadata.
  const [canonical, setCanonical] = useState({});
  const [identifying, setIdentifying] = useState(null); // trackId in progress

  const identify = async (track) => {
    setIdentifying(track.id);
    try {
      // L2 now runs through the shared catalog store (lib/catalogstore.js):
      // no explicit OrbitDB handle needed here, helia stays out of the bundle.
      const result = await canonicalFor(track, { allowFingerprint: true });
      if (result) {
        setCanonical((m) => ({ ...m, [track.id]: result }));
        if (result.confidence >= 0.6) {
          publishIdentification(track.id, result).catch(() => {});
        }
      }
    } finally {
      setIdentifying(null);
    }
  };

  useEffect(() => {
    let alive = true;
    setAlbum(null);
    setError(null);
    fetchItemMetadata(identifier)
      .then((meta) => {
        if (!alive) return;
        const base = normalizeAlbum(identifier, meta);
        setAlbum(base);
        // Canonical tracklist alignment (async enrichment): MusicBrainz order
        // wins, compound vinyl-side tracks merge with seek offsets.
        resolveReleaseGroup(base.artist, base.title)
          .then((rg) => rg ? alignTracklist(base, rg) : base)
          .then((aligned) => { if (alive) setAlbum(aligned); })
          .catch(() => {});
      })
      .catch(() => alive && setError("Could not load the album from archive.org."));
    return () => { alive = false; };
  }, [identifier]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-sm text-red-400">{error}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-emerald-400 hover:underline">← Back to home</Link>
      </main>
    );
  }

  if (!album) {
    return (
      <main className="pb-8">
        <div className="bg-gradient-to-b from-emerald-900/50 via-zinc-900/40 to-zinc-950 px-4 md:px-8 pt-10 md:pt-16 pb-8">
          <div className="mx-auto max-w-5xl flex flex-col sm:flex-row gap-6 items-center sm:items-end">
            <div className="shimmer h-44 w-44 md:h-56 md:w-56 rounded-xl" />
            <div className="w-full max-w-md space-y-3">
              <div className="shimmer h-3 w-20 rounded" />
              <div className="shimmer h-8 w-3/4 rounded" />
              <div className="shimmer h-3 w-1/2 rounded" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  const cover = album.cover || thumbUrl(album.id);
  const isCurrentAlbum = current?.id?.startsWith(`${album.id}/`);

  return (
    <main className="pb-8">
      {/* Breadcrumb: Artist / Album — the artist segment is cosmetic but always present */}
      <nav className="mx-auto max-w-5xl px-4 md:px-8 pt-4 text-xs text-zinc-500" aria-label="Breadcrumb">
        <Link href={`/artist?n=${encodeURIComponent(artistSegment ?? album?.artist ?? "artist")}`} className="hover:text-emerald-400">
          {artistSegment ?? album?.artist ?? "Artist"}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-zinc-400">{album?.title ?? "…"}</span>
      </nav>
      {/* —— Album hero —— */}
      <header className="bg-gradient-to-b from-emerald-900/50 via-zinc-900/40 to-zinc-950 px-4 md:px-8 pt-10 md:pt-16 pb-8">
        <div className="mx-auto max-w-5xl flex flex-col items-center gap-6 sm:flex-row sm:items-end">
          <div className="h-44 w-44 md:h-56 md:w-56 shrink-0 overflow-hidden rounded-xl bg-zinc-800 shadow-2xl shadow-black/50 ring-1 ring-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cover}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => { e.currentTarget.style.opacity = 0.2; }}
            />
          </div>
          <div className="text-center sm:text-left">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400/90">Album</p>
            <h1 className="mt-1 text-2xl md:text-4xl font-extrabold tracking-tight">{album.title}</h1>
            <p className="mt-2 text-sm text-zinc-400">
              <Link href={`/artist?n=${encodeURIComponent(album.artist)}`} className="font-medium text-zinc-200 hover:text-emerald-400 hover:underline">
                {album.artist}
              </Link>
              {album.year ? ` · ${album.year}` : ""} · {album.tracks.length} tracks
            </p>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => playQueue(album.tracks, 0)}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-2.5 text-sm font-bold text-black transition-all hover:bg-emerald-400 hover:scale-105"
              >
                <Icon name={isCurrentAlbum && playing ? "pause" : "play"} className="h-4 w-4" />
                Play
              </button>
              <FormatSelector />
            </div>
          </div>
        </div>
      </header>

      {/* —— Tracklist —— */}
      <div className="mx-auto max-w-5xl px-4 md:px-8 pt-6">
        <ol>
          {album.tracks.map((track, i) => {
            const isCurrent = current?.id === track.id;
            return (
              <li key={track.id}>
                <button
                  onClick={() => (isCurrent ? toggle() : playQueue(album.tracks, i))}
                  className="group flex w-full items-center gap-4 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-zinc-900/70"
                >
                  <span className={`w-6 text-right text-sm tabular-nums ${isCurrent ? "text-emerald-400" : "text-zinc-600"}`}>
                    <span className="group-hover:hidden">{isCurrent && playing ? "♪" : track.number}</span>
                    <span className="hidden group-hover:inline text-zinc-200">
                      <Icon name={isCurrent && playing ? "pause" : "play"} className="inline h-3.5 w-3.5" />
                    </span>
                  </span>
                  <span className={`flex-1 truncate text-sm ${isCurrent ? "font-medium text-emerald-400" : ""}`}>
                    {canonical[track.id] ? (
                      <>
                        {canonical[track.id].title}
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-500/80">
                          ✓ {canonical[track.id].artist} · {Math.round(canonical[track.id].confidence * 100)}%
                        </span>
                      </>
                    ) : (
                      track.title
                    )}
                    {needsVerify(track) && !canonical[track.id] && (
                      <button
                        onClick={(e) => { e.stopPropagation(); identify(track); }}
                        disabled={identifying != null}
                        className="ml-2 inline-flex items-center rounded border border-amber-700/50 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
                        title="Identify via MusicBrainz / acoustic fingerprint"
                      >
                        {identifying === track.id ? "identifying…" : "? needs verification"}
                      </button>
                    )}
                  </span>
                  {track.format && (
                    <span className="hidden sm:inline rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
                      {track.format}
                    </span>
                  )}
                  {track.duration && (
                    <span className="text-xs tabular-nums text-zinc-500">{fmt(track.duration)}</span>
                  )}
                </button>
                {track.compound && (
                  <ul className="mb-1 ml-12 border-l border-zinc-800 pl-3">
                    {track.compound.works.map((work, k) => (
                      <li key={k}>
                        <button
                          onClick={() => {
                            playQueue(album.tracks, i);
                            // Seek to the sub-work's start offset once loaded.
                            setTimeout(() => seek(track.compound.starts[k] ?? 0), 900);
                          }}
                          className="flex w-full items-center gap-2 py-1 text-left text-xs text-zinc-400 hover:text-emerald-400"
                        >
                          <span className="tabular-nums text-zinc-600">{fmt(track.compound.starts[k] ?? 0)}</span>
                          <span className="truncate">{work}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </main>
  );
}

/**
 * Static export wrapper: useSearchParams() requires a Suspense boundary
 * during prerender (Next.js requirement for output: "export").
 */
export default function AlbumPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-10"><p className="text-sm text-zinc-500">Loading…</p></main>}>
      <AlbumPageInner />
    </Suspense>
  );
}
