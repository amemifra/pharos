"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import PlayerIsland from "@/components/PlayerIsland";
import { loadPolicy, chooseVariant, reportStall } from "@/lib/formatpolicy";

/**
 * Global player provider — thin proxy over the player island (phase 1).
 *
 * Architecture (docs/ux-architecture.md §3.3): the <audio> element lives in
 * the /player iframe island and NEVER unmounts on navigation. This provider:
 *   - mirrors island state (pf.state messages) into React for the UI;
 *   - forwards commands (play/pause/seek/skip) via postMessage;
 *   - keeps the queue in React state (single source of truth for the UI) and
 *     persists it to `pf.queue` so the shell re-hydrates after a full reload;
 *   - writes play history to `pf.recent` for the /library page.
 *
 * FALLBACK (documented per contract): if the island does not signal `pf.ready`
 * within ISLAND_TIMEOUT_MS (old browser, sandbox unavailable, static export
 * quirks), the provider switches to "inline" mode and owns a plain <audio>
 * element itself — exactly the pre-island behaviour. The island is an
 * enhancement, never a dependency.
 *
 * The public usePlayer() API is unchanged from the pre-island provider, so
 * NowPlayingBar, AlbumCard and tracklists keep working untouched.
 */

const ISLAND_TIMEOUT_MS = 3000;

/** @typedef {import("@/lib/pipeline").Track} Track */

const PlayerContext = createContext(null);

/** LocalStorage helpers — all island/shell persistence is namespaced pf.*. */
const readLS = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
};
const writeLS = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};

