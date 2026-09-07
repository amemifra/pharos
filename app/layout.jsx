import "./globals.css";

/**
 * Root layout — deliberately minimal.
 * Two route groups split the document:
 *   (shell)/ — the full app: PlayerProvider + AppShell + NowPlayingBar
 *   player/  — the player island: a standalone document loaded in an iframe
 *              (phase 1 of docs/ux-architecture.md), which must NOT inherit
 *              the shell's chrome or its JS bundle.
 */
export const metadata = {
  title: "Pharos — a lighthouse for public culture",
  description:
    "Music, podcasts, films and books from archive.org and open legal sources — zero servers, community-built catalog.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
