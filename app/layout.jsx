import "./globals.css";
import { BASE_PATH } from "@/lib/basepath";

/**
 * Root layout — deliberately minimal.
 * Two route groups split the document:
 *   (shell)/ — the full app: PlayerProvider + AppShell + NowPlayingBar
 *   player/  — the player island: a standalone document loaded in an iframe
 *              (phase 1 of docs/ux-architecture.md), which must NOT inherit
 *              the shell's chrome or its JS bundle.
 */
/** PWA installable: static-export manifest under the Pages basePath. */
export const metadata = {
  manifest: `${BASE_PATH}/manifest.webmanifest`,
  title: "Pharos — a lighthouse for public culture",
  description:
    "Music, podcasts, films and books from archive.org and open legal sources — zero servers, community-built catalog.",
};

/** Standalone display paints the shell ink background behind the OS chrome. */
export const viewport = {
  themeColor: "#09090b",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
