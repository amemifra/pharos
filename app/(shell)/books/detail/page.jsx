"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { fetchBook } from "@/lib/books";
import { fetchBookText, BookReaderError } from "@/lib/bookreader";
import SurfaceState from "@/components/SurfaceState";

/**
 * /books/detail/?id=<archive id> — one book's real metadata and its
 * downloadable reading formats (archive.org).
 *
 * Static export: the id travels in the query string (no dynamic segment, no
 * server), read client-side via useSearchParams inside a Suspense boundary.
 * Every field archive.org did not return is shown as "Unknown", never filled
 * in. Format links are plain external downloads; the in-app reader fetches
 * text on demand only (never stored) and the player island is untouched.
 */

const UNKNOWN = "Unknown";

/** Human messages per BooksError code (lib/books.js). */
const ERROR_TITLES = {
  not_found: "Book not found.",
  restricted: "This book is not publicly available.",
  rate_limited: "archive.org is rate limiting requests — try again shortly.",
  network: "archive.org could not be reached.",
};

/** Bytes → "1.2 MB"; null → "size unknown". */
function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "size unknown";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

/** One metadata row; null/empty values render the literal "Unknown". */
function Field({ label, value }) {
  const empty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <dt className="w-28 shrink-0 text-zinc-500">{label}</dt>
      <dd className={empty ? "text-zinc-600 italic" : "text-zinc-200"}>
        {empty ? UNKNOWN : Array.isArray(value) ? value.join(", ") : String(value)}
      </dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex w-full flex-col gap-6 md:flex-row">
      <div className="h-64 w-44 shrink-0 animate-pulse rounded-lg bg-zinc-900" />
      <div className="flex-1 space-y-3">
        <div className="h-7 w-2/3 animate-pulse rounded bg-zinc-900" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-zinc-900" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-900" />
      </div>
    </div>
  );
}

/** Human messages per BookReaderError code (lib/bookreader.js). */
const READER_ERROR_TITLES = {
  no_readable_file: "This book has no readable text file the app can open in place.",
  network: "archive.org could not be reached.",
  http: "archive.org returned an error.",
  parse: "The book's text could not be read.",
  rate_limited: "archive.org is rate limiting requests — try again shortly.",
};

