"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy deep-link shim for static hosting.
 *
 * GitHub Pages cannot resolve dynamic route segments, so the app moved to
 * query-param URLs (/album?id=…, /artist?n=…). Old shared links of the form
 *   #/artist/<name>            → /artist?n=<name>
 *   #/artist/<name>/album/<id> → /album?id=<id>&n=<name>
 * still work: this component runs once on boot, rewrites the URL with
 * router.replace (no history entry) and the hash is dropped.
 */
export default function HashRedirect() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#/")) return;
    const parts = hash.slice(2).split("/").map(decodeURIComponent);
    if (parts[0] === "artist" && parts[1]) {
      if (parts[2] === "album" && parts[3]) {
        router.replace(`/album?id=${encodeURIComponent(parts[3])}&n=${encodeURIComponent(parts[1])}`);
      } else {
        router.replace(`/artist?n=${encodeURIComponent(parts[1])}`);
      }
    }
  }, [router]);

  return null;
}
