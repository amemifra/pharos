"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SHELVES } from "@/lib/catalog";
import { startWarmup } from "@/lib/catalogwarm";
import Icon from "@/components/Icon";

const NAV = [
  { href: "/", icon: "home", label: "Home" },
  { href: "/search", icon: "search", label: "Search" },
  { href: "/library", icon: "library", label: "Library" },
];

/**
 * Navigation shell — 3 tabs per the spec (YT Music pattern #1):
 * mobile: fixed bottom tabs (Home / Search / Library); desktop: sidebar.
 * The player lives in the root (island iframe + NowPlayingBar) and keeps
 * playing across page transitions — all internal navigation must use
 * next/link, never <a href>, or a full reload would re-mount the shell.
 */
export default function AppShell({ children }) {
  const pathname = usePathname();
  // P2P catalog warm-up: quiet background population of cross-references for
  // top artists; the badge shows the community catalog growing live.
  const [warm, setWarm] = useState({ artist: null, done: 0, total: 0 });
  useEffect(() => {
    let cancelled = false;
    const kick = () => {
      if (cancelled) return;
      startWarmup({
        batch: 4,
        gapMs: 30_000,
        onProgress: (info) => { if (!cancelled) setWarm(info); },
      });
    };
    // Idle start: never compete with first paint on low-end devices.
    const t = setTimeout(kick, 15_000);
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  // Shared ranker consensus: adopt stronger community evidence on boot,
  // publish our own aggregate after each local training cycle.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fb = await import("@/lib/feedback");
        fb.trainFromFeedback();
        if (!cancelled) await fb.adoptRankerConsensus();
        if (!cancelled) await fb.publishRankerConsensus();
        // F3: share the per-version aggregates (same P2P consensus layer).
        if (!cancelled) await fb.publishVersionConsensus();
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  /** Active = exact match (tabs are distinct routes, no anchors). */
  const isActive = (href) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-60 flex-col bg-zinc-950 border-r border-zinc-800/60 px-4 py-6 z-30">
        <Link href="/" className="flex items-center gap-2.5 px-2 mb-8">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600/15 text-emerald-400">
            <Icon name="note" className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">
            Phar<span className="text-emerald-500">os</span>
          </span>
        </Link>

        <nav className="space-y-1">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? "bg-zinc-800/70 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-900"
                }`}
              >
                <Icon name={item.icon} className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-8">
          <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-600">Genres</p>
          <nav className="space-y-0.5">
            {SHELVES.slice(0, 6).map((s) => (
              <a
                key={s.id}
                href={`/#shelf-${s.id}`}
                className="block rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:text-emerald-400 transition-colors"
              >
                {s.label}
              </a>
            ))}
          </nav>
        </div>

        <p className="mt-auto px-3 text-[11px] leading-relaxed text-zinc-700">
          A lighthouse for public culture · archive.org + open sources · zero servers
          {warm.done > 0 && (
            <span className="mt-2 flex items-center gap-1.5 text-[10px] text-emerald-500/80">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
              P2P catalog: {warm.done} artists mapped, growing
              {warm.artist ? ` · ${warm.artist}` : ""}
            </span>
          )}
        </p>
      </aside>

      {/* Content */}
      <div className="md:pl-60 pb-40 md:pb-28">{children}</div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 flex border-t border-zinc-800/80 bg-zinc-950/95 backdrop-blur">
        {NAV.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
              isActive(item.href) ? "text-white" : "text-zinc-400 hover:text-white"
            }`}
          >
            <Icon name={item.icon} className="h-5 w-5" />
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
