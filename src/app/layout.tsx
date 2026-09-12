import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Nunito } from "next/font/google";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { Frame } from "@/components/Frame";
import { optionalAccount, asAccount } from "@/lib/auth/session";
import { getProfile } from "@/lib/data/snapshot";
import { unreadCount } from "@/lib/data/nudges";
import { pendingCount } from "@/lib/data/lifequest";
import "./globals.css";

const serif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400", display: "swap" });
// Nunito for everything you tap and read. Rounded terminals read warm where Instrument Sans read
// cool and editorial, and it keeps true tabular figures so a column of readings still lines up.
const sans = Nunito({ variable: "--font-instrument-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // One world, one colour. The browser chrome matches the night ground so the app does not end
  // at a seam on a phone.
  themeColor: "#080b14",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /**
   * The layout resolves the account only to decide what CHROME to draw, and it establishes its own
   * database context for the two reads it needs.
   *
   * It deliberately does not wrap `children`. React may render a layout and a page in separate
   * async tasks, so async-local context set here is not guaranteed to reach the page, and a
   * boundary that works by luck is worse than no boundary. Each page establishes its own context
   * through `requireAccount()`, and `db` throws without it, so a page that forgets fails loudly
   * rather than reading the wrong account.
   */
  const account = await optionalAccount();
  let onboarded = false;
  let unread = 0;
  let quests = 0;
  let name = "";
  if (account) {
    try {
      const [profile, count, waiting] = await asAccount(account, () => Promise.all([getProfile(), unreadCount(), pendingCount()]));
      onboarded = profile.onboarded;
      unread = count;
      quests = waiting;
      name = profile.name;
    } catch {
      // Most likely an account caught mid-provision. Draw the bare frame rather than failing the
      // whole page over chrome.
      onboarded = false;
    }
  }

  return (
    <html lang="en">
      <body className={`${serif.variable} ${sans.variable}`}>
        {/* The ambient wash. A light source behind every screen, never a surface. */}
        <div className="ambient" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:card focus:px-4 focus:py-2">
          Skip to content
        </a>
        <Frame onboarded={Boolean(account) && onboarded} unread={unread} quests={quests} name={name}>
          {children}
        </Frame>
      </body>
    </html>
  );
}
