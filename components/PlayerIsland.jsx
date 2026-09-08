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
export default function PlayerIsland({ onMessage, islandRef, videoView = "hidden" }) {
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
  const frameClass =
    videoView === "pip"
      ? "fixed bottom-20 right-4 z-50 h-44 w-80 overflow-hidden rounded-lg border border-zinc-700 bg-black shadow-2xl md:bottom-20"
      : videoView === "full"
        ? "fixed inset-0 z-50 h-full w-full border-0 bg-black"
        : "hidden h-0 w-0 border-0";

  return (
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
  );
}