export function PlayerProvider({ children }) {
  const islandRef = useRef(null);

  // Mirrored island state (also the inline-mode state).
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  // Mode: "island" (default, confirmed by pf.ready) | "inline" (fallback) |
  // "pending" (deciding).
  const [mode, setMode] = useState("pending");
  const inlineAudioRef = useRef(null);
  // F3: per-version feedback bookkeeping (one completion per track per load).
  const queueRef = useRef([]);
  const completedRef = useRef(new Set());
  // SESSION RESUME (shell-side): last observed position + playing state,
  // persisted in pf.queue so ANY reload resumes from the same minute. The
  // track URL/id is the map key (queue[index].url) — island and inline both
  // restore from this single source of truth.
  const resumeRef = useRef({ position: 0, playing: false });
  const lastSessionSaveRef = useRef(0);

  // Shell-side queue + session rehydration after a full reload.
  useEffect(() => {
    const saved = readLS("pf.queue", null);
    if (saved && Array.isArray(saved.queue) && saved.queue.length) {
      setQueue(saved.queue);
      setIndex(saved.index ?? 0);
      resumeRef.current = { position: Number(saved.position) || 0, playing: !!saved.playing };
    }
  }, []);

  // Island handshake: pf.ready within the timeout, else inline fallback.
  useEffect(() => {
    const timer = setTimeout(() => {
      setMode((m) => (m === "pending" ? "inline" : m));
    }, ISLAND_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  /** shell → island postMessage (no-op in inline mode). */
  const post = useCallback((msg) => {
    if (mode !== "island") return;
    try { islandRef.current?.contentWindow?.postMessage(msg, "*"); } catch {}
  }, [mode]);

  /** shell ← island message pump. */
  const onIslandMessage = useCallback((msg) => {
    switch (msg.type) {
      case "pf.ready":
        setMode("island");
        // Re-send the queue ONLY if the island is not already on our current
        // track (shell full-reload case: island kept playing — do not restart).
        // When we DO re-send, carry the session resume (position + play state).
        {
          const saved = readLS("pf.queue", null);
          if (saved?.queue?.length) {
            const shellCurrent = saved.queue[saved.index ?? 0]?.id ?? null;
            if (msg.trackId !== shellCurrent) {
              post({
                type: "pf.load",
                tracks: saved.queue,
                index: saved.index ?? 0,
                position: Number(saved.position) || 0,
                play: !!saved.playing,
              });
            }
          }
        }
        break;
      case "pf.state":
        if (typeof msg.playing === "boolean") setPlaying(msg.playing);
        if (Number.isFinite(Number(msg.index))) setIndex(Number(msg.index));
        if (Number.isFinite(Number(msg.progress))) setProgress(Number(msg.progress));
        if (Number.isFinite(Number(msg.duration))) setDuration(Number(msg.duration));
        // SESSION RESUME: throttle-persist the position + play state (3s) so
        // a reload resumes from THIS minute, keyed by the track URL/id.
        {
          const now = Date.now();
          if (now - lastSessionSaveRef.current > 3000) {
            lastSessionSaveRef.current = now;
            resumeRef.current = { position: Number(msg.progress) || 0, playing: !!msg.playing };
            if (queueRef.current.length) {
              writeLS("pf.queue", {
                queue: queueRef.current,
                index: Number.isFinite(Number(msg.index)) ? Number(msg.index) : index,
                position: Number(msg.progress) || 0,
                playing: !!msg.playing,
              });
            }
          }
        }
        // F3: per-version feedback — completion when ≥60% or ≥30s listened.
        if (Number.isFinite(Number(msg.progress)) && Number.isFinite(Number(msg.duration)) && msg.duration > 0) {
          const t = queueRef.current[msg.index];
          if (t && !completedRef.current.has(t.id) &&
              (msg.progress / msg.duration >= 0.6 || msg.progress >= 30)) {
            completedRef.current.add(t.id);
            import("@/lib/feedback").then((fb) => fb.recordVersionPlay(t.id, t.url, { completed: true }));
          }
        }
        break;
      case "pf.stall":
        // Auto policy: repeated buffering stalls downgrade the ceiling; the
        // next queue load plays lower-rank variants (documented decision table
        // in lib/formatpolicy.js).
        reportStall();
        break;
    }
  }, [post]);

  // Shell-side message listener — without this the shell never hears the
  // island (pf.ready/pf.state/pf.stall) and stays in "pending" forever.
  useEffect(() => {
    window.addEventListener("message", onIslandMessage);
    return () => window.removeEventListener("message", onIslandMessage);
  }, [onIslandMessage]);

  // Race guard: if the user hits Play while mode is "pending" (island still
  // booting), the command would be dropped by both branches of playQueue.
  // Re-issue the current queue once the mode resolves — WITH session resume.
  const modeRef = useRef(mode);
  useEffect(() => {
    if ((mode === "island" || mode === "inline") && modeRef.current === "pending") {
      modeRef.current = mode;
      if (queue.length && index >= 0) {
        if (mode === "island") {
          post({
            type: "pf.load",
            tracks: queue,
            index,
            position: resumeRef.current.position,
            play: resumeRef.current.playing,
          });
        } else {
          const audio = inlineAudioRef.current;
          const track = queue[index];
          if (audio && track) {
            audio.src = track.url;
            const { position, playing } = resumeRef.current;
            const onMeta = () => {
              if (position > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
                audio.currentTime = Math.min(position, Math.max(0, audio.duration - 1));
              }
              if (playing) audio.play().catch(() => {}); // autoplay policy: paused at position
            };
            audio.addEventListener("loadedmetadata", onMeta, { once: true });
          }
        }
      }
    } else {
      modeRef.current = mode;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Note: no re-send effect on mode flip — the pf.ready handler above owns
  // the conditional re-send (it knows the island's current trackId).

  // Persist the shell-side queue (the island keeps its own pf.player.queue).
  // Defect #27 (HANDOFF-REVIEW): this fired on EVERY queue/index change and
  // rewrote the record WITHOUT position/playing → the saved minute + play
  // state were clobbered (session resume broke: reload → paused from 0 or
  // silent no-resume). MERGE with the saved record instead: queue/index
  // update, position/playing survive until the next island pf.state
  // (throttled 3s) refreshes them with live values.
  useEffect(() => {
    if (!queue.length) return;
    const saved = readLS("pf.queue", null);
    writeLS("pf.queue", {
      ...(saved && typeof saved === "object" ? saved : {}),
      queue,
      index,
    });
  }, [queue, index]);

  /** Persist play history for /library (dedup by track id, cap 20). */
  const rememberRecent = useCallback((track) => {
    if (!track?.id) return;
    const prev = readLS("pf.recent", []);
    const entry = {
      id: track.id,
      title: track.title,
      artist: track.artist ?? track.__albumArtist ?? "",
      albumId: track.id.split("/")[0],
      at: Date.now(),
      // Podcasts count as listening activity (owner) but must NOT be rendered
      // as archive.org AlbumCards (guid ≠ item/fileName): carry the medium.
      medium: track.medium === "podcast" ? "podcast" : "music",
      feedUrl: track.feedUrl ?? null,
      cover: track.cover ?? null,
      video: !!track.video,
    };
    writeLS("pf.recent", [entry, ...prev.filter((e) => e.id !== entry.id)].slice(0, 20));
  }, []);

  const current = index >= 0 ? queue[index] ?? null : null;

  // Video podcast view (owner): NEVER auto-opens (many audio-only feeds are
  // mislabeled video/mp4 — the black full-screen of a false positive is
  // worse than a tap). The view exists only when the user opens it from the
  // NowPlayingBar and auto-hides when the current track is not video.
  const [videoView, setVideoView] = useState("hidden");
  useEffect(() => {
    setVideoView((v) => (current?.video ? v : "hidden"));
  }, [current?.video]);

  /**
   * Load a queue and start playback. Same contract as the pre-island API.
   * @param {Track[]} tracks
   * @param {number} [startIndex=0]
   */
  const playQueue = useCallback((tracks, startIndex = 0) => {
    if (!tracks?.length) return;
    // Format policy: resolve each track's variant per the active policy
    // (best | manual | auto with connection + stall feedback).
    const policy = loadPolicy();
    const q = tracks.map((t) => {
      const v = chooseVariant(t.variants?.length ? t.variants : [{ format: t.format, url: t.url }], policy);
      return v ? { ...t, url: v.url, format: v.format } : t;
    });
    const i = Math.max(0, Math.min(startIndex, q.length - 1));
    setQueue(q);
    setIndex(i);
    rememberRecent(q[i]);
    completedRef.current = new Set();
    queueRef.current = q;
    // F3: record the START of a version play (completion is registered on
    // pf.state once ≥60%/30s is listened).
    import("@/lib/feedback").then((fb) => fb.recordVersionPlay(q[i].id, q[i].url, { completed: false }))
      .then(() => {
        // Community listening chart: aggregate per-artist plays (P2P, counts only).
        return import("@/lib/feedback").then(async (fb) => {
          const artist = q[i].artist ?? q[i].__albumArtist ?? "";
          if (artist) fb.recordArtistListen(artist, { completed: false });
          await fb.publishArtistListens();
        });
      })
      .then(() => import("@/lib/feedback").then((fb2) => fb2.publishVersionConsensus()))
      .catch(() => {});
    if (mode === "island") {
      post({ type: "pf.load", tracks: q, index: i });
    } else if (mode === "inline") {
      const audio = inlineAudioRef.current;
      if (audio) {
        audio.src = q[i].url;
        audio.play().catch(() => {});
      }
    }
  }, [mode, post, rememberRecent]);

  /** Toggle play/pause of the current track. */
  const toggle = useCallback(() => {
    if (!current) return;
    if (mode === "island") {
      post({ type: "pf.command", cmd: playing ? "pause" : "play" });
    } else if (mode === "inline") {
      const audio = inlineAudioRef.current;
      if (!audio) return;
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    }
  }, [current, mode, playing, post]);

  /** Skip relative to the current index (positive = next). */
  const skip = useCallback((delta) => {
    const next = Math.min(Math.max(index + delta, 0), queue.length - 1);
    if (next === index) return;
    setIndex(next);
    rememberRecent(queue[next]);
    if (mode === "island") {
      post({ type: "pf.load", tracks: queue, index: next });
    } else if (mode === "inline") {
      const audio = inlineAudioRef.current;
      if (audio && queue[next]) {
        audio.src = queue[next].url;
        audio.play().catch(() => {});
      }
    }
  }, [index, queue, mode, post, rememberRecent]);

  /** Seek to an absolute position in seconds. */
  const seek = useCallback((seconds) => {
    if (mode === "island") post({ type: "pf.command", cmd: "seek", payload: seconds });
    else if (inlineAudioRef.current) inlineAudioRef.current.currentTime = seconds;
  }, [mode, post]);

  /** Playback rate 0.5×–2× (podcasts, F6): island or inline audio. */
  const setSpeed = useCallback((rate) => {
    const r = Math.min(2, Math.max(0.5, Number(rate) || 1));
    if (mode === "island") post({ type: "pf.command", cmd: "speed", payload: r });
    else if (inlineAudioRef.current) inlineAudioRef.current.playbackRate = r;
  }, [mode, post]);

  /** Jump to an absolute queue index (queue drawer click). */
  const jumpTo = useCallback((i) => {
    if (i < 0 || i >= queue.length) return;
    setIndex(i);
    rememberRecent(queue[i]);
    if (mode === "island") post({ type: "pf.load", tracks: queue, index: i });
    else if (mode === "inline" && inlineAudioRef.current && queue[i]) {
      inlineAudioRef.current.src = queue[i].url;
      inlineAudioRef.current.play().catch(() => {});
    }
  }, [queue, mode, post, rememberRecent]);

  const value = {
    queue, index, current, playing, progress, duration,
    playQueue, toggle, skip, seek, jumpTo, setSpeed,
    hasNext: index < queue.length - 1,
    hasPrev: index > 0,
    // Video podcast view (owner): "hidden" | "pip" | "full" — the island
    // iframe carries the actual <video>; NowPlayingBar toggles it.
    videoView,
    setVideoView,
  };

  return (
    <PlayerContext.Provider value={value}>
      {children}
      {mode !== "inline" && (
        <PlayerIsland
          onMessage={onIslandMessage}
          islandRef={islandRef}
          videoView={videoView}
          onCollapse={() => setVideoView("hidden")}
        />
      )}
      {mode === "inline" && (
        <audio
          ref={inlineAudioRef}
          preload="metadata"
          style={{ display: "none" }}
          aria-hidden="true"
          onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            if (index < queue.length - 1) skip(1);
          }}
        />
      )}
    </PlayerContext.Provider>
  );
}

/**
 * Accesses the global player state.
 * Contract: throws when used outside PlayerProvider (fail fast in dev).
 * @returns {{queue: Track[], index: number, current: Track|null, playing: boolean,
 *   progress: number, duration: number, playQueue: Function, toggle: Function,
 *   skip: Function, seek: Function, hasNext: boolean, hasPrev: boolean}}
 */
export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
