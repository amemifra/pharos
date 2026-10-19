"use client";

import { useEffect } from "react";
import { startBrowserTelemetry } from "@/lib/browserTelemetry";

/** Public, append-only runtime observations; never app/session credentials. */
export default function BrowserTelemetry() {
  useEffect(() => startBrowserTelemetry({
    collector: process.env.NEXT_PUBLIC_PASSO_TELEMETRY_URL,
    sourceCommit: process.env.NEXT_PUBLIC_PASSO_SOURCE_COMMIT,
  }), []);
  return null;
}
