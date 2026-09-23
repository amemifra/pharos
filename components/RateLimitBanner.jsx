"use client";

import { useEffect, useState } from "react";
import { onMbGateState } from "@/lib/mbgate";

/**
 * Truthful MusicBrainz rate-limit banner. Renders ONLY what the provider
 * actually told us: it appears when the MusicBrainz gate received a 429/503
 * (with the server's Retry-After when sent) and disappears on the next
 * successful response. There is deliberately no "all clear" state — the
 * banner is silent when there is nothing true to report (honest-UI rule).
 *
 * Sibling of the P2P status dot: passive, text-light, never blocking.
 */
export default function RateLimitBanner() {
  const [lim, setLim] = useState({ rateLimited: false, retryAt: null, reason: null });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const unsub = onMbGateState((s) => setLim(s));
    return () => { try { unsub?.(); } catch {} };
  }, []);

  // Tick once a second ONLY while limited, so the countdown stays honest.
  useEffect(() => {
    if (!lim.rateLimited) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lim.rateLimited]);

  if (!lim.rateLimited || !lim.retryAt) return null;

  const secs = Math.max(0, Math.ceil((lim.retryAt - now) / 1000));
  const wait = secs >= 60 ? `${Math.ceil(secs / 60)} min` : `${secs}s`;

  return (
    <div
      role="status"
      data-testid="mb-rate-limit-banner"
      data-mb-reason={lim.reason || ""}
      className="mb-rate-limit-banner"
      style={{
        // Review finding (r1): the Splash overlay is `fixed inset-0 z-[100]`
        // and previously covered this in-flow banner exactly while catalog
        // pages load (the moment the banner exists to report). A relative
        // stacking context above the splash keeps the truthful state visible
        // during the splash, without changing the splash itself.
        position: "relative",
        zIndex: 110,
        margin: "8px 12px",
        padding: "6px 10px",
        borderRadius: 8,
        fontSize: 12,
        color: "var(--fg-dim, #999)",
        background: "var(--bg-raised, rgba(127,127,127,0.12))",
      }}
    >
      MusicBrainz is rate limiting this session — next catalog request in ~{wait}.
      Some catalog details may arrive late; nothing is lost, just delayed.
    </div>
  );
}