function BookReader({ book }) {
  const [readerState, setReaderState] = useState("idle"); // idle | loading | ready | error
  const [pages, setPages] = useState([]);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(null);

  const open = useCallback(async (signal) => {
    setReaderState("loading");
    setError(null);
    try {
      const result = await fetchBookText(book);
      if (signal?.cancelled) return;
      setPages(result.pages);
      setPageCount(result.pageCount);
      setTruncated(result.truncated);
      setPage(0);
      setReaderState("ready");
    } catch (e) {
      if (signal?.cancelled) return;
      setError(e);
      setReaderState("error");
    }
  }, [book]);

  const openReader = () => {
    const signal = { cancelled: false };
    open(signal);
  };

  if (readerState === "idle") {
    return (
      <button
        type="button"
        onClick={openReader}
        data-testid="reader-open"
        className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-black hover:bg-emerald-400 transition-colors"
      >
        Read
      </button>
    );
  }

  if (readerState === "loading") {
    return <p data-testid="reader-loading" className="text-sm text-zinc-500">Fetching the book's text from archive.org…</p>;
  }

  if (readerState === "error") {
    const retryAfter = error?.retryAfter;
    return (
      <div data-testid="reader-error" className="rounded-xl bg-zinc-900/50 p-4">
        <p className="text-sm text-red-400">{READER_ERROR_TITLES[error?.code] ?? "The book's text could not be read."}</p>
        {error?.message && <p className="mt-1 text-xs text-zinc-500">{error.message}</p>}
        {error?.code === "rate_limited" && retryAfter != null && (
          <p className="mt-1 text-xs text-zinc-500">archive.org asks you to retry after {retryAfter} second{retryAfter === 1 ? "" : "s"}.</p>
        )}
        {error?.code !== "no_readable_file" && (
          <button
            type="button"
            onClick={openReader}
            className="mt-3 inline-flex items-center gap-2 rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-emerald-600 hover:text-emerald-400 transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div data-testid="reader" className="rounded-xl bg-zinc-900/50 p-4">
      {truncated && (
        <p data-testid="reader-truncated" className="mb-3 text-xs text-amber-400">
          This book is longer than the in-app reader can show — the text here is truncated. Use the download links below for the full text.
        </p>
      )}
      <p data-testid="reader-page" className="whitespace-pre-line text-sm leading-relaxed text-zinc-200">
        {pages[page] ?? ""}
      </p>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          data-testid="reader-prev"
          className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-emerald-600 hover:text-emerald-400 transition-colors disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-200"
        >
          Previous
        </button>
        <span data-testid="reader-counter" className="tabular-nums text-xs text-zinc-500">
          Page {page + 1} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          disabled={page >= pageCount - 1}
          data-testid="reader-next"
          className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-emerald-600 hover:text-emerald-400 transition-colors disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-200"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function BookDetailInner() {
  const id = useSearchParams().get("id");
  const [state, setState] = useState(id ? "loading" : "empty");
  const [book, setBook] = useState(null);
  const [error, setError] = useState(null);
  const [coverOk, setCoverOk] = useState(true);

  const load = useCallback(async (signal) => {
    if (!id) { setState("empty"); return; }
    setState("loading");
    setError(null);
    try {
      const detail = await fetchBook(id);
      if (signal?.cancelled) return;
      setBook(detail);
      setCoverOk(true);
      setState("ready");
    } catch (e) {
      if (signal?.cancelled) return;
      setError(e);
      setState("error");
    }
  }, [id]);

  useEffect(() => {
    const signal = { cancelled: false };
    load(signal);
    return () => { signal.cancelled = true; };
  }, [load]);

  return (
    <main className="mx-auto max-w-4xl px-4 md:px-8 pt-6 md:pt-10" data-testid="book-detail">
      <Link href="/books" className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-emerald-400 transition-colors">
        Back to catalogue
      </Link>

      <div data-testid="book-detail-state" data-state={state}>
        {state === "loading" && <SurfaceState state="loading" skeleton={<DetailSkeleton />} />}
        {state === "empty" && (
          <SurfaceState
            state="empty"
            title="No book selected."
            hint="Open a book from the catalogue to see its details."
            emptyAction={{ label: "Browse books", href: "/books" }}
          />
        )}
        {state === "error" && (
          <SurfaceState
            state="error"
            title={ERROR_TITLES[error?.code] ?? "Could not load this book."}
            hint={error?.message}
            onRetry={error?.code === "not_found" || error?.code === "restricted" ? undefined : () => load()}
          />
        )}
        {state === "ready" && book && (
          <article className="flex flex-col gap-6 md:flex-row">
            {coverOk && (
              <img
                src={book.coverUrl}
                alt={book.title ? `Cover of ${book.title}` : "Book cover"}
                loading="lazy"
                decoding="async"
                onError={() => setCoverOk(false)}
                className="h-64 w-44 shrink-0 self-start rounded-lg bg-zinc-900 object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{book.title ?? "Untitled (unknown title)"}</h1>
              <p className="mt-1 text-sm text-zinc-400">{book.creators.length ? book.creators.join(", ") : UNKNOWN}</p>

              <dl className="mt-6 divide-y divide-zinc-800/60">
                <Field label="Year" value={book.year} />
                <Field label="Language" value={book.language} />
                <Field label="Publisher" value={book.publisher} />
                <Field label="Subjects" value={book.subjects} />
                <Field label="Downloads" value={book.downloads == null ? null : book.downloads.toLocaleString()} />
                {book.licenseUrl && <Field label="License" value={book.licenseUrl} />}
                {book.rights && <Field label="Rights" value={book.rights} />}
              </dl>

              <section className="mt-8">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">Read</h2>
                <BookReader book={book} />
              </section>

              <section className="mt-8">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">Formats</h2>
                {book.files.length === 0 ? (
                  <p className="text-sm text-zinc-500">No downloadable reading formats are listed for this item.</p>
                ) : (
                  <ul data-testid="book-formats" className="divide-y divide-zinc-800/60 rounded-xl bg-zinc-900/50">
                    {book.files.map((f) => (
                      <li key={f.name}>
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-zinc-800/60 transition-colors"
                        >
                          <span className="w-24 shrink-0 font-medium text-emerald-400">{f.format}</span>
                          <span className="min-w-0 flex-1 truncate text-zinc-300">{f.name}</span>
                          <span className="shrink-0 tabular-nums text-xs text-zinc-500">{formatSize(f.size)}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                <a
                  href={book.detailsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-2 rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-emerald-600 hover:text-emerald-400 transition-colors"
                >
                  View on archive.org
                </a>
              </section>

              <section className="mt-8">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">Description</h2>
                <p className={`whitespace-pre-line text-sm leading-relaxed ${book.description ? "text-zinc-300" : "italic text-zinc-600"}`}>
                  {book.description ?? UNKNOWN}
                </p>
              </section>
            </div>
          </article>
        )}
      </div>
    </main>
  );
}

/**
 * Static export wrapper: useSearchParams() requires a Suspense boundary
 * during prerender (Next.js requirement for output: "export").
 */
export default function BookDetailPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-4xl px-4 py-10" data-testid="book-detail"><p className="text-sm text-zinc-500">Loading…</p></main>}>
      <BookDetailInner />
    </Suspense>
  );
}
