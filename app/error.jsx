"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/errorReporter";

/** Route error boundary: records the render error, offers a retry. */
export default function RouteError({ error, reset }) {
  useEffect(() => { reportError(error, "boundary"); }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-md p-8 text-center">
      <h2 className="text-lg font-semibold">Something went wrong.</h2>
      <p className="mt-2 text-sm text-zinc-400">The error has been recorded.</p>
      <button type="button" onClick={() => reset()} className="mt-4 rounded bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700">Try again</button>
    </div>
  );
}
