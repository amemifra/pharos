"use client";

import { useEffect, useState } from "react";
import { assetPath } from "@/lib/basepath";

/**
 * P2P status dot — three honest states, gold when lit:
 *   0 · off        — the P2P node is not running (nothing is shared)
 *   1 · network    — connected to the P2P network (Helia node started)
 *   2 · peers      — at least one other peer reached
 *   3 · shared DB  — the shared database replicas / serves real peer data
 *
 * The state comes from the REAL collab layer (lib/collab.js collabState),
 * never from a fake default: an unlit/idle dot means P2P is genuinely off.
 * The node starts lazily (catalog use), so the dot also acts as a signal for
 * when sharing is actually live. Pure level mapping is exported for tests.
 */

/**
 * Maps a collab snapshot onto the indicator level (mirrors collab.js
 * p2pStatusLevel — kept local so the component never imports the bundle).
 * @param {{started?: boolean, ready?: boolean, peers?: number, shared?: boolean, error?: string|null}} s
 * @returns {0|1|2|3}
 */
export function p2pLevel(s) {
  if (!s || !s.started || (!s.ready && s.error)) return 0;
  if (s.shared) return 3;
  if ((s.peers ?? 0) > 0) return 2;
  return 1;
}

const LABELS = {
  0: "P2P off — nothing is shared",
  1: "P2P network connected",
  2: "P2P peer reached",
  3: "P2P shared database live",
};

/**
 * @param {{className?: string}} [props]
 */
export default function P2PStatus({ className = "" }) {
  const [level, setLevel] = useState(0);
  const [peers, setPeers] = useState(0);

  useEffect(() => {
    let alive = true;
    let unsub = null;
    const read = (s) => {
      if (!alive || !s) return;
      setLevel(p2pLevel(s));
      setPeers(s.peers ?? 0);
    };
    // Load the collab bundle from the public root (basePath-correct): the same
    // precompiled artifact the catalog layer uses. Importing it must NOT start
    // the node — collabState() is a pure read.
    (async () => {
      try {
        const collab = await import(/* webpackIgnore: true */ assetPath("/collab.js"));
        if (!alive) return;
        read(collab.collabState?.());
        if (typeof collab.onCollabChange === "function") unsub = collab.onCollabChange(read);
      } catch { /* bundle unavailable: honest off state */ }
    })();
    // Backstop poll: peer counts can change without a dedicated event.
    const id = setInterval(async () => {
      if (!alive) return;
      try {
        const collab = await import(/* webpackIgnore: true */ assetPath("/collab.js"));
        read(collab.collabState?.());
      } catch { /* ignore */ }
    }, 5000);
    return () => { alive = false; clearInterval(id); if (unsub) unsub(); };
  }, []);

  // Quiet, text-free indicator: three small dots, lit in order as the P2P
  // state machine advances (network → peers → shared DB). The tooltip/aria
  // carry the honest wording; the surface stays unobtrusive.
  const title = `${LABELS[level]}${level >= 2 ? ` · ${peers} peer${peers === 1 ? "" : "s"}` : ""}`;
  return (
    <span
      className={`inline-flex items-center gap-1 ${className}`}
      role="status"
      aria-label={title}
      title={title}
      data-p2p-level={level}
    >
      {[1, 2, 3].map((step) => (
        <span
          key={step}
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full transition-colors ${
            level >= step
              ? step === 3
                ? "bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.5)]"
                : "bg-amber-400"
              : "bg-zinc-700"
          }`}
        />
      ))}
    </span>
  );
}