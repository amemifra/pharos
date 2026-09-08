"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayer } from "@/components/PlayerProvider";
import { thumbUrl } from "@/lib/archive";
import { loadPolicy, savePolicy, label, MODES } from "@/lib/restoration";
import Manifesto from "@/components/Manifesto";
import Icon from "@/components/Icon";

const fmt = (s) => {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

const SPEEDS = [0.5, 1, 1.25, 1.5, 2];

/**
 * Playback-rate selector (F6): 0.5×–2×. Per-show preference for podcasts is
 * persisted by lib/subscribe.js (pf.speed:<feedUrl>); for generic tracks the
 * last chosen speed is reused. Applied via the player's setSpeed command.
 */
function SpeedControl({ setSpeed, current }) {
  const feedUrl = current?.feedUrl;
  const [speed, setLocal] = useState(1);
  useEffect(() => {
    let s = 1;
    try {
      const key = feedUrl ? `pf.speed:${feedUrl}` : "pf.speed:last";
      s = Number(JSON.parse(localStorage.getItem(key) ?? "1")) || 1;
    } catch {}
    setLocal(s);
    setSpeed(s);
  }, [feedUrl, setSpeed]);
  const pick = (s) => {
    setLocal(s);
    setSpeed(s);
    try { localStorage.setItem(feedUrl ? `pf.speed:${feedUrl}` : "pf.speed:last", JSON.stringify(s)); } catch {}
  };
  return (
    <section className="w-full max-w-md" aria-label="Playback speed">
      <div className="flex items-center justify-center gap-2">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => pick(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium tabular-nums transition-colors ${
              speed === s ? "bg-emerald-600 text-white" : "bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800"
            }`}
            aria-pressed={speed === s}
          >
            {s}×
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * Now Playing full-screen overlay (spec Phase 3, Spotify/YT Music pattern).
 *
 * NOT a route: an overlay layer rendered inside the persistent shell, so the
 * player island (and audio) is never touched by open/close. Covers the mobile
 * bottom-nav (z-50). Gestures per spec: open = tap on the NowPlayingBar info
 * area; close = X button, swipe-down on the drag handle (touch), Escape key.
 * Transition: CSS slide-up; disabled under prefers-reduced-motion.
 */
export default function NowPlayingOverlay({ open, onClose }) {
  // Restoration selector (Off/Light/AI) — writes pf.restoration; the island
  // applies it live via the pharos:restoration event (lib/restoration.js).
  const [restoration, setRestoration] = useState("off");
  useEffect(() => { if (open) setRestoration(loadPolicy().mode); }, [open]);
  const pickRestoration = (mode) => {
    setRestoration(mode);
    savePolicy({ mode });
  };
  const { current, playing, toggle, skip, progress, duration, seek, hasNext, hasPrev, queue, index, jumpTo, setSpeed } = usePlayer();
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Escape to close (desktop keyboard contract).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while open (the overlay is the whole viewport).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open || !current) return null;

  const albumId = current.id.split("/")[0];
  const fill = duration ? Math.min(100, (progress / duration) * 100) : 0;

  /** Touch drag-down on the handle: >120px closes, else snap back. */
  const onTouchStart = (e) => { setDragging(true); setDragY(e.touches[0].clientY); };
  const onTouchMove = (e) => {
    if (!dragging) return;
    setDragY(Math.max(0, e.touches[0].clientY - e.currentTarget.getBoundingClientRect().top));
  };
  const onTouchEnd = () => {
    setDragging(false);
    if (dragY > 120) onClose();
    setDragY(0);
  };

  return (
    <div
      className={`fixed inset-0 z-50 bg-zinc-950 md:left-60 ${
        dragging ? "" : "transition-transform duration-300"
      } motion-reduce:transition-none`}
      style={{ transform: dragging && dragY > 0 ? `translateY(${dragY}px)` : "translateY(0)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
    >
      {/* drag handle (touch swipe-down to dismiss) */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="flex h-10 cursor-grab items-center justify-center"
        aria-hidden="true"
      >
        <span className="h-1.5 w-12 rounded-full bg-zinc-700" />
      </div>

      {/* Manifesto ⓘ (P0-DESIGN): the promise stated where people listen */}
      <span className="absolute right-14 top-3.5"><Manifesto align="right" drop="down" /></span>
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full p-2 text-zinc-400 transition-colors hover:text-white"
        aria-label="Close now playing"
      >
        <Icon name="close" className="h-5 w-5" />
      </button>

      <div className="flex h-[calc(100%-2.5rem)] flex-col items-center gap-6 overflow-y-auto px-6 pb-10 pt-4">
        {/* Large artwork */}
        <div className="h-64 w-64 shrink-0 overflow-hidden rounded-xl bg-zinc-800 shadow-2xl shadow-black/60 md:h-80 md:w-80">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbUrl(albumId)}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => { e.currentTarget.style.opacity = 0.2; }}
          />
        </div>

        <div className="w-full max-w-md text-center">
          <p className="truncate text-xl font-bold">{current.title}</p>
          <p className="mt-1 truncate text-sm text-zinc-500">{current.artist ?? current.__albumArtist ?? ""}</p>
        </div>

        {/* Seek bar */}
        <div className="w-full max-w-md">
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={1}
            value={progress}
            onChange={(e) => seek(Number(e.target.value))}
            className="player-range block w-full h-3"
            style={{ "--fill": `${fill}%` }}
            aria-label="Seek"
          />
          <div className="mt-1 flex justify-between text-xs tabular-nums text-zinc-500">
            <span>{fmt(progress)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        {/* Transport controls */}
        <div className="flex items-center gap-6">
          <button onClick={() => skip(-1)} disabled={!hasPrev} className="p-2 text-zinc-300 disabled:opacity-30" aria-label="Previous track">
            <Icon name="prev" className="h-7 w-7" />
          </button>
          <button
            onClick={toggle}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105"
            aria-label={playing ? "Pause" : "Play"}
          >
            <Icon name={playing ? "pause" : "play"} className="h-7 w-7" />
          </button>
          <button onClick={() => skip(1)} disabled={!hasNext} className="p-2 text-zinc-300 disabled:opacity-30" aria-label="Next track">
            <Icon name="next" className="h-7 w-7" />
          </button>
        </div>

        {/* Speed control 0.5×–2× (podcasts first, honest for music too) */}
        <SpeedControl setSpeed={setSpeed} current={current} />

        {/* Restoration selector — honest labels per mode (lib/restoration.js) */}
        <section className="w-full max-w-md mb-4" aria-label="Audio restoration">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Restoration
          </h3>
          <div className="flex gap-2">
            {MODES.map((mode) => (
              <button
                key={mode}
                onClick={() => pickRestoration(mode)}
                className={`rounded-full px-4 py-1.5 text-xs font-medium capitalize transition-colors ${
                  restoration === mode
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800"
                }`}
                aria-pressed={restoration === mode}
                title={label(mode)}
              >
                {mode === "ai" ? "AI" : mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </section>

        {/* Queue drawer */}
        <section className="w-full max-w-md" aria-label="Queue">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Queue · {index + 1}/{queue.length}
          </h3>
          <ol className="divide-y divide-zinc-800/60 rounded-lg border border-zinc-800/60">
            {queue.map((t, i) => (
              <li key={t.id}>
                <button
                  onClick={() => jumpTo(i)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${
                    i === index ? "bg-emerald-500/10 text-emerald-400" : "text-zinc-300 hover:bg-zinc-900"
                  }`}
                >
                  <span className="w-5 text-right text-xs tabular-nums text-zinc-600">{i + 1}</span>
                  <span className="flex-1 truncate">{t.title}</span>
                </button>
              </li>
            ))}
          </ol>
          {queue.length > queueWindow && (
            <button
              onClick={() => setQueueWindow((w) => w + 100)}
              className="mt-2 w-full rounded-lg border border-zinc-800 py-2 text-xs font-medium text-zinc-400 hover:text-white"
            >
              Show more ({queue.length - queueWindow} remaining)
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
