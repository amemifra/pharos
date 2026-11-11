"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/errorReporter";

/** Root-layout error boundary: replaces the whole document, so it owns <html>. */
export default function GlobalError({ error, reset }) {
  useEffect(() => { reportError(error, "global-boundary"); }, [error]);
  return (
    <html lang="en">
      <body style={{ background: "#09090b", color: "#f4f4f5", fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "4rem 1rem" }}>
        <h2>Something went wrong.</h2>
        <p style={{ color: "#a1a1aa" }}>The error has been recorded.</p>
        <button type="button" onClick={() => reset()}>Try again</button>
      </body>
    </html>
  );
}
