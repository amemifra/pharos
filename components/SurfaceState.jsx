"use client";

import Icon from "@/components/Icon";

/**
 * SurfaceState — unified loading / empty / error slot (spec §3.2).
 *
 * All three variants occupy the same min-height slot → no layout shift when a
 * surface transitions between states. Loading uses skeletons in the final
 * layout (never spinners for content, per spec); error offers an inline retry.
 *
 * @param {{
 *   state: "loading"|"empty"|"error",
 *   title?: string,
 *   hint?: string,
 *   emptyAction?: { label: string, href: string },
 *   onRetry?: () => void,
 *   skeleton?: React.ReactNode,
 * }} props
 */
export default function SurfaceState({ state, title, hint, emptyAction, onRetry, skeleton }) {
  const base = "min-h-48 flex flex-col items-center justify-center text-center py-10";

  if (state === "loading") {
    return <div className={base}>{skeleton ?? <p className="text-sm text-zinc-500">Loading…</p>}</div>;
  }

  if (state === "error") {
    return (
      <div className={base}>
        <p className="text-sm text-red-400">{title ?? "Something went wrong."}</p>
        {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-emerald-600 hover:text-emerald-400 transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  // state === "empty"
  return (
    <div className={base}>
      <Icon name="note" className="h-8 w-8 text-zinc-700" />
      <p className="mt-3 text-sm text-zinc-400">{title ?? "Nothing here yet."}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
      {emptyAction && (
        <a
          href={emptyAction.href}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-black hover:bg-emerald-400 transition-colors"
        >
          {emptyAction.label}
        </a>
      )}
    </div>
  );
}
