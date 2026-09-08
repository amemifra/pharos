"use client";

import { useEffect, useRef, useState } from "react";
import PharosMark from "@/components/PharosMark";

/**
 * Splash intro (P0-DESIGN, owner request): a staged, honest entrance —
 *   Mark with soft glow → "Pharos" → the manifesto subtitle.
 *
 * Discipline:
 *   - shows ONCE per browser session (`pf.splash.seen` in sessionStorage —
 *     a NEW pf.* key; existing pf.* keys are never renamed/repurposed);
 *   - skips entirely under prefers-reduced-motion (owner: OFF on reduced
 *     motion — motion must never be forced);
 *   - a tap/click/keydown dismisses immediately (never a gate);
 *   - fade-out ~1.6s back into the Home.
 */
export default function Splash() {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const goneRef = useRef(false);

  const dismiss = () => {
    if (goneRef.current) return;
    goneRef.current = true;
    setLeaving(true);
    setTimeout(() => {
      setVisible(false);
      try { sessionStorage.setItem("pf.splash.seen", "1"); } catch {}
    }, 350);
  };

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduced) return; // owner: OFF on reduced motion
    try {
      if (sessionStorage.getItem("pf.splash.seen")) return;
    } catch {}
    setVisible(true);
    const leaveTimer = setTimeout(() => setLeaving(true), 2600);
    const goneTimer = setTimeout(() => dismiss(), 4400);
    const onKey = () => dismiss();
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(leaveTimer); clearTimeout(goneTimer); window.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-label="Pharos"
      onClick={dismiss}
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-ink-950 transition-opacity duration-[1600ms] ease-out ${
        leaving ? "opacity-0 pointer-events-none" : "opacity-100"
      } motion-reduce:hidden`}
      data-testid="splash"
    >
      <span className="splash-mark flex h-20 w-20 items-center justify-center rounded-3xl bg-brass-400/10">
        <PharosMark className="h-14 w-14" />
      </span>
      <p className="splash-title text-3xl font-extrabold tracking-tight text-ivory-100">Pharos</p>
      <p className="splash-sub text-sm text-ivory-400">Public art, plainly beautiful. Open. Legal. Yours.</p>
    </div>
  );
}