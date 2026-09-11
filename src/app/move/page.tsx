/**
 * Move: exercise inspiration, and a record of what was actually done.
 *
 * The ideas come from the `exercise_ideas` table, so the screen is empty and honest about it until
 * the seed has run. Nothing on this screen reads a glucose value or suggests a medication change;
 * activity is logged, never prescribed.
 */
import Link from "next/link";
import { and, desc, gte, lt } from "drizzle-orm";
import { db, exerciseIdeas, exerciseSessions, EXERCISE_INTENSITIES } from "@/lib/db";
import { addDays, endOfDay, fmtDay, fmtTime, startOfDay } from "@/lib/time";
import { PageHeader, Card, Stat, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { requireAccount } from "@/lib/auth/session";
import { deleteSession, logCustomSession, logIdeaSession } from "./actions";
import {
  MOVE_CHIPS,
  WEEKLY_MINUTES_GUIDELINE,
  chipFor,
  firstParam,
  intensityLabel,
  intensityPill,
  num,
  tagLabel,
  tagList,
} from "./lib";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function MovePage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const tagParam = firstParam(sp.tag);
  const error = firstParam(sp.error);
  const chip = chipFor(tagParam);
  return requireAccount(async () => {

  const now = new Date();
  const weekFrom = addDays(startOfDay(now), -6);
  const weekTo = endOfDay(now);

  const [ideas, weekSessions, recent] = await Promise.all([
    db.select().from(exerciseIdeas),
    db
      .select()
      .from(exerciseSessions)
      .where(and(gte(exerciseSessions.at, weekFrom), lt(exerciseSessions.at, weekTo))),
    db.select().from(exerciseSessions).orderBy(desc(exerciseSessions.at)).limit(10),
  ]);

  const shown = chip.match ? ideas.filter((i) => chip.match!(i)) : ideas;

  const weekMinutes = weekSessions.reduce((a, s) => a + (Number.isFinite(s.minutes) ? s.minutes : 0), 0);
  const weekCount = weekSessions.length;
  const pct = Math.min(100, Math.round((weekMinutes / WEEKLY_MINUTES_GUIDELINE) * 100));
  const remaining = Math.max(0, WEEKLY_MINUTES_GUIDELINE - weekMinutes);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Move"
        title="Something to do today"
        lede="Short, specific things, sorted by what you have room for right now. Pick one, or log whatever you already did."
      />

      <div className="mb-5">
        <Notice>
          Movement can lower your glucose for hours after you stop, not only while you are moving. If you use insulin
          or a sulfonylurea, carry fast-acting carbs when you move, check before and after when you can, and talk with
          your care team about how activity fits your routine.
        </Notice>
      </div>

      {error ? (
        <div className="mb-4">
          <Notice tone="amber">{error}</Notice>
        </div>
      ) : null}

      {/* ---------------------------- this week so far ---------------------------- */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-display">This week so far</h2>
          <span className="hint">
            {fmtDay(weekFrom)} to {fmtDay(now)}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
          <Stat label="Minutes" value={num(weekMinutes)} unit="min" sub={`of the ${WEEKLY_MINUTES_GUIDELINE} minute guideline`} />
          <Stat label="Sessions" value={weekCount} sub="logged in the last 7 days" />
          <Stat
            label="Left to reach it"
            value={num(remaining)}
            unit="min"
            sub={remaining === 0 ? "you are there" : "if you want to"}
          />
        </div>

        <div className="mt-4">
          <svg
            viewBox="0 0 300 16"
            preserveAspectRatio="none"
            className="w-full"
            style={{ height: 16 }}
            role="img"
            aria-label={`${weekMinutes} minutes of movement logged in the last 7 days across ${weekCount} session${weekCount === 1 ? "" : "s"}, against a guideline of ${WEEKLY_MINUTES_GUIDELINE} minutes a week. That is ${pct} percent of the guideline.`}
          >
            <rect x="0" y="0" width="300" height="16" rx="8" fill="var(--paper-sunk)" />
            {pct > 0 ? <rect x="0" y="0" width={(pct / 100) * 300} height="16" rx="8" fill="var(--juniper)" /> : null}
          </svg>
          <p className="hint mt-1 num">
            {num(weekMinutes)} of {WEEKLY_MINUTES_GUIDELINE} minutes, {pct}% of the weekly guideline
          </p>
        </div>

        <p className="hint mt-3 prose-measure">
          The 150 minute figure is the general adult activity guideline, not a target someone set for you. Any amount
          counts and the bar is here to show the shape of your week, not to score it.
        </p>
      </Card>

      {/* ------------------------------- the chips ------------------------------- */}
      <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Filter exercise ideas">
        {MOVE_CHIPS.map((c) => {
          const active = c.key === chip.key;
          return (
            <Link
              key={c.key}
              href={c.key === "all" ? "/move" : `/move?tag=${c.key}`}
              className={`pill ${active ? "pill-juniper" : ""}`}
              aria-current={active ? "true" : undefined}
            >
              {c.label}
            </Link>
          );
        })}
      </div>

      {/* -------------------------------- the ideas ------------------------------- */}
      {ideas.length === 0 ? (
        <EmptyState
          title="No exercise ideas loaded yet"
          body="The inspiration list has not been written to the database. Run npm run setup in the project folder, then come back."
        />
      ) : shown.length === 0 ? (
        <EmptyState
          title="Nothing in the list matches that yet"
          body="The ideas loaded here are not tagged for that situation. Have a look at everything instead."
          cta="Show all ideas"
          href="/move"
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 mb-6">
          {shown.map((idea) => (
            <article key={idea.id} className="card p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="leading-tight">{idea.title}</h3>
                <span className={`${intensityPill(idea.intensity)} shrink-0`}>{intensityLabel(idea.intensity)}</span>
              </div>

              <div className="hint">
                <span className="num">{num(idea.minutes)} min</span>
                {idea.kind ? ` · ${idea.kind.replace(/[-_]/g, " ")}` : ""}
              </div>

              {tagList(idea.tags).length ? (
                <div className="flex flex-wrap gap-1.5">
                  {tagList(idea.tags).map((t) => (
                    <span key={t} className="pill">
                      {tagLabel(t)}
                    </span>
                  ))}
                </div>
              ) : null}

              {idea.body ? <p className="text-sm">{idea.body}</p> : null}

              {idea.glucoseNote ? <Notice>{idea.glucoseNote}</Notice> : null}

              <form action={logIdeaSession} className="mt-auto pt-1">
                <input type="hidden" name="ideaId" value={idea.id} />
                {chip.key !== "all" ? <input type="hidden" name="tag" value={chip.key} /> : null}
                <SubmitButton className="btn btn-juniper" pendingText="Logging…">
                  I did this
                </SubmitButton>
              </form>
            </article>
          ))}
        </div>
      )}

      {/* ---------------------------- log something else --------------------------- */}
      <Card className="mb-5">
        <h2 className="text-base font-display">Log something else</h2>
        <p className="muted text-sm mt-1">Anything that is not on the list. Recorded exactly as you describe it.</p>
        <form action={logCustomSession} className="grid gap-3 sm:grid-cols-4 mt-3 items-end">
          <div className="field sm:col-span-2">
            <label className="label" htmlFor="m-kind">
              What did you do
            </label>
            <input id="m-kind" name="kind" className="input" maxLength={60} required placeholder="Walked the dog" />
          </div>
          <div className="field">
            <label className="label" htmlFor="m-minutes">
              Minutes
            </label>
            <input
              id="m-minutes"
              name="minutes"
              type="number"
              min={1}
              max={600}
              step={5}
              className="input"
              required
              defaultValue={20}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="m-intensity">
              How hard
            </label>
            <select id="m-intensity" name="intensity" className="select" defaultValue="moderate">
              {EXERCISE_INTENSITIES.map((i) => (
                <option key={i} value={i}>
                  {intensityLabel(i)}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4">
            <SubmitButton className="btn" pendingText="Saving…">
              Log it
            </SubmitButton>
          </div>
        </form>
      </Card>

      {/* ------------------------------ recent sessions ----------------------------- */}
      <Card>
        <h2 className="text-base font-display">Last logged</h2>
        {recent.length === 0 ? (
          <p className="muted text-sm mt-2">Nothing logged yet. The first entry can be a ten minute walk.</p>
        ) : (
          <ul className="grid gap-1 mt-3">
            {recent.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-1 divider first:border-t-0 pt-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    {s.kind ? s.kind.replace(/[-_]/g, " ") : "Movement"}
                    <span className="muted num"> · {num(s.minutes)} min</span>
                  </div>
                  <div className="hint">
                    {fmtDay(s.at)} at {fmtTime(s.at)} · {intensityLabel(s.intensity)}
                    {s.note ? ` · ${s.note}` : ""}
                  </div>
                </div>
                <form action={deleteSession} className="shrink-0">
                  <input type="hidden" name="id" value={s.id} />
                  <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">
                    <span aria-hidden="true">×</span>
                    <span className="sr-only">{`Delete ${s.kind || "session"} on ${fmtDay(s.at)}`}</span>
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
  });
}
