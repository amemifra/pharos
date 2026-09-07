"use client";

const KEY = "pf.recentsearches";
const MAX = 10;

/** Reads the recent-search list (newest first). @returns {string[]} */
export function readRecentSearches() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}

/**
 * Records a search query (dedup, newest first, cap 10).
 * @param {string} query
 */
export function pushRecentSearch(query) {
  const q = String(query ?? "").trim();
  if (!q) return;
  const next = [q, ...readRecentSearches().filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
}

/**
 * Recent searches list (Spotify pattern #6: persistent, local-only, free).
 * @param {{onPick: (query: string) => void}} props
 */
export default function RecentSearches({ onPick }) {
  const items = typeof window !== "undefined" ? readRecentSearches() : [];
  if (!items.length) return null;

  return (
    <div className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-600">Recent searches</h2>
      <div className="flex flex-wrap gap-2">
        {items.map((q) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            className="rounded-full border border-zinc-800 bg-zinc-900 px-3.5 py-1.5 text-sm text-zinc-300 transition-colors hover:border-emerald-600/60 hover:text-white"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
