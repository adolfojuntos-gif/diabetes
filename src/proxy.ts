/**
 * THE GATE (Next 16 `proxy` convention; `middleware` is deprecated).
 *
 * This does one cheap thing: an unauthenticated request to a private path is sent to sign-in
 * instead of rendering. It checks only that a session cookie EXISTS, because the proxy runs before
 * the app and has no business opening a database.
 *
 * **It is not the security boundary.** The boundary is `requireAccount()`, which verifies the
 * cookie against the control database and establishes the account whose data `db` resolves to.
 * Without that context `db` throws, so a screen that skips the check gets an error rather than
 * somebody else's records. This file exists to make the common case a redirect rather than a crash.
 *
 * Public by design:
 *   /signin, /signup       the way in
 *   /share/*               the caregiver link, whose credential is the token in the URL
 *   /api/coach/*           its own bearer token, and a cron cannot fill in a form
 *   /api/stripe/webhook    signed by Stripe, which has no session and cannot get one
 *   /hero/*, static        assets
 *
 * The Stripe entry was missing when billing was first written, and the consequence was not a
 * visible error. Every webhook got a 307 to the sign-in page, Stripe read the 307 as a delivered
 * response, and the events were dropped. Subscribers would have paid and never been upgraded, with
 * nothing in the app's own logs to say so. It was invisible to the unit tests too, because those
 * call the route handler directly and never pass through this file. A real HTTP request found it.
 */
import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "steady_session";

/** Exported so `tests/boundaries.test.ts` can check it against the routes that actually exist. */
export const PUBLIC_PREFIXES = ["/signin", "/signup", "/share/", "/api/coach", "/api/stripe/webhook", "/hero/"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/signin";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
