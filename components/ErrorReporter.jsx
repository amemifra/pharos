"use client";

import { useEffect } from "react";
import { startErrorReporter } from "@/lib/errorReporter";

/** Mounts the browser error reporter (inert in the static Pages export). */
export default function ErrorReporter() {
  useEffect(() => startErrorReporter({
    endpoint: process.env.NEXT_PUBLIC_PHAROS_ERROR_ENDPOINT,
    build: process.env.NEXT_PUBLIC_PHAROS_BUILD,
  }), []);
  return null;
}
