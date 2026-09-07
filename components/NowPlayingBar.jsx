"use client";

import { useState } from "react";
import { usePlayer } from "@/components/PlayerProvider";
import { thumbUrl } from "@/lib/archive";
import Icon from "@/components/Icon";
import NowPlayingOverlay from "@/components/NowPlayingOverlay";

/** Formats seconds as m:ss; non-finite input → "0:00". */
const fmt = (s) => {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

/**
 * Global "now playing" bar, Spotify-style.
 * Contract: mounted once in the root layout — it never unmounts on
 * navigation, which is why the audio element (in PlayerProvider) survives
 * route changes; positioned above the mobile bottom-nav.
 */
export default function NowPlayingBar() {
  const { current, playing, toggle, skip, progress, duration, seek, hasNext, hasPrev, queue, index } = usePlayer();
  // Full-screen overlay state (spec Phase 3). Overlay ≠ route: the audio
  // island is untouched by open/close.
  const [expanded, setExpanded] = useState(false);

  // Above the bottom-nav on mobile (h-14); on desktop it starts where the
  // sidebar (w-60) ends — the sidebar must never cover the player (Spotify-like).
  const base = "fixed bottom-14 inset-x-0 md:bottom-0 md:left-60 z-20 border-t border-zinc-800/80 bg-zinc-950/95 backdrop-blur";

  if (!current) {
    return (
      <footer className={`${base} flex h-12 items-center justify-center gap-2 text-xs text-zinc-600`}>
        <Icon name="note" className="h-4 w-4" />
        Public music from archive.org — search an album to start
      </footer>
    );
  }

  // Track id = "{identifier}/{fileName}" → mini-cover from the thumbnail service.
  const albumId = current.id.split("/")[0];
  const fill = duration ? Math.min(100, (progress / duration) * 100) : 0;

  return (
    <footer className={base}>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={1}
        value={progress}
        onChange={(e) => seek(Number(e.target.value))}
        className="player-range block w-full h-3 -mt-1"
        style={{ "--fill": `${fill}%` }}
        aria-label="Track progress"
      />
      <div className="flex h-16 items-center gap-3 px-3 md:px-4">
        {/* mini cover */}
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-zinc-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbUrl(albumId)}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        </div>

        {/* title/artist — tap opens the full-screen Now Playing overlay */}
        <button
          onClick={() => setExpanded(true)}
          className="min-w-0 flex-1 text-left md:max-w-xs"
          aria-label="Open now playing"
        >
          <p className="truncate text-sm font-semibold">{current.title}</p>
          <p className="truncate text-xs text-zinc-500">
            {fmt(progress)} / {fmt(duration)}
          </p>
        </button>

        {/* controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => skip(-1)}
            disabled={!hasPrev}
            className="rounded-full p-2 text-zinc-400 transition-colors hover:text-white disabled:opacity-30"
            aria-label="Previous track"
          >
            <Icon name="prev" className="h-5 w-5" />
          </button>
          <button
            onClick={toggle}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105"
            aria-label={playing ? "Pause" : "Play"}
          >
            <Icon name={playing ? "pause" : "play"} className="h-5 w-5" />
          </button>
          <button
            onClick={() => skip(1)}
            disabled={!hasNext}
            className="rounded-full p-2 text-zinc-400 transition-colors hover:text-white disabled:opacity-30"
            aria-label="Next track"
          >
            <Icon name="next" className="h-5 w-5" />
          </button>
        </div>

        <span className="hidden md:inline text-xs tabular-nums text-zinc-600">
          {index + 1}/{queue.length}
        </span>
      </div>

      <NowPlayingOverlay open={expanded} onClose={() => setExpanded(false)} />
    </footer>
  );
}
