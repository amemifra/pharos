"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FILM_SHELVES, searchFilms, shelfFilms } from "@/lib/films";
import SurfaceState from "@/components/SurfaceState";
import SkeletonCard from "@/components/SkeletonCard";

/**
 * /films — public-domain film catalogue (archive.org movies).
 *
 * Mirrors the books page over lib/films.js: a query box whose query and page
 * live in the URL (shareable, refresh-stable), one themed shelf per
 * FILM_SHELVES entry and a paged film grid. No playback here — cards link to
 * the film detail view on archive.org-side identifiers. Every list pages
 * explicitly (bounded by FILM_MAX_PAGE via the adapter) and dedupes by
 * identifier. Loading / empty / error states report the real outcome.
 */

/** Human message for a FilmsError (or any thrown value). */
function errorTitle(e) {
  switch (e?.code) {
    case "rate_limited": return "archive.org is rate limiting requests — try again shortly.";
    case "network": return "archive.org could not be reached.";
    default: return "Could not load films from archive.org.";
  }
}

/**
 * Paged list state over one adapter call (search or shelf).
 * @param {(page: number) => Promise<{ items: Array, total: number, page: number, hasMore: boolean }>} fetchPage
 *   Stable per key; null disables the list.
 */
function usePagedFilms(fetchPage) {
  const [state, setState] = useState({ status: "idle", items: [], page: 0, hasMore: false, total: 0, error: null, loadingMore: false });
  const token = useRef(0);

  const load = useCallback(async (page) => {
    if (!fetchPage) return;
    const my = ++token.current;
    setState((s) => (page === 1
      ? { status: "loading", items: [], page: 0, hasMore: false, total: 0, error: null, loadingMore: false }
      : { ...s, loadingMore: true, error: null }));
    try {
      const r = await fetchPage(page);
      if (my !== token.current) return;
      setState((s) => {
        const seen = new Set(page === 1 ? [] : s.items.map((f) => f.id));
        const fresh = r.items.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
        const items = page === 1 ? fresh : [...s.items, ...fresh];
        return { status: items.length ? "ready" : "empty", items, page: r.page, hasMore: r.hasMore, total: r.total, error: null, loadingMore: false };
      });
    } catch (e) {
      if (my !== token.current) return;
      // A failed "load more" keeps the cards already shown and reports the error.
      setState((s) => (page === 1 || !s.items.length
        ? { status: "error", items: [], page: 0, hasMore: false, total: 0, error: e, loadingMore: false }
        : { ...s, loadingMore: false, error: e }));
    }
  }, [fetchPage]);

  useEffect(() => {
    if (fetchPage) load(1);
    else { token.current++; setState({ status: "idle", items: [], page: 0, hasMore: false, total: 0, error: null, loadingMore: false }); }
  }, [fetchPage, load]);

  return { ...state, retry: () => load(1), more: () => load(state.page + 1) };
}

const filmSkeleton = (
  <div className="flex flex-wrap gap-4" aria-hidden="true">
    {Array.from({ length: 8 }, (_, i) => <SkeletonCard key={i} />)}
  </div>
);

/**
 * One paged list of films with its own honest state slot.
 * Page changes replace the query string, so the URL always reflects
 * what is on screen (shareable, refresh-stable).
 */
function FilmList({ list, emptyTitle, emptyHint, onPage }) {
  const stateName = list.status === "idle" ? "loading" : list.status;
  return (
    <>
      <div data-testid="films-state" data-state={stateName}>
        {list.status === "ready" ? (
          <ul className="flex flex-wrap gap-3" data-testid="film-grid">
            {list.items.map((f) => <FilmCard key={f.id} film={f} />)}
          </ul>
        ) : list.status === "error" ? (
          <SurfaceState state="error" title={errorTitle(list.error)} hint={list.error?.message} onRetry={list.retry} />
        ) : list.status === "empty" ? (
          <SurfaceState state="empty" title={emptyTitle} hint={emptyHint} />
        ) : (
          <SurfaceState state="loading" skeleton={filmSkeleton} />
        )}
      </div>
      {list.status === "ready" && list.error && (
        <p role="alert" className="mt-3 text-xs text-red-400">{errorTitle(list.error)} The films above are still shown.</p>
      )}
      {list.status === "ready" && (list.page > 1 || list.hasMore) && (
        <div className="mt-5 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => onPage(list.page - 1)}
            disabled={list.page <= 1 || list.loadingMore}
            className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-emerald-600 hover:text-emerald-400 disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="text-xs text-zinc-500">Page {list.page}{list.total ? ` of up to ${Math.min(40, Math.ceil(list.total / 24))}` : ""}</span>
          <button
            type="button"
            onClick={() => onPage(list.page + 1)}
            disabled={!list.hasMore || list.loadingMore}
            className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-emerald-600 hover:text-emerald-400 disabled:opacity-40"
          >
            {list.loadingMore ? "Loading…" : "Next →"}
          </button>
        </div>
      )}
    </>
  );
}

