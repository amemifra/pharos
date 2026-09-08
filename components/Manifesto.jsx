"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Manifesto popover (P0-DESIGN, owner request): a small ⓘ button that opens
 * a short English manifesto + the honest list of sources, on hover/focus/
 * tap. Reusable: the footer (AppShell), NowPlayingBar and NowPlayingOverlay
 * mount the same component so the promise is stated wherever people listen.
 *
 * Accessibility: button-based (keyboard parity), opens on focus and closes
 * on blur/Escape; the popover text is plain, factual, no hype.
 */
export default function Manifesto({ align = "right", drop = "up" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside pointerdown + Escape (keyboard parity, WCAG).
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-block" data-testid="manifesto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-expanded={open}
        aria-label="About Pharos"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-600 text-[11px] font-bold text-zinc-400 transition-colors hover:border-brass-400 hover:text-brass-400"
        data-testid="manifesto-toggle"
      >
        i
      </button>
      {open && (
        <div
          role="note"
          className={`absolute z-[90] w-72 rounded-xl border border-zinc-700 bg-ink-900 p-4 text-left shadow-2xl shadow-black/60 ${
            drop === "up" ? "bottom-full mb-2" : "top-full mt-2"
          } ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <p className="text-sm font-semibold text-ivory-100">Pharos</p>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">
            A lighthouse for public culture. Pharos streams only what the law
            already lets you hear: library-lent and public-domain recordings
            from archive.org, live concert tapes shared by trade-friendly
            artists (etree), Creative-Commons netlabel releases, and podcast
            RSS feeds published by their own creators. No accounts, no servers
            of ours, no tracking — everything runs and lives in your browser.
          </p>
          <p className="mt-2 text-[11px] text-zinc-500">
            Sources:{" "}
            <a href="https://archive.org/details/audio" target="_blank" rel="noreferrer" className="text-brass-400 hover:underline">archive.org</a>,{" "}
            <a href="https://etree.org" className="text-brass-400 hover:underline">etree</a>,{" "}
            <a href="https://netlabels.net" className="text-brass-400 hover:underline">netlabels</a>,{" "}
            <a href="https://archive.org/details/georgeblood" className="text-brass-400 hover:underline">georgeblood 78s</a>
          </p>
        </div>
      )}
    </span>
  );
}