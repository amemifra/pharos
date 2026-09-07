import { Metadata } from "next";

/** Standalone document metadata for the player island (loaded in an iframe). */
export const metadata = {
  title: "Pharos player island",
  robots: { index: false },
};

/**
 * Island layout — intentionally bare.
 * The player island is a standalone document inside an iframe: no AppShell,
 * no NowPlayingBar, no shell JS. Its only job is owning the <audio> element
 * (see ./page.jsx) and speaking the pf.* postMessage contract.
 */
export default function PlayerIslandLayout({ children }) {
  return children;
}
