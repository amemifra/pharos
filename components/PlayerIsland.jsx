"use client";

import { useEffect, useRef, useState } from "react";
import { assetPath } from "@/lib/basepath";

/**
 * PlayerIsland — iframe host for the player island (/player route).
 *
 * Phase 1 of docs/ux-architecture.md: the <audio> element lives in an iframe
 * document that never unmounts on shell navigation or React tree resets.
 * Sandbox: allow-scripts (island speaks postMessage) + allow-same-origin
 * (queue persistence via localStorage; the island renders no untrusted
 * content — explicit spec allowance for the player island only).
 *
 * Fallback: if the island never signals pf.ready (old browser, sandbox
 * stripped, file:// preview), the shell falls back to an inline <audio>
 * owned by PlayerProvider — see PlayerProvider (inline mode).
 *
 * @param {{onMessage: (msg: Object) => void, islandRef: React.MutableRefObject<HTMLIFrameElement|null>}} props
 *   onMessage: called for every validated pf.* message from the island.
 *   islandRef: ref to the iframe element (the shell posts into contentWindow).
 */
export default function PlayerIsland({ onMessage, islandRef, videoView = "hidden", onCollapse }) {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    /** shell ← island message pump (validated with the pf.* discriminator). */
    const onWindowMessage = (e) => {
      const msg = e.data;
      if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("pf.")) return;
      handlerRef.current(msg);
    };
    window.addEventListener("message", onWindowMessage);
    return () => window.removeEventListener("message", onWindowMessage);
  }, []);

  // View states for VIDEO podcasts (owner): hidden = 0×0 as before; pip =
  // floating mini video; full = full-page (plus native fullscreen via the
  // iframe allow attribute). Audio-only tracks never leave "hidden".
  // Esc always collapses the video view (owner: "non posso uscire").
  useEffect(() => {
    if (videoView === "hidden") return;
    const onKey = (e) => { if (e.key === "Escape") onCollapse?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [videoView, onCollapse]);

  // Native document fullscreen (owner: "full screen non solo nell'iframe,
  // tutto il documento"): entering "full" asks the browser for real
  // fullscreen of the iframe element (click = user activation, so the
  // request is allowed); leaving it exits. CSS full-page stays as the
  // fallback when the browser refuses (sandboxed embeds, iOS Safari).
  useEffect(() => {
    const el = islandRef?.current;
    if (videoView === "full" && el?.requestFullscreen) {
      el.requestFullscreen?.().catch(() => { /* CSS full-page remains */ });
    } else if (document.fullscreenElement === el) {
      document.exitFullscreen?.().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoView]);

  // Browser-native exit (Esc in fullscreen, F11 toggle) collapses the view
  // too: the document leaving fullscreen means the owner asked to leave.
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) onCollapse?.();
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [onCollapse]);

  const frameClass =
    videoView === "pip"
      ? "fixed bottom-20 right-4 z-50 h-44 w-80 overflow-hidden rounded-lg border border-zinc-700 bg-black shadow-2xl md:bottom-20"
      : videoView === "full"
        ? "fixed inset-0 z-50 h-full w-full border-0 bg-black"
        : "hidden h-0 w-0 border-0";

  return (
    <>
      <iframe
        ref={islandRef}
        src={assetPath("/player/")}
        title="Pharos player island"
        sandbox="allow-scripts allow-same-origin"
        allow="fullscreen"
        className={frameClass}
        aria-hidden={videoView === "hidden"}
        tabIndex={videoView === "hidden" ? -1 : 0}
      />
      {/* pip keeps the shell-side ✕ (the island's own ✕ would sit inside a
          0-size-feeling mini window); the FULL view's ✕/Esc live inside the
          island UI itself (app/player/page.jsx posts pf.exit). */}
      {videoView === "pip" && (
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Close mini player"
          className="fixed bottom-[15.3rem] right-4 z-[60] flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900/80 text-zinc-300 hover:bg-zinc-800"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
            <path d="m5 5 14 14M19 5 5 19" />
          </svg>
        </button>
      )}
    </>
  );
}
