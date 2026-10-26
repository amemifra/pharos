"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BOOK_SHELVES, searchBooks, shelfBooks } from "@/lib/books";
import BookCard from "@/components/BookCard";
import SurfaceState from "@/components/SurfaceState";

/**
 * /books — public-domain book catalogue (archive.org texts).
 *
 * Statically exported like every other shell route: no server, all data is
 * fetched client-side at runtime through lib/books.js. Lives inside the shell
 * layout, so the player island and PlayerProvider are untouched — audio keeps
 * playing while the user browses books.
 *
 * Surfaces: a client-side search and one shelf per BOOK_SHELVES entry. Every
 * list pages explicitly ("Load more", bounded by the adapter's page ceiling)
 * and dedupes by identifier, so repeated loads never duplicate a card.
 * Loading / empty / error states report the real outcome of the request.
 */

/** Human message for a BooksError (or any thrown value). */
function errorTitle(e) {
  switch (e?.code) {
    case "rate_limited": return "archive.org is rate limiting requests — try again shortly.";
    case "network": return "archive.org could not be reached.";
    default: return "Could not load books from archive.org.";
  }
}

/**
 * Paged list state over one adapter call (search or shelf).
 * @param {(page: number) => Promise<import("@/lib/books").BookPage>} fetchPage
 *   Stable per key; null disables the list.
 */
function usePagedBooks(fetchPage) {
  const [state, setState] = useState({ status: "idle", items: [], page: 0, hasMore: false, total: 0, error: null, loadingMore: false });
  const token = useRef(0);

  const load = useCallback(async (page) => {
    if (!fetchPage) return;
    const my = ++token.current;
    setState((s) => (page === 1 ? { status: "loading", items: [], page: 0, hasMore: false, total: 0, error: null, loadingMore: false } : { ...s, loadingMore: true, error: null }));
    try {
      const r = await fetchPage(page);
      if (my !== token.current) return;
      setState((s) => {
        const seen = new Set(page === 1 ? [] : s.items.map((b) => b.id));
        const fresh = r.items.filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
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

const skeleton = (
  <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
    {Array.from({ length: 6 }, (_, i) => (
      <div key={i} className="flex gap-3 p-2">
        <div className="h-24 w-16 rounded bg-zinc-800/70 animate-pulse" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3 w-3/4 rounded bg-zinc-800/70 animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-zinc-800/50 animate-pulse" />
        </div>
      </div>
    ))}
  </div>
);

/** One paged list of books with its own honest state slot. */
function BookList({ list, emptyTitle, emptyHint }) {
  const stateName = list.status === "idle" ? "loading" : list.status;
  return (
    <>
      <div data-testid="books-state" data-state={stateName}>
        {list.status === "ready" ? (
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {list.items.map((b) => (
              <li key={b.id}><BookCard book={b} /></li>
            ))}
          </ul>
        ) : list.status === "error" ? (
          <SurfaceState state="error" title={errorTitle(list.error)} hint={list.error?.message} onRetry={list.retry} />
        ) : list.status === "empty" ? (
          <SurfaceState state="empty" title={emptyTitle} hint={emptyHint} />
        ) : (
          <SurfaceState state="loading" skeleton={skeleton} />
        )}
      </div>
      {list.status === "ready" && list.error && (
        <p role="alert" className="mt-3 text-xs text-red-400">{errorTitle(list.error)} The books above are still shown.</p>
      )}
      {list.status === "ready" && list.hasMore && (
        <button
          type="button"
          onClick={list.more}
          disabled={list.loadingMore}
          className="mt-4 rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-emerald-600 hover:text-emerald-400 disabled:opacity-50"
        >
          {list.loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </>
  );
}

function Shelf({ shelf }) {
  const fetchPage = useCallback((page) => shelfBooks(shelf.id, { page }), [shelf.id]);
  const list = usePagedBooks(fetchPage);
  return (
    <section data-testid={`book-shelf-${shelf.id}`} aria-labelledby={`shelf-h-${shelf.id}`} className="mb-10">
      <h2 id={`shelf-h-${shelf.id}`} className="mb-3 text-lg font-semibold tracking-tight">{shelf.label}</h2>
      <BookList list={list} emptyTitle="No books on this shelf right now." />
    </section>
  );
}

export default function BooksPage() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const fetchSearch = useCallback((page) => searchBooks(query, { page }), [query]);
  const results = usePagedBooks(query ? fetchSearch : null);

  return (
    <main className="mx-auto max-w-6xl px-4 md:px-8 pt-6 md:pt-10" data-testid="books-page">
      <h1 className="mb-2 text-2xl font-bold tracking-tight md:text-3xl">Books</h1>
      <p className="mb-6 text-sm text-zinc-500">Public-domain and openly licensed books from archive.org.</p>
      <p role="note" className="-mt-4 mb-6 text-xs text-zinc-600" data-testid="books-source-note">
        Reading opens on archive.org: Pharos keeps no copy of any book.
      </p>

      <form
        role="search"
        onSubmit={(e) => { e.preventDefault(); setQuery(draft.trim()); }}
        className="mb-8 flex gap-2"
      >
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search books"
          aria-label="Search books"
          className="min-w-0 flex-1 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-600 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-black transition-colors hover:bg-emerald-400"
        >
          Search
        </button>
      </form>

      {query && (
        <section data-testid="book-results" aria-labelledby="book-results-h" className="mb-12">
          <h2 id="book-results-h" className="mb-3 text-lg font-semibold tracking-tight">
            Results for “{query}”
            {results.status === "ready" && <span className="ml-2 text-xs font-normal text-zinc-500">{results.total.toLocaleString()} matches on archive.org</span>}
          </h2>
          <BookList list={results} emptyTitle={`No books found for “${query}”.`} emptyHint="Only public-domain and openly licensed books are listed." />
        </section>
      )}

      {BOOK_SHELVES.map((s) => <Shelf key={s.id} shelf={s} />)}
    </main>
  );
}
