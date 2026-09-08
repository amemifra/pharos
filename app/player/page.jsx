"use client";

import { useEffect, useRef } from "react";
import { assetPath } from "@/lib/basepath";

/**
 * PLAYER ISLAND (phase 1 of docs/ux-architecture.md).
 *
 * A standalone route (/player) loaded by the shell inside an iframe with
 * sandbox="allow-scripts allow-same-origin" (same-origin is required so the
 * island can use localStorage for queue persistence; it renders no untrusted
 * content, per the spec's explicit allowance for the player island only).
 *
 * Why an island: the iframe document never unmounts on shell navigation, even
 * when the shell's React tree is hot-reloaded or reset by an error boundary —
 * audio persistence becomes a browser guarantee, not a framework convention.
 *
 * Message contract (validated with a `type` discriminator, per the spec):
 *   shell → island:
 *     { type: "pf.load",    tracks: Track[], index: number }
 *     { type: "pf.command", cmd: "play"|"pause"|"seek"|"skip", payload?: number }
 *   island → shell:
 *     { type: "pf.ready" }
 *     { type: "pf.state", playing, index, progress, duration }  (≤1/s on progress)
 *
 * The island owns persistence for its queue under the namespaced key
 * `pf.player.queue`: when the SHELL reloads, the shell re-hydrates from
 * `pf.queue`; when only the shell dies and the island lives, playback simply
 * continues. `pf.load` always carries the full tracks array (island never
 * fetches metadata — the shell owns all data).
 */