function Shelf({ shelf }) {
  const fetchPage = useCallback((page) => shelfFilms(shelf.id, { page }), [shelf.id]);
  const list = usePagedFilms(fetchPage);
  return (
    <section data-testid={`film-shelf-${shelf.id}`} aria-labelledby={`film-shelf-h-${shelf.id}`} className="mb-10">
      <h2 id={`film-shelf-h-${shelf.id}`} className="mb-3 text-lg font-semibold tracking-tight">{shelf.label}</h2>
      <FilmList list={list} emptyTitle="No films on this shelf right now." />
    </section>
  );
}

/** One film card — poster, title, director, year. Links to the detail view. */
function FilmCard({ film }) {
  return (
    <li className="w-[9.5rem]">
      <Link
        href={`/films/detail/?id=${encodeURIComponent(film.id)}`}
        data-testid="film-card"
        className="group block"
      >
        <span className="block aspect-[2/3] w-full overflow-hidden rounded-lg bg-zinc-800/70">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={film.posterUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
            onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
          />
        </span>
        <span className="mt-2 block line-clamp-2 text-sm font-medium text-zinc-100 group-hover:text-white">
          {film.title ?? "Untitled (unknown title)"}
        </span>
        <span className="mt-0.5 block truncate text-xs text-zinc-400">
          {film.director ?? "Unknown director"}
        </span>
        <span className="block text-xs text-zinc-500">{film.year ?? "Year unknown"}</span>
      </Link>
    </li>
  );
}

function FilmsPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const urlPage = Math.max(1, Math.floor(Number(params.get("page")) || 1));

  const [draft, setDraft] = useState(urlQuery);
  // Keep the box in sync with the address bar (back/forward, shared links).
  useEffect(() => setDraft(urlQuery), [urlQuery]);

  const fetchSearch = useCallback(
    (page) => searchFilms(urlQuery, { page: urlPage === 1 ? page : page === 1 ? urlPage : urlPage + page - 1 }),
    [urlQuery, urlPage],
  );

  /**
   * Search: the URL carries the query (q) and the page (page). One page of
   * results is shown at a time; Next/Previous rewrite the address so the
   * exact result view is reachable again by refresh or share.
   */
  const results = usePagedFilms(urlQuery ? fetchSearch : null);

  const submit = (e) => {
    e.preventDefault();
    const q = draft.trim();
    router.push(q ? `/films/?q=${encodeURIComponent(q)}` : "/films/");
  };
  const gotoPage = (page) => {
    const p = Math.max(1, page);
    router.push(urlQuery
      ? `/films/?q=${encodeURIComponent(urlQuery)}${p > 1 ? `&page=${p}` : ""}`
      : "/films/");
  };

  return (
    <main className="mx-auto max-w-6xl px-4 md:px-8 pt-6 md:pt-10" data-testid="films-page">
      <h1 className="mb-2 text-2xl font-bold tracking-tight md:text-3xl">Films</h1>
      <p className="mb-6 text-sm text-zinc-500">Public-domain films from archive.org&apos;s curated movie collections.</p>
      <p role="note" className="-mt-4 mb-6 text-xs text-zinc-600" data-testid="films-source-note">
        Watching happens on archive.org: Pharos keeps no copy of any film.
      </p>

      <form role="search" onSubmit={submit} className="mb-8 flex gap-2">
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search films"
          aria-label="Search films"
          className="min-w-0 flex-1 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-600 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-black transition-colors hover:bg-emerald-400"
        >
          Search
        </button>
      </form>

      {urlQuery && (
        <section data-testid="film-results" aria-labelledby="film-results-h" className="mb-12">
          <h2 id="film-results-h" className="mb-3 text-lg font-semibold tracking-tight">
            Results for “{urlQuery}”
            {results.status === "ready" && <span className="ml-2 text-xs font-normal text-zinc-500">{results.total.toLocaleString()} matches on archive.org</span>}
          </h2>
          <FilmList
            list={results}
            emptyTitle={`No films found for “${urlQuery}”.`}
            emptyHint="Only public-domain films in the curated collections are listed."
            onPage={gotoPage}
          />
        </section>
      )}

      {FILM_SHELVES.map((s) => <Shelf key={s.id} shelf={s} />)}
    </main>
  );
}

/**
 * Static export wrapper: useSearchParams() requires a Suspense boundary
 * during prerender (Next.js requirement for output: "export").
 */
export default function FilmsPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-10"><p className="text-sm text-zinc-500">Loading…</p></main>}>
      <FilmsPageInner />
    </Suspense>
  );
}
