import Link from "next/link";
import { revalidatePath } from "next/cache";
import { PageHeader, Card, Notice, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { requireAccount } from "@/lib/auth/session";
import { recentCoachMessages, markCoachRead, getOrCreateMorning, getOrCreateWeekly, coachConfig } from "@/lib/data/coach";
import { fmtDayLong, fmtTime, parseDateKey, relative } from "@/lib/time";
import type { TriageLevel } from "@/lib/db";
import { coachTokenFor } from "@/lib/auth/tokens";
import { noteTo } from "../_shared/server";
import { FormNote, param, type SP } from "../_shared/ui";

export const dynamic = "force-dynamic";

const PATH = "/toolkit/checkins";

const LEVEL_LABEL: Record<TriageLevel, string> = {
  emergency: "Emergency",
  urgent: "Urgent",
  clinic: "For your care team",
  general: "Nothing urgent",
};

async function markRead(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const id = String(fd.get("id") ?? "");
  if (id) await markCoachRead(id);
  revalidatePath("/toolkit/checkins");
  revalidatePath("/");
  });
}

async function generateNow(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  if (String(fd.get("kind") ?? "morning") === "weekly") await getOrCreateWeekly();
  else await getOrCreateMorning();
  revalidatePath("/toolkit/checkins");
  revalidatePath("/");
  });
}

/**
 * Mint this account's scheduling token and show it once.
 *
 * The screen used to tell people to send a bearer token "matching COACH_API_SECRET in your
 * environment". That was true when one secret gated the endpoint for one person, and since the
 * split it is doubly wrong: the endpoint authenticates a PER-ACCOUNT token, and there was no way
 * for anybody to obtain theirs. So the instruction described a variable that does nothing and asked
 * for something the interface could not produce.
 *
 * Minting ROTATES, because only the digest is stored and an existing token cannot be shown again.
 * The copy says so, since silently breaking somebody's working cron would be worse than the
 * inconvenience of saying it.
 */
async function revealToken() {
  "use server";
  const token = await requireAccount(async (account) => coachTokenFor(account.id));
  noteTo(PATH, `Your scheduling token: ${token}`);
}

export default async function Checkins({ searchParams }: { searchParams?: SP }) {
  return requireAccount(async () => {
  const [messages, cfg, note] = await Promise.all([
    recentCoachMessages(12),
    Promise.resolve(coachConfig()),
    param(searchParams, "m"),
  ]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Check-ins"
        title="Your morning brief and week in review"
        lede="A short read on what yesterday looked like, and one small thing worth doing today. The numbers in it are computed by this app, not written by a model."
      />

      {/* The minted token arrives here, once. It is never stored in readable form, so this is the
          only moment it exists as something a person can copy. */}
      <FormNote message={note} />

      <div className="grid gap-3 sm:grid-cols-2 mb-6">
        <Card>
          <h3>Morning brief</h3>
          <p className="hint mt-1">Yesterday in a few lines, plus one focus for today.</p>
          <form action={generateNow} className="mt-3">
            <input type="hidden" name="kind" value="morning" />
            <SubmitButton className="btn btn-secondary btn-sm" pendingText="Writing…">
              Write today&apos;s
            </SubmitButton>
          </form>
        </Card>
        <Card>
          <h3>Week in review</h3>
          <p className="hint mt-1">The week that just ended, with wins and things worth raising.</p>
          <form action={generateNow} className="mt-3">
            <input type="hidden" name="kind" value="weekly" />
            <SubmitButton className="btn btn-secondary btn-sm" pendingText="Writing…">
              Write last week&apos;s
            </SubmitButton>
          </form>
        </Card>
      </div>

      <Notice>
        These can also be delivered on a schedule. Point a cron or an automation at{" "}
        <code>POST /api/coach/morning</code> and <code>POST /api/coach/weekly</code> with a{" "}
        <code>Bearer</code> token belonging to this account. The caller owns the clock and the
        delivery; this app keeps the data, the safety check, the model call and the audit. Asking
        twice on the same day returns the same message rather than writing a second one.
        {!cfg.modelKeySet ? " With no API key set, the app's own engine writes these and says so." : ""}
      </Notice>

      <Card className="mt-3">
        <h3>Your scheduling token</h3>
        <p className="hint mt-1 prose-measure">
          This token stands for this account and nothing else. Anyone holding it can ask Steady to
          write your check-ins, so treat it like a password. Showing a new one replaces the old one,
          which means an automation already using the previous token will stop working.
        </p>
        <form action={revealToken} className="mt-3">
          <SubmitButton className="btn btn-secondary btn-sm" pendingText="Minting…">
            Show a new token
          </SubmitButton>
        </form>
      </Card>

      <h2 className="mt-8 mb-3">Recent check-ins</h2>
      {messages.length === 0 ? (
        <EmptyState
          title="None yet"
          body="Write one above, or set up a schedule. Each one is kept here so you can look back at what a given morning actually looked like."
        />
      ) : (
        <div className="grid gap-3">
          {messages.map((m) => (
            <article key={m.id} className={`card p-4 ${m.readAt ? "" : "sev-info"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="eyebrow">{m.kind === "morning" ? "Morning brief" : "Week in review"}</div>
                  <h3>{m.kind === "morning" ? fmtDayLong(parseDateKey(m.date)) : `Week of ${fmtDayLong(parseDateKey(m.date))}`}</h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {m.triageLevel !== "general" ? <span className="pill pill-coral">{LEVEL_LABEL[m.triageLevel]}</span> : null}
                  <span className="pill">{m.responder === "engine" ? "Written by the engine" : "Written by the Copilot"}</span>
                  {m.filtered ? <span className="pill pill-amber">Dose language filtered</span> : null}
                  {!m.readAt ? <span className="pill pill-slate">New</span> : null}
                </div>
              </div>

              <div className="mt-3 prose-measure">
                {m.body.split(/\n{2,}/).map((para, i) => (
                  <p key={i} className={i ? "mt-3" : ""}>
                    {para}
                  </p>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Link href="/copilot" className="btn btn-slate btn-sm">
                  Talk about this
                </Link>
                <Link href={m.kind === "morning" ? "/" : "/review"} className="btn btn-secondary btn-sm">
                  {m.kind === "morning" ? "See today" : "See the full review"}
                </Link>
                {!m.readAt ? (
                  <form action={markRead}>
                    <input type="hidden" name="id" value={m.id} />
                    <button className="btn btn-ghost btn-sm">Mark read</button>
                  </form>
                ) : null}
              </div>

              <div className="hint mt-3">
                Written {relative(m.createdAt)} at {fmtTime(m.createdAt)}
                {m.deliveredAt ? ` · delivered via ${m.channel === "telegram" ? "Telegram" : "the app"}` : " · not delivered anywhere"}
                {m.model ? ` · ${m.model}` : ""}
              </div>

              <details className="mt-2">
                <summary className="hint cursor-pointer">The facts this was written from</summary>
                <pre className="mt-2 text-xs overflow-x-auto card-sunk p-3">{JSON.stringify(JSON.parse(m.facts), null, 2)}</pre>
              </details>
            </article>
          ))}
        </div>
      )}
    </div>
  );
  });
}
