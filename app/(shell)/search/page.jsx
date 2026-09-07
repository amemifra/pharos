"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { searchRanked } from "@/lib/archive";
import { normalizeSearchItem, minQuality } from "@/lib/pipeline";
import { SHELVES } from "@/lib/catalog";
import { pushRecentSearch, readRecentSearches } from "@/components/RecentSearches";
import AlbumCard from "@/components/AlbumCard";
import TopResultCard from "@/components/TopResultCard";
import RecentSearches from "@/components/RecentSearches";
import SurfaceState from "@/components/SurfaceState";
import SkeletonCard from "@/components/SkeletonCard";
import Icon from "@/components/Icon";

/** Result type chips (YT Music pattern #7): cheap client-side filter. */
const CHIPS = [
  { id: "all", label: "All" },
  { id: "album", label: "Albums" },
  { id: "artist", label: "Artists" },
];

/**
 * /search — dedicated search page (phase 2, spec §3.1/3.2).
 * Input with autofocus, recent searches (Spotify pattern #6), type chips
 * (YT Music #7), top result card (YT Music #7) + ranked results grid.
 * Empty state links back to the genre shelves (AP/YT browse pattern #8).
 */
export default function SearchPage() {
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("");
  const [chip, setChip] = useState("all");
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("idle"); // idle|loading|ready|error
  const [recent, setRecent] = useState([]);
  const abortRef = useRef(null);

  // Autofocus on open (spec: Search is the only page with keyboard focus).
  useEffect(() => { inputRef.current?.focus(); setRecent(readRecentSearches()); }, []);

  const run = async (q, coll) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus("loading");
    try {
      const { items: ranked } = await searchRanked({ query: q, collection: coll, rows: 24 });
      if (ctrl.signal.aborted) return;
      setItems(ranked.filter(minQuality(3)));
      setStatus("ready");
    } catch {
      if (!ctrl.signal.aborted) setStatus("error");
    }
  };

  const submit = (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    pushRecentSearch(query);
    setRecent(readRecentSearches());
    run(query, collection);
  };

  // Chips: "Artists" filters to items whose creator matches the query tokens.
  const visible = useMemo(() => {
    if (chip === "all") return items;
    if (chip === "artist") {
      const q = query.toLowerCase();
      return items.filter((a) => a.artist.toLowerCase().includes(q));
    }
    return items; // "album" = same list (our entities ARE albums)
  }, [items, chip, query]);

  const top = visible[0];

  return (
    <main className="mx-auto max-w-6xl px-4 md:px-8 pt-6 md:pt-10">
      <form onSubmit={submit} className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Artist, album, concert…"
            autoFocus
            className="w-full rounded-full bg-zinc-900 border border-zinc-800 py-2.5 pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-600/60 focus:bg-zinc-900/80"
          />
        </div>
        <select
          value={collection}
          onChange={(e) => setCollection(e.target.value)}
          className="rounded-full bg-zinc-900 border border-zinc-800 px-4 py-2.5 text-sm text-zinc-300"
        >
          <option value="">All collections</option>
          {SHELVES.map((s) => (
            <option key={s.id} value={s.collection}>{s.label}</option>
          ))}
        </select>
        <button type="submit" className="rounded-full bg-emerald-500 px-6 py-2.5 text-sm font-bold text-black transition-colors hover:bg-emerald-400">
          Search
        </button>
      </form>

      {/* Idle: recent searches + browse-all genre tiles (pattern #8) */}
      {status === "idle" && (
        <>
          <RecentSearches onPick={(q) => { setQuery(q); setTimeout(() => run(q, collection), 0); }} />
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">Browse all</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {SHELVES.map((s) => (
              <button
                key={s.id}
                onClick={() => { setCollection(s.collection); if (query.trim()) run(query, s.collection); }}
                className={`rounded-xl px-4 py-5 text-left text-sm font-bold transition-transform hover:scale-[1.02] ${
                  ["bg-emerald-900/70", "bg-indigo-900/70", "bg-rose-900/70", "bg-amber-900/70", "bg-sky-900/70", "bg-violet-900/70", "bg-teal-900/70", "bg-lime-900/70"][SHELVES.indexOf(s) % 8]
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Loading / error / empty unified slots */}
      {status === "loading" && (
        <SurfaceState
          state="loading"
          skeleton={
            <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
              {Array.from({ length: 10 }, (_, i) => <SkeletonCard key={i} />)}
            </div>
          }
        />
      )}
      {status === "error" && (
        <SurfaceState state="error" title="Search failed." hint="archive.org may be slow or unreachable." onRetry={() => submit()} />
      )}
      {status === "ready" && visible.length === 0 && (
        <SurfaceState
          state="empty"
          title={`No results for “${query}”.`}
          hint="Try fewer words, or browse the genre shelves."
          emptyAction={{ label: "Browse genres", href: "/" }}
        />
      )}

      {/* Ready: chips + top result + grid */}
      {status === "ready" && visible.length > 0 && (
        <>
          <div className="mb-5 flex gap-2">
            {CHIPS.map((c) => (
              <button
                key={c.id}
                onClick={() => setChip(c.id)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  chip === c.id ? "bg-white text-black" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {top && chip === "all" && <TopResultCard album={top} />}
            {visible.slice(chip === "all" ? 1 : 0).map((a) => <AlbumCard key={a.id} album={a} />)}
          </div>
        </>
      )}
    </main>
  );
}
