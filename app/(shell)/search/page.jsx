"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { searchRanked } from "@/lib/archive";
import { minQuality } from "@/lib/pipeline";
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

const PAGE_SIZE = 24;

/**
 * /search — dedicated search page (phase 2, spec §3.1/3.2).
 * Input with autofocus, recent searches (Spotify pattern #6), type chips
 * (YT Music #7), top result card + ranked results grid with "Load more"
 * pagination (#17-19).
 *
 * #13: the search is URL-addressable — q, c and page are read from
 * useSearchParams on mount (read-once, hydration-safe: state starts empty
 * and is filled inside an effect, never during the first render) and written
 * back with router.replace on every submit/pagination, so back, refresh and
 * shared links all reproduce the same results.
 */
function SearchPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("");
  const [chip, setChip] = useState("all");
  const [items, setItems] = useState([]);
  const [rawCount, setRawCount] = useState(0); // hits BEFORE the quality gate
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("idle"); // idle|loading|loadingMore|ready|error
  const [recent, setRecent] = useState([]);
  const [booted, setBooted] = useState(false); // URL params consumed exactly once
  const abortRef = useRef(null);

  // Autofocus on open (spec: Search is the only page with keyboard focus).
  useEffect(() => { inputRef.current?.focus(); setRecent(readRecentSearches()); }, []);

  /** Fetches one page and merges (append + dedup per id) into the grid. */
  const run = async (q, coll, { pageNum = 1, shelfQuery = null, append = false } = {}) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus(append ? "loadingMore" : "loading");
    try {
      const { items: ranked, total: found } = await searchRanked({
        query: q, collection: coll, rawQuery: shelfQuery, page: pageNum, rows: PAGE_SIZE,
      });
      if (ctrl.signal.aborted) return;
      const clean = ranked.filter(minQuality(3));
      setRawCount(ranked.length);
      setTotal(found);
      setItems((prev) => {
        if (!append) return clean;
        const seen = new Set(clean.map((a) => a.id));
        return [...prev, ...clean.filter((a) => !seen.has(a.id))];
      });
      setPage(pageNum);
      setStatus("ready");
    } catch {
      if (!ctrl.signal.aborted) setStatus(append ? "ready" : "error");
    }
  };

  // #13 (read-once, hydration-safe): consume URL params once on mount and
  // replay the search they describe. Before this runs the page renders the
  // idle browse view — identical on server and client (no mismatch).
  useEffect(() => {
    const q = params.get("q") ?? "";
    const c = params.get("c") ?? "";
    const p = Math.max(1, Number(params.get("page")) || 1);
    setBooted(true);
    if (!q) return;
    setQuery(q);
    setCollection(c);
    run(q, c, { pageNum: p });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** URL is the addressable state: replace (no history spam) on each change. */
  const syncUrl = (q, c, p) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (c) sp.set("c", c);
    if (p > 1) sp.set("page", String(p));
    router.replace(`/search${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  };

  const submit = (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    pushRecentSearch(query);
    setRecent(readRecentSearches());
    setChip("all"); // #17: chips reset honestly — a new search is a new list
    syncUrl(query.trim(), collection, 1);
    run(query.trim(), collection, { pageNum: 1 });
  };

  const loadMore = () => {
    const next = page + 1;
    const q = query.trim() || (params.get("q") ?? "");
    syncUrl(q, collection, next);
    run(q, collection, { pageNum: next, append: true });
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
  const hasMore = items.length > 0 && items.length < total && status === "ready";

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

      {/* Idle: recent searches + browse-all genre tiles (pattern #8). The
          tiles carry their own Lucene query (#14), not just the collection —
          "Electronic" finds ambient in netlabels, not just the label word. */}
      {status === "idle" && (
        <>
          <RecentSearches onPick={(q) => { setQuery(q); setTimeout(() => { syncUrl(q, collection, 1); run(q, collection, { pageNum: 1 }); }, 0); }} />
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">Browse all</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {SHELVES.map((s) => (
              <button
                key={s.id}
                onClick={() => { setCollection(s.collection); setChip("all"); syncUrl(query.trim(), s.collection, 1); run(query.trim(), s.collection, { pageNum: 1, shelfQuery: s.query || null }); }}
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
      {(status === "loading" || (status === "idle" && booted && query)) && (
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
        <SurfaceState state="error" title="Search failed." hint="archive.org may be slow or unreachable — this is a network problem, not an empty result." onRetry={() => submit()} />
      )}
      {status === "ready" && visible.length === 0 && (
        /* Three honest empty states (#17-19): WHY is it empty? */
        total === 0 && rawCount === 0 ? (
          <SurfaceState
            state="empty"
            title={`No results for “${query}”.`}
            hint="Try fewer words, or browse the genre shelves."
            emptyAction={{ label: "Browse genres", href: "/" }}
          />
        ) : (
          <SurfaceState
            state="empty"
            title={`No presentable results for “${query}”.`}
            hint={`${rawCount} item${rawCount === 1 ? "" : "s"} matched, but ${rawCount === 1 ? "it was" : "all were"} filtered out by the quality gate (missing metadata or dead files).`}
            emptyAction={{ label: "Browse genres", href: "/" }}
          />
        )
      )}

      {/* Ready: chips + result count + top result + grid */}
      {status === "ready" && visible.length > 0 && (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
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
            {/* #16: the result count is announced politely (screen readers),
                in a live region instead of a jarring reroute. */}
            <span className="ml-auto text-xs text-zinc-600" role="status" aria-live="polite" data-testid="search-total">
              {loadingMoreLabel(status)}{total} results
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {top && chip === "all" && <TopResultCard album={top} />}
            {visible.slice(chip === "all" ? 1 : 0).map((a) => <AlbumCard key={a.id} album={a} />)}
          </div>
          {hasMore && (
            <div className="mt-8 mb-4 text-center">
              <button
                onClick={loadMore}
                disabled={status === "loadingMore"}
                className="rounded-full border border-zinc-700 px-6 py-2.5 text-sm font-semibold text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-50"
              >
                {status === "loadingMore" ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

const loadingMoreLabel = (status) => (status === "loadingMore" ? "loading more… " : "");

/**
 * Static export wrapper: useSearchParams() requires a Suspense boundary
 * during prerender (Next.js requirement for output: "export").
 */
export default function SearchPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-10"><p className="text-sm text-zinc-500">Loading…</p></main>}>
      <SearchPageInner />
    </Suspense>
  );
}
