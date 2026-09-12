"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/brand";

/**
 * The navigation, which is now the game's navigation.
 *
 * Each item carries BOTH names: the game's word, which is what you see, and the plain word, which
 * is what screen readers announce and what sits under it on desktop. The plain word is not
 * decoration and it does not get dropped at small sizes. Somebody who opened this app because
 * their nurse told them to must be able to find "Log" without first learning that it is called
 * "Gather", and a carer helping at 3am has no patience for a vocabulary.
 */
type Item = { href: string; label: string; plain: string; icon: React.ReactNode; match: (p: string) => boolean };

const I = {
  world: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 19l5-9 4 5 3-4 6 8z" /><circle cx="17" cy="5" r="2" /></svg>
  ),
  today: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>
  ),
  gather: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
  ),
  chronicle: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>
  ),
  guardian: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.4A8 8 0 1 1 21 12z" /></svg>
  ),
  provisions: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
  ),
  explore: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="13" cy="4" r="1.5" /><path d="M9 21l2-6 3 2v4M6 13l3-4 4-1 3 3 3-1" /></svg>
  ),
  satchel: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" /></svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
  ),
};

const ITEMS: Item[] = [
  { href: "/", label: "Your world", plain: "Home", icon: I.world, match: (p) => p === "/" || p.startsWith("/quest") },
  { href: "/today", label: "Today", plain: "Your numbers", icon: I.today, match: (p) => p.startsWith("/today") },
  { href: "/log", label: "Gather", plain: "Log", icon: I.gather, match: (p) => p.startsWith("/log") },
  { href: "/move", label: "Explore", plain: "Movement", icon: I.explore, match: (p) => p.startsWith("/move") },
  { href: "/plan", label: "Provisions", plain: "Meals", icon: I.provisions, match: (p) => p.startsWith("/plan") },
  { href: "/trends", label: "The Chronicle", plain: "Trends", icon: I.chronicle, match: (p) => p.startsWith("/trends") || p.startsWith("/review") },
  { href: "/copilot", label: "Ask a Guardian", plain: "Copilot", icon: I.guardian, match: (p) => p.startsWith("/copilot") },
  { href: "/toolkit", label: "The Satchel", plain: "Toolkit", icon: I.satchel, match: (p) => p.startsWith("/toolkit") || p.startsWith("/inbox") },
  { href: "/settings", label: "Settings", plain: "", icon: I.more, match: (p) => p.startsWith("/settings") },
];

/**
 * The five that fit on a phone. The world is first because it is the front door now, and Today
 * keeps its place beside it because the numbers must never be more than one tap away.
 */
const MOBILE = ["/", "/today", "/log", "/copilot", "/toolkit"];

export function Frame({
  children,
  onboarded,
  unread,
  quests,
  name,
}: {
  children: React.ReactNode;
  onboarded: boolean;
  unread: number;
  quests: number;
  name: string;
}) {
  const path = usePathname();
  const bare = !onboarded || path.startsWith("/share/") || path.startsWith("/welcome");
  if (bare) return <main id="main">{children}</main>;

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <nav className="hidden md:flex md:flex-col md:gap-1 md:p-4 md:sticky md:top-0 md:h-dvh border-r border-line" aria-label="Main">
        <Link href="/" className="px-3 py-3 mb-2">
          <span className="font-display text-2xl">{APP_NAME}</span>
          {name ? <span className="block text-sm muted">for {name}</span> : null}
        </Link>
        {ITEMS.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="nav-link"
            aria-current={it.match(path) ? "page" : undefined}
            aria-label={it.plain ? `${it.label}: ${it.plain}` : it.label}
          >
            <span className="w-5 h-5 shrink-0">{it.icon}</span>
            <span className="flex-1 min-w-0">
              <span className="block truncate">{it.label}</span>
              {it.plain ? <span className="block text-xs faint truncate">{it.plain}</span> : null}
            </span>
            {it.href === "/toolkit" && unread > 0 ? <span className="pill pill-coral">{unread}</span> : null}
            {/* Bloom, never coral: something waiting in the game is an invitation, not a warning. */}
            {it.href === "/" && quests > 0 ? (
              <span className="pill" style={{ background: "var(--bloom-soft)", color: "var(--bloom)" }}>
                {quests}
              </span>
            ) : null}
          </Link>
        ))}
        <div className="mt-auto px-3 py-3 text-xs faint">
          Not medical advice. Steady never changes or suggests a medication or insulin dose.
        </div>
      </nav>
      <main id="main" className="min-w-0">{children}</main>
      <nav className="tabbar md:hidden" aria-label="Main">
        {ITEMS.filter((i) => MOBILE.includes(i.href)).map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="tab relative"
            aria-current={it.match(path) ? "page" : undefined}
            aria-label={it.plain ? `${it.label}: ${it.plain}` : it.label}
          >
            {it.icon}
            <span>{it.label}</span>
            {it.href === "/toolkit" && unread > 0 ? (
              <span className="absolute top-0 right-1/4 w-2 h-2 rounded-full bg-coral" aria-label={`${unread} unread`} />
            ) : null}
            {it.href === "/" && quests > 0 ? (
              <span className="absolute top-0 right-1/4 w-2 h-2 rounded-full" style={{ background: "var(--bloom)" }} aria-label={`${quests} waiting`} />
            ) : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}
