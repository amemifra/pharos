import { PlayerProvider } from "@/components/PlayerProvider";
import NowPlayingBar from "@/components/NowPlayingBar";
import AppShell from "@/components/AppShell";
import HashRedirect from "@/components/HashRedirect";
import Splash from "@/components/Splash";

/**
 * Shell layout — everything EXCEPT the player island.
 * PlayerProvider mounts the player island iframe (see components/PlayerIsland)
 * and keeps the exact same usePlayer() API the app has always had; NowPlayingBar
 * and AppShell live here and persist across client-side navigation.
 * HashRedirect maps legacy #/artist/… deep links to the query-param routes
 * required by static hosting (GitHub Pages).
 */
export default function ShellLayout({ children }) {
  return (
    <PlayerProvider>
      <Splash />
      <HashRedirect />
      <AppShell>{children}</AppShell>
      <NowPlayingBar />
    </PlayerProvider>
  );
}
