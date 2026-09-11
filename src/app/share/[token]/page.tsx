/**
 * The caregiver's read-only view.
 *
 * Invariant 9: a caregiver sees only what the patient scoped. The token is the credential, and the
 * server renders strictly by `caregivers.can_view` — anything not listed is not queried at all.
 * There is no Copilot here, no settings, no journal, and nothing that can be changed except a
 * comment, when the patient allowed comments.
 */
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  caregiverComments,
  caregivers,
  exerciseSessions,
  glucoseReadings,
  hydrationLogs,
  insulinDoses,
  labResults,
  meals,
  medications,
  nudges,
  sleepLogs,
  wellbeingCheckins,
  type CaregiverScope,
  type NudgeKind,
} from "@/lib/db";
import { resolveToken } from "@/lib/auth/tokens";
import { asAccount } from "@/lib/auth/session";
import { getProfile } from "@/lib/data/snapshot";
import { glucoseStats } from "@/lib/engines/stats";
import { newId } from "@/lib/ids";
import { parseForm, zStr, zOptStr } from "@/lib/actions";
import { addDays, dateKey, fmtDay, fmtTime, startOfDay } from "@/lib/time";
import { formatGlucose, unitLabel } from "@/lib/units";
import { Card, TirBar, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { FormError, FormNote, param, type SP } from "../../toolkit/_shared/ui";
import { failTo, noteTo } from "../../toolkit/_shared/server";

const DAYS = 7;

async function addComment(fd: FormData) {
  "use server";
  const token = String(fd.get("token") ?? "");
  const back = `/share/${encodeURIComponent(token)}`;
  const r = parseForm(z.object({ token: zStr(200), body: zStr(1000), aboutDate: zOptStr(10) }), fd);
  if ("error" in r) failTo(back, r.error);

  // Resolve the token to an account first. Until that happens there is no database to read.
  const resolved = await resolveToken("share", r.data.token);
  if (!resolved) failTo(back, "This link is no longer active.");

  await asAccount(resolved.account, async () => {
    // The permission itself lives with the patient, not with the token, so it is read from their
    // own database on every request and a revoked or narrowed link stops working immediately.
    const rows = await db.select().from(caregivers).where(eq(caregivers.id, resolved.subjectId ?? "")).limit(1);
    const cg = rows[0];
    if (!cg || cg.status !== "active" || !cg.canComment) failTo(back, "This link cannot leave notes.");
    const body = r.data.body.trim();
    if (body.length < 2) failTo(back, "Write a few words before sending.");
    await db.insert(caregiverComments).values({
      id: newId(),
      caregiverId: cg.id,
      at: new Date(),
      body,
      aboutDate: r.data.aboutDate,
      readAt: null,
    });
  });

  revalidatePath(back);
  revalidatePath("/toolkit/caregivers");
  noteTo(back, "Sent. They will see it in their app.");
}

function Inactive() {
  return (
    <div className="page">
      <div className="card p-6 prose-measure mx-auto text-center">
        <h1>This link is no longer active</h1>
        <p className="muted mt-3">
          If you were expecting to see something here, ask the person who sent you the link. Nothing else is shown on this
          page.
        </p>
      </div>
    </div>
  );
}

const NUDGE_LABEL: Record<NudgeKind, string> = {
  pattern: "Pattern",
  gap: "Gap",
  win: "Win",
  safety: "Safety",
  reminder: "Reminder",
};

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: SP;
}) {
  const { token } = await params;
  const [error, note] = await Promise.all([param(searchParams, "e"), param(searchParams, "m")]);

  /**
   * The token identifies WHICH account, and that lookup has to happen in the control plane: the
   * caregivers row saying what this link may see lives inside one account's database, and there is
   * no way to know whose without a directory. Only the digest is stored, so a copy of the control
   * database does not hand anyone a working link.
   *
   * A token that does not resolve and a token that has been revoked are indistinguishable from out
   * here, both rendering the same inactive page with no detail.
   */
  const resolved = await resolveToken("share", token);
  if (!resolved) return <Inactive />;

  return asAccount(resolved.account, async () => {
  const rows = await db.select().from(caregivers).where(eq(caregivers.id, resolved.subjectId ?? "")).limit(1);
  const cg = rows[0];
  // The permission is read from the patient's own database on every request, so narrowing the
  // scopes or revoking the link takes effect immediately rather than when a token expires.
  if (!cg || cg.status !== "active") return <Inactive />;

  await db.update(caregivers).set({ lastSeenAt: new Date() }).where(eq(caregivers.id, cg.id));

  const profile = await getProfile();
  const units = profile.units;
  const who = profile.name || "The person who shared this";
  const now = new Date();
  const since = addDays(startOfDay(now), -(DAYS - 1));

  const can = new Set(cg.canView.split(",").filter(Boolean) as CaregiverScope[]);
  const alertKinds = cg.alertKinds.split(",").filter(Boolean) as NudgeKind[];

  const [readings, mealRows, insulinRows, exRows, sleepRows, checkins, labRows, medRows, alerts] = await Promise.all([
    can.has("glucose")
      ? db.select().from(glucoseReadings).where(gte(glucoseReadings.at, since)).orderBy(desc(glucoseReadings.at))
      : Promise.resolve([]),
    can.has("meals") ? db.select().from(meals).where(gte(meals.at, since)).orderBy(desc(meals.at)) : Promise.resolve([]),
    can.has("insulin")
      ? db.select().from(insulinDoses).where(gte(insulinDoses.at, since)).orderBy(desc(insulinDoses.at))
      : Promise.resolve([]),
    can.has("activity")
      ? db.select().from(exerciseSessions).where(gte(exerciseSessions.at, since)).orderBy(desc(exerciseSessions.at))
      : Promise.resolve([]),
    can.has("sleep")
      ? db.select().from(sleepLogs).where(gte(sleepLogs.wakeDate, dateKey(since))).orderBy(desc(sleepLogs.wakeDate))
      : Promise.resolve([]),
    can.has("notes")
      ? db.select().from(wellbeingCheckins).where(gte(wellbeingCheckins.date, dateKey(since))).orderBy(desc(wellbeingCheckins.date))
      : Promise.resolve([]),
    can.has("labs")
      ? db.select().from(labResults).where(eq(labResults.verified, true)).orderBy(desc(labResults.at)).limit(12)
      : Promise.resolve([]),
    can.has("medications")
      ? db.select().from(medications).where(eq(medications.active, true)).orderBy(asc(medications.name))
      : Promise.resolve([]),
    alertKinds.length
      ? db
          .select({ id: nudges.id, kind: nudges.kind, title: nudges.title, href: nudges.href, createdAt: nudges.createdAt })
          .from(nudges)
          .where(isNull(nudges.dismissedAt))
          .orderBy(desc(nudges.createdAt))
          .limit(40)
      : Promise.resolve([]),
  ]);

  // Hydration is never its own scope; it rides along with activity so the page stays honest about
  // what was ticked rather than inventing a section.
  const water = can.has("activity")
    ? await db.select().from(hydrationLogs).where(and(gte(hydrationLogs.at, since)))
    : [];

  const stats = glucoseStats(readings, profile.targetLowMgdl, profile.targetHighMgdl);

  /**
   * ALERTS ARE SCOPED TOO, AND THEY CARRY NO FIGURES.
   *
   * This section used to be gated only on which alert KINDS the caregiver had ticked, and never on
   * `canView`. Alert bodies are written by the pattern engine and contain exact numbers, so a
   * caregiver scoped to sleep alone could read the patient's lowest glucose value and its date,
   * their dawn-phenomenon averages, their meal count and their time in range. That is invariant 9
   * broken: anything not scoped must not be queried at all.
   *
   * Two changes. An alert now requires the scope for the data it is about, derived from where it
   * links to. And only the title crosses the wire, never the body, because a title says "something
   * needs attention" without saying what the numbers are. The numbers stay behind the scopes where
   * the patient put them.
   */
  const scopeForAlert = (href: string | null): CaregiverScope | null => {
    if (!href) return null;
    if (href.startsWith("/trends") || href.startsWith("/log/glucose")) return "glucose";
    if (href.startsWith("/plan") || href.startsWith("/log/meal")) return "meals";
    if (href.startsWith("/log/insulin")) return "insulin";
    if (href.startsWith("/move") || href.startsWith("/log/water")) return "activity";
    if (href.startsWith("/log/sleep")) return "sleep";
    if (href.startsWith("/toolkit/labs")) return "labs";
    if (href.startsWith("/copilot")) return "notes";
    return null;
  };

  const shownAlerts = alerts.filter((n) => {
    if (!alertKinds.includes(n.kind)) return false;
    const needed = scopeForAlert(n.href);
    return needed === null || can.has(needed);
  });
  const notes = checkins.filter((c) => (c.unusual ?? "").trim() || (c.wantToDiscuss ?? "").trim());

  return (
    <div className="page">
      <header className="mb-6">
        <div className="eyebrow mb-1">Shared with {cg.name}</div>
        <h1>{who}&rsquo;s diabetes data</h1>
        <p className="lede mt-2 prose-measure">
          This page was shared with you on purpose, and only the sections {who} chose appear on it. They can turn this link
          off at any time. Nothing you see here is a medical record, and nothing on this page suggests a treatment or a dose.
        </p>
      </header>

      {shownAlerts.length > 0 ? (
        <section className="mb-6">
          <h2>Alerts</h2>
          <div className="grid gap-2 mt-2">
            {shownAlerts.map((n) => (
              <div key={n.id} className={`card p-3 ${n.kind === "safety" ? "sev-attention" : n.kind === "win" ? "sev-win" : "sev-info"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`pill ${n.kind === "safety" ? "pill-coral" : n.kind === "win" ? "pill-juniper" : ""}`}>
                    {NUDGE_LABEL[n.kind]}
                  </span>
                  <strong>{n.title}</strong>
                </div>
              </div>
            ))}
          </div>
          <p className="hint mt-2 prose-measure">
            Alerts say what needs attention, not what the numbers are. The figures behind them stay
            in the sections {who} chose to share.
          </p>
        </section>
      ) : null}

      <div className="grid gap-3">
        {can.has("glucose") ? (
          <Card>
            <h2>Glucose, last {DAYS} days</h2>
            {stats.n === 0 ? (
              <p className="muted mt-2">No readings logged in the last {DAYS} days.</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3 mt-3">
                  <div className="card-sunk p-3">
                    <div className="eyebrow">Time in range</div>
                    <div className="num text-2xl mt-1">{stats.timeInRange === null ? "—" : `${Math.round(stats.timeInRange)}%`}</div>
                    <div className="hint mt-1">
                      {formatGlucose(profile.targetLowMgdl, units)} to {formatGlucose(profile.targetHighMgdl, units)}{" "}
                      {unitLabel(units)}
                    </div>
                  </div>
                  <div className="card-sunk p-3">
                    <div className="eyebrow">Average</div>
                    <div className="num text-2xl mt-1">{stats.mean === null ? "—" : formatGlucose(stats.mean, units)}</div>
                    <div className="hint mt-1">{unitLabel(units)}</div>
                  </div>
                  <div className="card-sunk p-3">
                    <div className="eyebrow">Readings below range</div>
                    <div className="num text-2xl mt-1">{stats.lowsCount}</div>
                    <div className="hint mt-1">of {stats.n} readings, {stats.counts.very_low} under 54 mg/dL</div>
                  </div>
                </div>
                <div className="mt-3">
                  <TirBar pct={stats.pct} />
                </div>
                <h3 className="mt-4">The last {Math.min(20, readings.length)} readings</h3>
                <ul className="mt-2">
                  {readings.slice(0, 20).map((r) => (
                    <li key={r.id} className="divider py-2 first:border-t-0 flex items-baseline justify-between gap-3">
                      <span className="text-sm muted">
                        {fmtDay(r.at)} at {fmtTime(r.at)}
                      </span>
                      <span className="num">
                        {formatGlucose(r.valueMgdl, units)} <span className="text-sm muted">{unitLabel(units)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        ) : null}

        {can.has("meals") ? (
          <Card>
            <h2>Meals, last {DAYS} days</h2>
            {mealRows.length === 0 ? (
              <p className="muted mt-2">No meals logged in the last {DAYS} days.</p>
            ) : (
              <ul className="mt-2">
                {mealRows.map((m) => (
                  <li key={m.id} className="divider py-2 first:border-t-0 flex items-baseline justify-between gap-3">
                    <span>
                      {m.name}
                      <span className="hint ml-2">
                        {fmtDay(m.at)} at {fmtTime(m.at)}
                      </span>
                    </span>
                    <span className="num">{Math.round(m.carbsG)} g carbs</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {can.has("insulin") ? (
          <Card>
            <h2>Insulin, last {DAYS} days</h2>
            <p className="hint mt-1">These are the amounts that were recorded. Steady never suggests an amount.</p>
            {insulinRows.length === 0 ? (
              <p className="muted mt-2">No insulin entries in the last {DAYS} days.</p>
            ) : (
              <ul className="mt-2">
                {insulinRows.map((d) => (
                  <li key={d.id} className="divider py-2 first:border-t-0 flex items-baseline justify-between gap-3">
                    <span className="text-sm muted">
                      {fmtDay(d.at)} at {fmtTime(d.at)} · {d.kind}
                      {d.insulinName ? ` · ${d.insulinName}` : ""}
                    </span>
                    <span className="num">{d.units} units</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {can.has("activity") ? (
          <Card>
            <h2>Movement, last {DAYS} days</h2>
            {exRows.length === 0 ? (
              <p className="muted mt-2">No movement logged in the last {DAYS} days.</p>
            ) : (
              <ul className="mt-2">
                {exRows.map((e) => (
                  <li key={e.id} className="divider py-2 first:border-t-0 flex items-baseline justify-between gap-3">
                    <span>
                      {e.kind}
                      <span className="hint ml-2">{fmtDay(e.at)}</span>
                    </span>
                    <span className="num">
                      {e.minutes} min, {e.intensity}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {water.length > 0 ? (
              <p className="hint mt-3">
                Water logged over the same days: {water.reduce((a, h) => a + h.ml, 0)} ml.
              </p>
            ) : null}
          </Card>
        ) : null}

        {can.has("sleep") ? (
          <Card>
            <h2>Sleep, last {DAYS} nights</h2>
            {sleepRows.length === 0 ? (
              <p className="muted mt-2">No sleep logged in the last {DAYS} days.</p>
            ) : (
              <ul className="mt-2">
                {sleepRows.map((s) => (
                  <li key={s.id} className="divider py-2 first:border-t-0 flex items-baseline justify-between gap-3">
                    <span className="text-sm muted">Woke {s.wakeDate}</span>
                    <span className="num">
                      {(s.minutes / 60).toFixed(1)} h, quality {s.quality} of 5
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {can.has("notes") ? (
          <Card>
            <h2>Notes {who} wanted to pass on</h2>
            <p className="hint mt-1">
              Only the notes from the daily check-in appear here. The private journal is never shared.
            </p>
            {notes.length === 0 ? (
              <p className="muted mt-2">Nothing noted in the last {DAYS} days.</p>
            ) : (
              <ul className="mt-2">
                {notes.map((c) => (
                  <li key={c.id} className="divider py-2 first:border-t-0">
                    <div className="text-sm muted">{c.date}</div>
                    {c.unusual ? <p className="mt-1 prose-measure">{c.unusual}</p> : null}
                    {c.wantToDiscuss ? <p className="mt-1 prose-measure">Wants to discuss: {c.wantToDiscuss}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {can.has("labs") ? (
          <Card>
            <h2>Lab results</h2>
            <p className="hint mt-1">Shown with the laboratory&rsquo;s own reference range, where the lab printed one.</p>
            {labRows.length === 0 ? (
              <p className="muted mt-2">No lab results saved.</p>
            ) : (
              <ul className="mt-2">
                {labRows.map((l) => (
                  <li key={l.id} className="divider py-2 first:border-t-0 flex flex-wrap items-baseline justify-between gap-3">
                    <span>
                      {l.name}
                      <span className="hint ml-2">{fmtDay(l.at)}</span>
                    </span>
                    <span className="num">
                      {l.value}
                      {l.unit ? ` ${l.unit}` : ""}
                      <span className="hint ml-2">
                        {l.refLow !== null && l.refHigh !== null
                          ? `lab range ${l.refLow} to ${l.refHigh}`
                          : l.refHigh !== null
                            ? `lab range under ${l.refHigh}`
                            : l.refLow !== null
                              ? `lab range over ${l.refLow}`
                              : "no range supplied by the lab"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {can.has("medications") ? (
          <Card>
            <h2>Medications</h2>
            <p className="hint mt-1">As {who} entered them. Not checked against a pharmacy record.</p>
            {medRows.length === 0 ? (
              <p className="muted mt-2">None entered.</p>
            ) : (
              <ul className="mt-2">
                {medRows.map((m) => (
                  <li key={m.id} className="divider py-2 first:border-t-0">
                    <strong>{m.name}</strong>
                    {m.doseText ? <span className="muted"> {m.doseText}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>

      {cg.canComment ? (
        <Card className="mt-6">
          <h2>Leave a note for {who}</h2>
          <p className="text-sm muted mt-1 prose-measure">
            They will see this in their app. Keep it to encouragement or something practical. Decisions about medicines and
            doses belong to their care team.
          </p>
          <FormError message={error} />
          <FormNote message={note} />
          <form action={addComment} className="mt-3 grid gap-3">
            <input type="hidden" name="token" value={cg.token} />
            <div className="field">
              <label className="label" htmlFor="comment-body">
                Your note
              </label>
              <textarea id="comment-body" name="body" className="textarea" rows={3} required maxLength={1000} />
            </div>
            <div className="field md:max-w-xs">
              <label className="label" htmlFor="comment-date">
                About a particular day (optional)
              </label>
              <input id="comment-date" name="aboutDate" type="date" className="input" max={dateKey(now)} />
            </div>
            <div>
              <SubmitButton pendingText="Sending…">Send the note</SubmitButton>
            </div>
          </form>
        </Card>
      ) : null}

      <div className="mt-6">
        <Notice>
          You are seeing this because {who} chose to share it, and they can stop sharing at any time. This page is not a
          medical record, it is not complete, and it cannot tell you whether anything here is safe. If something worries you,
          the right next step is a conversation with {who} and their care team.
        </Notice>
      </div>
    </div>
  );
  });
}
