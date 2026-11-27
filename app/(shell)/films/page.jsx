"use client";

import { Suspense } from "react";
import FilmsPage from "../films-page.jsx";

/**
 * /films — route file for the Films page (static export).
 * The shell renders app/(shell)/films-page.jsx, shared with any future
 * /films subroutes; Suspense satisfies the useSearchParams prerender rule.
 */
export default function FilmsRoute() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-10"><p className="text-sm text-zinc-500">Loading…</p></main>}>
      <FilmsPage />
    </Suspense>
  );
}
