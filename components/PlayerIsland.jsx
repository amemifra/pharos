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
export default function PlayerIsland({ onMessage, islandRef }) {
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

  return (
    <iframe
      ref={islandRef}
      src={assetPath("/player/")}
      title="Pharos player island"
      sandbox="allow-scripts allow-same-origin"
      className="hidden h-0 w-0 border-0"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
