"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/brand";

type Item = { href: string; label: string; icon: React.ReactNode; match: (p: string) => boolean };

const I = {
  today: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>
  ),
  log: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
  ),
  trends: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>
  ),
  copilot: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.4A8 8 0 1 1 21 12z" /></svg>
  ),
  plan: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
  ),
  move: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="13" cy="4" r="1.5" /><path d="M9 21l2-6 3 2v4M6 13l3-4 4-1 3 3 3-1" /></svg>
  ),
  toolkit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" /></svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
  ),
};

const ITEMS: Item[] = [
  { href: "/", label: "Today", icon: I.today, match: (p) => p === "/" },
  { href: "/log", label: "Log", icon: I.log, match: (p) => p.startsWith("/log") },
  { href: "/trends", label: "Trends", icon: I.trends, match: (p) => p.startsWith("/trends") || p.startsWith("/review") },
  { href: "/copilot", label: "Copilot", icon: I.copilot, match: (p) => p.startsWith("/copilot") },
  { href: "/plan", label: "Plan", icon: I.plan, match: (p) => p.startsWith("/plan") },
  { href: "/move", label: "Move", icon: I.move, match: (p) => p.startsWith("/move") },
  { href: "/toolkit", label: "Toolkit", icon: I.toolkit, match: (p) => p.startsWith("/toolkit") || p.startsWith("/inbox") },
  { href: "/settings", label: "Settings", icon: I.more, match: (p) => p.startsWith("/settings") },
];

const MOBILE = ["/", "/log", "/trends", "/copilot", "/toolkit"];

export function Frame({ children, onboarded, unread, name }: { children: React.ReactNode; onboarded: boolean; unread: number; name: string }) {
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
          <Link key={it.href} href={it.href} className="nav-link" aria-current={it.match(path) ? "page" : undefined}>
            <span className="w-5 h-5 shrink-0">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.href === "/toolkit" && unread > 0 ? <span className="pill pill-coral">{unread}</span> : null}
          </Link>
        ))}
        <div className="mt-auto px-3 py-3 text-xs faint">
          Not medical advice. Steady never changes or suggests a medication or insulin dose.
        </div>
      </nav>
      <main id="main" className="min-w-0">{children}</main>
      <nav className="tabbar md:hidden" aria-label="Main">
        {ITEMS.filter((i) => MOBILE.includes(i.href)).map((it) => (
          <Link key={it.href} href={it.href} className="tab relative" aria-current={it.match(path) ? "page" : undefined}>
            {it.icon}
            <span>{it.label}</span>
            {it.href === "/toolkit" && unread > 0 ? <span className="absolute top-0 right-1/4 w-2 h-2 rounded-full bg-coral" aria-label={`${unread} unread`} /> : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}
