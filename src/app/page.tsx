import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import {
  db,
  glucoseReadings,
  meals,
  insulinDoses,
  exerciseSessions,
  hydrationLogs,
  sleepLogs,
  wellbeingCheckins,
  appointments,
} from "@/lib/db";
import { HeroVideo } from "@/components/HeroVideo";
import { Card, Stat, GlucoseChip, TirBar, Notice, EmptyState, PatternCard, TriageBanner } from "@/components/ui";
import { requireAccount } from "@/lib/auth/session";
import { getProfile, usesInsulin, loadSnapshot } from "@/lib/data/snapshot";
import { refreshDerived, inbox } from "@/lib/data/nudges";
import { glucoseStats, between } from "@/lib/engines/stats";
import { formatGlucose, unitLabel, bandOf, BAND_LABEL } from "@/lib/units";
import { startOfDay, endOfDay, addDays, dateKey, fmtTime, fmtDayLong, relative } from "@/lib/time";
import { runTriage } from "./copilot/actions";

export const dynamic = "force-dynamic";

function greeting(now: Date, name: string): string {
  const h = now.getHours();
  const part = h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}

export default async function Today() {
  return requireAccount(async () => {
  const profile = await getProfile();
  if (!profile.onboarded) redirect("/welcome");

  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = endOfDay(now);

  // Engines first: this refreshes nudges, doctor questions and memory. Idempotent.
  const report = await refreshDerived(now);

  const [readingsToday, mealsToday, insulinToday, exToday, waterToday, lastNight, checkin, nextAppt, nudgeList, snap14, triageNow] = await Promise.all([
    db.select().from(glucoseReadings).where(and(gte(glucoseReadings.at, today), lt(glucoseReadings.at, tomorrow))).orderBy(desc(glucoseReadings.at)),
    db.select().from(meals).where(and(gte(meals.at, today), lt(meals.at, tomorrow))).orderBy(desc(meals.at)),
    db.select().from(insulinDoses).where(and(gte(insulinDoses.at, today), lt(insulinDoses.at, tomorrow))).orderBy(desc(insulinDoses.at)),
    db.select().from(exerciseSessions).where(and(gte(exerciseSessions.at, today), lt(exerciseSessions.at, tomorrow))),
    db.select().from(hydrationLogs).where(and(gte(hydrationLogs.at, today), lt(hydrationLogs.at, tomorrow))),
    db.select().from(sleepLogs).where(eq(sleepLogs.wakeDate, dateKey(now))).limit(1),
    db.select().from(wellbeingCheckins).where(eq(wellbeingCheckins.date, dateKey(now))).limit(1),
    db.select().from(appointments).where(gte(appointments.at, today)).orderBy(appointments.at).limit(1),
    inbox(6),
    loadSnapshot(14, now, profile),
    runTriage({}),
  ]);

  const latest = readingsToday[0] ?? null;
  const todayStats = glucoseStats(readingsToday, profile.targetLowMgdl, profile.targetHighMgdl);
  const stats7 = glucoseStats(between(snap14.readings, addDays(today, -6), tomorrow), profile.targetLowMgdl, profile.targetHighMgdl);
  const water = waterToday.reduce((a, h) => a + h.ml, 0);
  const carbs = Math.round(mealsToday.reduce((a, m) => a + m.carbsG, 0));
  const units = insulinToday.reduce((a, d) => a + d.units, 0);
  const exMinutes = exToday.reduce((a, e) => a + e.minutes, 0);
  const u = profile.units;
  const hasAnyData = snap14.readings.length > 0 || snap14.meals.length > 0;

  const safety = nudgeList.filter((n) => n.kind === "safety");
  const gaps = nudgeList.filter((n) => n.kind === "gap" || n.kind === "reminder");
  const wins = nudgeList.filter((n) => n.kind === "win");

  return (
    <div className="page">
      <div className="-mx-4 -mt-5 mb-6 md:-mx-8 md:-mt-8">
        {/*
          The morning plate is cut from longer footage that opens on three seconds of near-black and
          carries a title card burnt into the middle of the frame. Neither is re-encoded: the window
          skips the dark head, the zoom crops below the title and the face, and the slow rate turns
          a 1.7 second window into a loop that reads as drift.
        */}
        <HeroVideo
          name="morning"
          height="h-[34vh] min-h-[13rem] max-h-[20rem]"
          start={3.3}
          end={4.98}
          rate={0.55}
          zoom={2.05}
        >
          <div className="eyebrow on-film">{fmtDayLong(now)}</div>
          <h1 className="on-film mt-1">{greeting(now, profile.name)}</h1>
          <div className="flex flex-wrap gap-2 mt-4">
            <Link href="/log/glucose" className="btn">
              Log a reading
            </Link>
            <Link href="/copilot" className="btn btn-slate">
              Talk to the Copilot
            </Link>
          </div>
        </HeroVideo>
      </div>

      {triageNow.level !== "general" ? (
        <div className="mb-5">
          <TriageBanner t={triageNow} />
        </div>
      ) : null}

      {/* ---------------- the number, big ---------------- */}
      <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
        <Card className="rise rise-1">
          <div className="eyebrow">Latest reading</div>
          {latest ? (
            <>
              <div className={`big-num breathing inline-block mt-1 band-${bandOf(latest.valueMgdl, profile.targetLowMgdl, profile.targetHighMgdl)}`}>
                {formatGlucose(latest.valueMgdl, u)}
                <span className="text-base font-body muted ml-2">{unitLabel(u)}</span>
              </div>
              <div className="mt-1">
                <span className={`pill chip-${bandOf(latest.valueMgdl, profile.targetLowMgdl, profile.targetHighMgdl)}`}>
                  {BAND_LABEL[bandOf(latest.valueMgdl, profile.targetLowMgdl, profile.targetHighMgdl)]}
                </span>
                <span className="hint ml-2">
                  {fmtTime(latest.at)}, {relative(latest.at, now)}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="big-num mt-1 faint">—</div>
              <p className="muted text-sm mt-1">
                Nothing logged yet today.{" "}
                <Link href="/log/glucose" className="underline">
                  Add one
                </Link>
                .
              </p>
            </>
          )}
          <div className="divider my-4" />
          <div className="eyebrow mb-2">Today, {todayStats.n} reading{todayStats.n === 1 ? "" : "s"}</div>
          {todayStats.n > 0 ? (
            <>
              <TirBar pct={todayStats.pct} />
              <div className="hint mt-2">
                {todayStats.timeInRange?.toFixed(0)}% in your range of {formatGlucose(profile.targetLowMgdl, u)} to {formatGlucose(profile.targetHighMgdl, u)} {unitLabel(u)}
                {todayStats.mean !== null ? ` · average ${formatGlucose(todayStats.mean, u)}` : ""}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {readingsToday.slice(0, 12).map((r) => (
                  <span key={r.id} className="flex items-center gap-1 text-xs">
                    <GlucoseChip mgdl={r.valueMgdl} units={u} low={profile.targetLowMgdl} high={profile.targetHighMgdl} showUnit={false} />
                    <span className="faint">{fmtTime(r.at)}</span>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="hint">Your day fills in here as you log.</p>
          )}
        </Card>

        <div className="grid gap-4 rise rise-2">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Carbs today" value={carbs} unit="g" sub={mealsToday.length ? `${mealsToday.length} meal${mealsToday.length === 1 ? "" : "s"}` : "nothing logged"} />
            {usesInsulin(profile) ? (
              <Stat label="Insulin today" value={Math.round(units * 10) / 10} unit="u" sub={insulinToday.length ? `${insulinToday.length} entr${insulinToday.length === 1 ? "y" : "ies"}` : "nothing logged"} />
            ) : (
              <Stat label="Movement" value={exMinutes} unit="min" sub={exToday.length ? `${exToday.length} session${exToday.length === 1 ? "" : "s"}` : "nothing logged"} />
            )}
            <Stat label="Water" value={water} unit="ml" sub={`of ${profile.hydrationGoalMl} goal`} />
            <Stat label="Sleep" value={lastNight[0] ? (lastNight[0].minutes / 60).toFixed(1) : "—"} unit={lastNight[0] ? "h" : undefined} sub={lastNight[0] ? `quality ${lastNight[0].quality} of 5` : "not logged"} />
          </div>

          <Card>
            <div className="eyebrow mb-2">Last 7 days</div>
            {stats7.n >= 10 ? (
              <>
                <TirBar pct={stats7.pct} />
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div>
                    <div className="num text-xl font-display">{stats7.timeInRange?.toFixed(0)}%</div>
                    <div className="hint">in range</div>
                  </div>
                  <div>
                    <div className="num text-xl font-display">{formatGlucose(stats7.mean!, u)}</div>
                    <div className="hint">average {unitLabel(u)}</div>
                  </div>
                  <div>
                    <div className={`num text-xl font-display ${stats7.lowsCount > 0 ? "band-low" : ""}`}>{stats7.lowsCount}</div>
                    <div className="hint">low readings</div>
                  </div>
                </div>
                <Link href="/trends" className="btn btn-secondary btn-sm mt-4">
                  See the trends
                </Link>
              </>
            ) : (
              <p className="muted text-sm">
                {stats7.n === 0 ? "No readings in the last week yet." : `Only ${stats7.n} readings this week, which is not enough to compare anything honestly.`} Keep logging and this fills in.
              </p>
            )}
          </Card>

          <div className="grid gap-3 sm:grid-cols-2">
            {!checkin[0] ? (
              <Link href="/copilot/checkin" className="card p-4 hover:shadow-[var(--shadow-lift)] transition-shadow">
                <h3>Daily check-in</h3>
                <p className="hint mt-1">Three questions about how today felt.</p>
              </Link>
            ) : (
              <Card>
                <div className="eyebrow">Check-in done</div>
                <p className="text-sm mt-1">Feeling {checkin[0].feeling} of 5{checkin[0].unusual ? `. You noted: "${checkin[0].unusual}"` : "."}</p>
              </Card>
            )}
            <Link href="/review" className="card p-4 hover:shadow-[var(--shadow-lift)] transition-shadow">
              <h3>This week&apos;s review</h3>
              <p className="hint mt-1">Your numbers and your food, side by side with last week.</p>
            </Link>
          </div>
        </div>
      </div>

      {/* ---------------- notifications ---------------- */}
      {safety.length ? (
        <>
          <h2 className="mt-8 mb-3">Needs your attention</h2>
          <div className="grid gap-3">
            {safety.map((n) => (
              <Card key={n.id} className="sev-attention">
                <h3>{n.title}</h3>
                <p className="text-sm mt-1">{n.body}</p>
                {n.href ? (
                  <Link href={n.href} className="btn btn-secondary btn-sm mt-3">
                    Look at this
                  </Link>
                ) : null}
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {/* ---------------- patterns ---------------- */}
      <div className="flex items-end justify-between gap-3 mt-8 mb-3">
        <h2>What your data is showing</h2>
        <Link href="/toolkit/inbox" className="btn btn-ghost btn-sm">
          All notifications
        </Link>
      </div>
      {!hasAnyData ? (
        <EmptyState
          title="Nothing to show yet, and that is fine"
          body="Steady only ever tells you things it can prove from your own logs. Log a reading and a meal, and the first patterns appear within a few days."
          cta="Log your first reading"
          href="/log/glucose"
        />
      ) : report.patterns.length === 0 ? (
        <Card>
          <p className="muted">
            {report.sampleNote ?? "No patterns stand out in the last 14 days. That is a real answer, not an empty one."}
          </p>
        </Card>
      ) : (
        <>
          {report.sampleNote ? (
            <div className="mb-3">
              <Notice tone="amber">{report.sampleNote}</Notice>
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            {report.patterns.slice(0, 6).map((p) => (
              <PatternCard key={p.key} p={p} units={u} />
            ))}
          </div>
        </>
      )}

      {/* ---------------- small things ---------------- */}
      {(gaps.length || wins.length) ? (
        <div className="grid gap-3 md:grid-cols-2 mt-6">
          {wins.length ? (
            <Card>
              <div className="eyebrow mb-2">Worth noticing</div>
              <ul className="grid gap-2">
                {wins.map((n) => (
                  <li key={n.id} className="text-sm">
                    <strong>{n.title}.</strong> {n.body}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {gaps.length ? (
            <Card>
              <div className="eyebrow mb-2">Small gaps</div>
              <ul className="grid gap-2">
                {gaps.map((n) => (
                  <li key={n.id} className="text-sm">
                    {n.href ? (
                      <Link href={n.href} className="underline">
                        {n.title}
                      </Link>
                    ) : (
                      <strong>{n.title}</strong>
                    )}
                    . {n.body}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : null}

      {nextAppt[0] ? (
        <div className="mt-6">
          <Notice tone="juniper">
            {fmtDayLong(nextAppt[0].at)} with {nextAppt[0].withWhom || "your care team"}.{" "}
            <Link href="/toolkit/appointments" className="underline">
              Build your brief
            </Link>{" "}
            so nothing gets forgotten in the room.
          </Notice>
        </div>
      ) : null}

      <p className="hint mt-8 prose-measure">
        Steady is not a medical device and does not diagnose. It never suggests or changes a medication or insulin dose. Everything above is computed from what you logged.
      </p>
    </div>
  );
  });
}
