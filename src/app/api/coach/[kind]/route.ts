/**
 * POST /api/coach/morning  ·  POST /api/coach/weekly
 *
 * The only part of Steady reachable from outside this machine, so it is the only part written
 * defensively:
 *
 *  - A bearer token is REQUIRED, and it belongs to ONE account. There is no global secret, so a
 *    token cannot act for somebody it was not issued for, and an endpoint with nothing configured
 *    refuses everything rather than defaulting open.
 *  - Lookup is by SHA-256 of the token, so a copy of the control database grants nothing, and a
 *    wrong token, a revoked one and one from a closed account are indistinguishable from outside.
 *  - Every AUTHENTICATED request is recorded in `coach_events` in that account's own database, with
 *    no health data in the row. A request that was turned away has no account to be recorded in, so
 *    it goes to the server log instead, sampled per address.
 *  - Generation is idempotent on (kind, date). A cron that fires twice gets the same message.
 *  - Nothing here decides urgency or writes a number. It calls the same engines and the same
 *    deterministic triage as the app, and the safety banner is prepended from fixed text.
 *
 * The caller (n8n, a cron, a shortcut) owns the clock and the transport and nothing else.
 */
import { NextResponse } from "next/server";
import { COACH_KINDS, type CoachKind } from "@/lib/db";
import { getOrCreateMorning, getOrCreateWeekly, logCoachEvent, markDelivered } from "@/lib/data/coach";
import { resolveToken } from "@/lib/auth/tokens";
import { asAccount } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Pull the bearer token out of the request. It does not authenticate anything on its own.
 *
 * A single shared `COACH_API_SECRET` used to be the whole check, and with one account that was
 * enough. It cannot be now: a secret says "you may", not "for whom", and this route has to know
 * whose morning brief to write. Each account has its own token instead, looked up in the control
 * plane, which authenticates and identifies in the same step.
 */
function bearerFrom(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : (req.headers.get("x-coach-token") ?? "").trim();
  return given.length > 0 ? given : null;
}

function ipOf(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? req.headers.get("x-real-ip") ?? null;
}

/**
 * An unauthenticated caller must not be able to make this app write to its own database.
 *
 * It could: every rejected request inserted a `coach_events` row, so 300 bad tokens in twelve
 * seconds added 40 KB, with no rate limit and no pruning. Left alone, a shell loop fills the volume
 * the SQLite file lives on, and when that volume is full EVERY write in the app fails, including
 * logging a glucose reading. A denial of service on the log is a denial of service on the product.
 *
 * So refusals are counted in memory and only sampled: at most one line per IP per minute, carrying
 * the number suppressed since the last one. A real attack still shows up as "this address knocked
 * 40,000 times", which is what an operator actually needs to see, and it costs one line a minute
 * instead of one row a request.
 *
 * Since the databases were split there is a second reason, and it is the stronger one: a caller who
 * failed to authenticate has no account, so there is no database to write the refusal TO. The
 * sampled write used to go to `db`, which throws `NoAccountContextError` outside an account. That
 * turned the first refusal from each address each minute into a 500 while the suppressed ones
 * returned a clean 401, so the endpoint was intermittently telling a stranger that their wrong
 * token took a different path from no token at all. A refusal now goes to stderr, which is where an
 * event that belongs to nobody belongs.
 */
const REFUSAL_WINDOW_MS = 60_000;
const refusals = new Map<string, { lastLoggedAt: number; suppressed: number }>();

function noteRefusal(route: string, outcome: string, detail: string | null, ip: string | null) {
  const key = ip ?? "unknown";
  const now = Date.now();
  const seen = refusals.get(key);
  if (seen && now - seen.lastLoggedAt < REFUSAL_WINDOW_MS) {
    seen.suppressed++;
    return;
  }
  const suppressed = seen?.suppressed ?? 0;
  refusals.set(key, { lastLoggedAt: now, suppressed: 0 });
  // Keep the map from becoming its own leak.
  if (refusals.size > 500) {
    for (const [k, v] of refusals) if (now - v.lastLoggedAt > 10 * REFUSAL_WINDOW_MS) refusals.delete(k);
  }
  const extra = suppressed > 0 ? ` (+${suppressed} more suppressed in the last minute)` : "";
  console.warn(`coach refusal ${outcome} ${route} from ${ip ?? "unknown"}: ${detail ?? outcome}${extra}`);
}

export async function POST(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind: raw } = await params;
  const route = `/api/coach/${raw}`;
  const ip = ipOf(req);

  const bearer = bearerFrom(req);
  if (!bearer) {
    noteRefusal(route, "unauthorized", "no bearer token", ip);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const resolved = await resolveToken("coach", bearer);
  if (!resolved) {
    // A wrong token, a revoked one and one belonging to a closed account are all the same from here.
    noteRefusal(route, "unauthorized", null, ip);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(COACH_KINDS as readonly string[]).includes(raw)) {
    await asAccount(resolved.account, () => logCoachEvent(route, "bad_request", `unknown kind: ${raw.slice(0, 20)}`, ip));
    return NextResponse.json({ error: `kind must be one of: ${COACH_KINDS.join(", ")}` }, { status: 400 });
  }

  let channel: "telegram" | "inapp" = "inapp";
  try {
    const body = (await req.json()) as { channel?: string } | null;
    if (body?.channel === "telegram") channel = "telegram";
  } catch {
    // No body is fine. The kind is in the path.
  }

  try {
    const kind = raw as CoachKind;
    // Everything below runs against the token holder's own database and nobody else's.
    const { message, alreadyExisted } = await asAccount(resolved.account, () =>
      kind === "weekly" ? getOrCreateWeekly() : getOrCreateMorning(),
    );
    const created = !alreadyExisted;
    if (created) await asAccount(resolved.account, () => markDelivered(message.id, channel));
    await asAccount(resolved.account, () => logCoachEvent(route, "ok", created ? "generated" : "already existed", ip));
    return NextResponse.json({
      id: message.id,
      kind: message.kind,
      date: message.date,
      created,
      triageLevel: message.triageLevel,
      responder: message.responder,
      model: message.model,
      filtered: message.filtered,
      /** The text to deliver. The safety line, when there is one, is already the first paragraph. */
      body: message.body,
      /** Where a reply should go, so the transport can offer a button. */
      replyUrl: "/copilot",
    });
  } catch (err) {
    /**
     * Wrapped, and swallowed. An authenticated request failed, and the log of that failure must
     * neither need an account context it does not have nor replace the real error with a logging
     * error, which is what happened here before: the catch threw NoAccountContextError and the
     * original cause was lost.
     */
    await asAccount(resolved.account, () => logCoachEvent(route, "error", err instanceof Error ? err.name : "unknown", ip)).catch(
      () => console.error("coach: could not log the failure", err),
    );
    return NextResponse.json({ error: "Could not generate the check-in." }, { status: 500 });
  }
}

/** A configured-and-reachable check for the cron to probe. Tells an unauthorised caller nothing. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind: raw } = await params;
  const bearer = bearerFrom(req);
  const resolved = bearer ? await resolveToken("coach", bearer) : null;
  if (!resolved) {
    noteRefusal(`/api/coach/${raw}`, "unauthorized", "GET", ipOf(req));
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Confirms the token works and which account it speaks for, and nothing clinical.
  return NextResponse.json({ ok: true, kinds: COACH_KINDS, account: resolved.account.email });
}