export default function PlayerIslandPage() {
  const audioRef = useRef(null);
  const queueRef = useRef([]);
  const indexRef = useRef(-1);
  const lastStateSentRef = useRef(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    /** Restore the island-owned queue (opaque-origin safe: try/catch).
     *  The snapshot carries position + playing: after a full reload the
     *  track resumes WHERE it was, and only auto-resumes if it was playing
     *  (best effort — autoplay policies may keep it paused at position). */
    let restorePosition = 0;
    let resumePlaying = false;
    try {
      const saved = JSON.parse(localStorage.getItem("pf.player.queue") ?? "null");
      if (saved && Array.isArray(saved.tracks) && saved.tracks.length) {
        queueRef.current = saved.tracks;
        indexRef.current = Math.max(0, Math.min(saved.index ?? 0, saved.tracks.length - 1));
        restorePosition = Number(saved.position) || 0;
        resumePlaying = !!saved.playing;
        audio.src = saved.tracks[indexRef.current].url;
      }
    } catch {}

    /** Push a state snapshot to the shell (throttled to 1/s for timeupdate). */
    const sendState = (force = false) => {
      const now = Date.now();
      if (!force && now - lastStateSentRef.current < 1000) return;
      lastStateSentRef.current = now;
      try {
        window.parent.postMessage({
          type: "pf.state",
          playing: audio && !audio.paused,
          index: indexRef.current,
          progress: audio?.currentTime ?? 0,
          duration: audio?.duration ?? 0,
        }, "*");
      } catch {}
    };

    /** Load track at index and play. */
    const loadAndPlay = () => {
      const track = queueRef.current[indexRef.current];
      if (!track) return;
      audio.src = track.url;
      audio.play().catch(() => {});
    };

    /**
     * Gramophone-noise restoration (lib/restoration.js) — OFF by default.
     * Builds the Web Audio graph inside the island: MediaElementSource →
     * 80 Hz high-pass (rumble) → de-tick AudioWorklet → destination.
     * AI mode requires a wired model (lib/restore-model.js) and reports
     * honest unavailability otherwise. Never blocks the main thread beyond
     * graph construction (the worklet runs on the audio render thread).
     *
     * P0#3: createMediaElementSource reroutes the element PERMANENTLY to its
     * context — it can never be undone, only bypassed. The old code closed
     * the context on "off" (element still routed to a CLOSED context =
     * permanent silence) and re-created the source on "light" (InvalidState-
     * Error). So: ONE context + ONE source node, built lazily; toggling
     * rewires the chain, "off" bypasses the graph (src → destination) and
     * suspends. The worklet module is loaded BEFORE the element is routed so
     * a load failure leaves playback on the default destination.
     */
    let restorationCtx = null;
    let restorationSrc = null;
    let lightChain = null;
    const bypassRestoration = () => {
      if (!restorationCtx || !restorationSrc) return;
      if (lightChain) { try { lightChain.hp.disconnect(); lightChain.worklet.disconnect(); } catch {} lightChain = null; }
      try { restorationSrc.disconnect(); restorationSrc.connect(restorationCtx.destination); } catch {}
      restorationCtx.suspend().catch(() => {});
    };
    const applyRestoration = async (mode) => {
      try {
        if (mode === "ai") {
          const model = await import("@/lib/restore-model.js").then((m) => m.checkModel());
          if (!model.available) {
            bypassRestoration();
            window.__pharosRestoration = { mode: "ai", active: false, status: "model unavailable" };
            return;
          }
          // A wired model would insert the WASM denoise node here (see
          // lib/restore-model.js wiring notes) — full integration lands with
          // the model file itself. Until then "ai" runs the light chain.
        }
        if (mode === "off") {
          bypassRestoration();
          window.__pharosRestoration = { mode: "off", active: false };
          return;
        }
        if (!restorationCtx) {
          restorationCtx = new AudioContext();
          // Worklet first: on load failure the element stays unrouted →
          // audio keeps flowing to the default destination (honest degrade).
          await restorationCtx.audioWorklet.addModule(assetPath("/worklets/restore-worklet.js"));
          restorationSrc = restorationCtx.createMediaElementSource(audio); // once, ever
        }
        restorationCtx.resume().catch(() => {});
        const hp = restorationCtx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 80; // turntable rumble band
        const workletNode = new AudioWorkletNode(restorationCtx, "restore-worklet");
        if (lightChain) { try { lightChain.hp.disconnect(); lightChain.worklet.disconnect(); } catch {} }
        restorationSrc.disconnect();
        restorationSrc.connect(hp).connect(workletNode).connect(restorationCtx.destination);
        lightChain = { hp, worklet: workletNode };
        window.__pharosRestoration = { mode, active: true };
      } catch {
        // Restoration must never break playback: degrade to off honestly.
        bypassRestoration();
        window.__pharosRestoration = { mode, active: false, status: "graph failed" };
      }
    };

    const readRestoration = () => {
      try {
        const raw = JSON.parse(localStorage.getItem("pf.restoration") ?? "null");
        return raw?.mode ?? "off";
      } catch { return "off"; }
    };
    const onRestorationChange = () => applyRestoration(readRestoration());
    window.addEventListener("pharos:restoration", onRestorationChange);
    applyRestoration(readRestoration());

    const persist = () => {
      try {
        localStorage.setItem("pf.player.queue", JSON.stringify({
          tracks: queueRef.current,
          index: indexRef.current,
          position: audio?.currentTime ?? 0,
          playing: audio ? !audio.paused : false,
        }));
      } catch {}
    };

    /** Throttled snapshot while playing (3s) + on tab close: the reload
     *  resumes from the last saved position, not from zero. */
    let lastPersist = 0;
    const persistThrottled = () => {
      const now = Date.now();
      if (now - lastPersist < 3000) return;
      lastPersist = now;
      persist();
    };
    const onPageHide = () => persist();

    /** shell → island message handler. */
    const onMessage = (e) => {
      const msg = e.data;
      if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("pf.")) return;
      switch (msg.type) {
        case "pf.load": {
          if (!Array.isArray(msg.tracks) || !msg.tracks.length) return;
          queueRef.current = msg.tracks;
          indexRef.current = Math.max(0, Math.min(Number(msg.index) || 0, msg.tracks.length - 1));
          // Session resume (shell-requested): seek here + optional autoplay.
          // 0 = start from the beginning; play === false → load paused.
          restorePosition = Number(msg.position) || 0;
          resumePlaying = msg.play !== false;
          persist();
          loadAndPlay();
          if (!resumePlaying) { audio.pause(); resumePlaying = false; }
          sendState(true);
          break;
        }
        case "pf.command": {
          switch (msg.cmd) {
            case "play": audio.play().catch(() => {}); break;
            case "pause": audio.pause(); break;
            case "seek": if (Number.isFinite(Number(msg.payload))) audio.currentTime = Number(msg.payload); break;
            case "speed": if (Number.isFinite(Number(msg.payload))) audio.playbackRate = Math.min(2, Math.max(0.5, Number(msg.payload))); break;
            case "skip": {
              const next = Math.min(Math.max(indexRef.current + (Number(msg.payload) || 1), 0), queueRef.current.length - 1);
              if (next !== indexRef.current) {
                indexRef.current = next;
                persist();
                loadAndPlay();
                sendState(true);
              }
              break;
            }
          }
          break;
        }
      }
    };

    const onTimeUpdate = () => { sendState(false); persistThrottled(); };
    const onLoadedMetadata = () => {
      // Resume from the persisted position exactly once, per track load.
      if (restorePosition > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = Math.min(restorePosition, Math.max(0, audio.duration - 1));
        restorePosition = 0;
      }
      if (resumePlaying) {
        resumePlaying = false;
        audio.play().catch(() => { /* autoplay blocked: paused at position */ });
      }
      sendState(true);
    };
    const onPlay = () => sendState(true);
    const onPause = () => sendState(true);
    const onEnded = () => {
      // Auto-advance inside the island: the shell learns via pf.state.index.
      const next = indexRef.current + 1;
      if (next < queueRef.current.length) {
        indexRef.current = next;
        persist();
        loadAndPlay();
      }
      sendState(true);
    };

    /** Stall monitoring (auto format policy): two consecutive waits > 2s
     *  within one track → tell the shell to downgrade the next ceiling rank.
     *  Contract: pf.stall messages are advisory; the shell decides (policy). */
    let stallStart = 0;
    let stallCount = 0;
    const onWaiting = () => { stallStart = Date.now(); };
    const onPlayingAfterStall = () => {
      if (!stallStart) return;
      const waited = Date.now() - stallStart;
      stallStart = 0;
      if (waited > 2000 && ++stallCount >= 2) {
        stallCount = 0;
        try { window.parent.postMessage({ type: "pf.stall", waitedMs: waited }, "*"); } catch {}
      }
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("pagehide", onPageHide);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlayingAfterStall);

    // Handshake: declare what is already loaded (if the island survived a
    // shell reload while playing, the shell must NOT re-send pf.load — that
    // would restart the track from zero).
    try {
      window.parent.postMessage({ type: "pf.ready", version: 1, trackId: queueRef.current[indexRef.current]?.id ?? null }, "*");
    } catch {}

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pharos:restoration", onRestorationChange);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlayingAfterStall);
    };
  }, []);

  // The island renders no visible UI for audio; for VIDEO podcasts the shell
  // expands this iframe (pip/full) and the <video> fills it (owner request:
  // the video IS the preview, expandable to page/full screen).
  return (
    <video
      ref={audioRef}
      playsInline
      controls
      preload="metadata"
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
    />
  );
}
