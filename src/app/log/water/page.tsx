import { and, asc, desc, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { db, hydrationLogs } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { fail, parseForm, zNum } from "@/lib/actions";
import { getProfile } from "@/lib/data/snapshot";
import { addDays, dateKey, endOfDay, fmtDay, fmtTime, parseDateKey, startOfDay } from "@/lib/time";
import { newId } from "@/lib/ids";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { ActionForm, DeleteButton } from "../ActionForm";
import { deleteHydration } from "../actions";
import { revalidateLog } from "../revalidate";
import { group } from "../labels";
import type { LogResult } from "../types";

const ML_PER_FL_OZ = 1 / 0.033814;

const Form = z.object({ ml: zNum(1, 5000) });

async function addWater(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  "use server";
  return requireAccount(async () => {
  const parsed = parseForm(Form, fd);
  if ("error" in parsed) return fail(parsed.error);
  const ml = Math.round(parsed.data.ml);
  const now = new Date();
  try {
    await db.insert(hydrationLogs).values({ id: newId(), at: now, ml, createdAt: now });
  } catch {
    return fail("Could not add that. Please try again.");
  }
  revalidateLog("/log/water", "/trends");
  return { ok: true, message: `Added ${group(ml)} ml at ${fmtTime(now)}.` };
  });
}

export default async function LogWaterPage() {
  return requireAccount(async () => {
  const profile = await getProfile();
  const now = new Date();
  const today = startOfDay(now);
  const weekFrom = addDays(today, -6);

  const [todayRows, weekRows] = await Promise.all([
    db
      .select()
      .from(hydrationLogs)
      .where(and(gte(hydrationLogs.at, today), lt(hydrationLogs.at, endOfDay(now))))
      .orderBy(desc(hydrationLogs.at)),
    db.select().from(hydrationLogs).where(gte(hydrationLogs.at, weekFrom)).orderBy(asc(hydrationLogs.at)),
  ]);

  const totalMl = todayRows.reduce((a, r) => a + r.ml, 0);
  const goal = Math.max(1, profile.hydrationGoalMl);
  const pct = Math.min(1, totalMl / goal);

  const dayTotals = new Map<string, number>();
  for (const r of weekRows) {
    const k = dateKey(r.at);
    dayTotals.set(k, (dayTotals.get(k) ?? 0) + r.ml);
  }
  const weekKeys: string[] = [];
  for (let i = 6; i >= 0; i--) weekKeys.push(dateKey(addDays(today, -i)));
  const weekMax = Math.max(goal, ...weekKeys.map((k) => dayTotals.get(k) ?? 0));

  const R = 54;
  const C = 2 * Math.PI * R;

  const BAR = 26;
  const GAP = 10;
  const CHART_H = 80;
  const W = weekKeys.length * (BAR + GAP);

  return (
    <div className="page">
      <PageHeader eyebrow="Log" title="Water" lede="Tap what you drank. Each one saves straight away." />

      <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-start">
        <Card>
          <div className="flex flex-col items-center">
            <svg
              viewBox="0 0 140 140"
              width={160}
              height={160}
              role="img"
              aria-label={`${group(totalMl)} millilitres of water today, out of a goal of ${group(goal)} millilitres. That is ${Math.round(pct * 100)} percent of the goal.`}
            >
              <circle cx={70} cy={70} r={R} fill="none" stroke="var(--paper-sunk)" strokeWidth={14} />
              <circle
                cx={70}
                cy={70}
                r={R}
                fill="none"
                stroke="var(--ink-soft)"
                strokeWidth={14}
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - pct)}
                transform="rotate(-90 70 70)"
              />
              <text x={70} y={68} textAnchor="middle" fontSize="22" fill="var(--ink)" className="num">
                {group(totalMl)}
              </text>
              <text x={70} y={86} textAnchor="middle" fontSize="11" fill="var(--ink-faint)">
                of {group(goal)} ml
              </text>
            </svg>
            <p className="mt-2 text-sm muted num">
              {Math.round(pct * 100)}% of today&rsquo;s goal
            </p>
            {profile.units === "mgdl" ? (
              <p className="hint num">
                {(totalMl / ML_PER_FL_OZ).toFixed(1)} fl oz of {(goal / ML_PER_FL_OZ).toFixed(1)} fl oz
              </p>
            ) : null}
          </div>
        </Card>

        <div className="grid gap-4">
          <Card>
            <div className="eyebrow mb-3">Quick add</div>
            <ActionForm action={addWater} className="grid gap-3" pendingText="Adding…">
              <div className="flex flex-wrap gap-2">
                <button type="submit" name="ml" value="250" className="btn btn-lg">
                  +250 ml glass
                </button>
                <button type="submit" name="ml" value="500" className="btn btn-lg">
                  +500 ml bottle
                </button>
                <button type="submit" name="ml" value="750" className="btn btn-lg">
                  +750 ml
                </button>
              </div>
            </ActionForm>
          </Card>

          <Card>
            <ActionForm action={addWater} className="grid gap-3" pendingText="Adding…">
              <div className="field">
                <label className="label" htmlFor="ml">
                  Some other amount, in ml
                </label>
                <input id="ml" name="ml" className="input num" inputMode="numeric" step="10" min={1} max={5000} placeholder="330" required />
              </div>
              <div>
                <SubmitButton>Add it</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-3">Today</h2>
        {todayRows.length === 0 ? (
          <EmptyState title="Nothing yet today" body="Tap one of the buttons above and it will appear here." />
        ) : (
          <ul className="card divide-y">
            {todayRows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 p-3 md:p-4">
                <div className="w-20 shrink-0 num text-sm">{fmtTime(r.at)}</div>
                <div className="min-w-0 flex-1 num">{group(r.ml)} ml</div>
                <DeleteButton action={deleteHydration} id={r.id} what="water entry" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3">The last seven days</h2>
        <Card>
          <div className="overflow-x-auto">
            <svg
              viewBox={`0 0 ${W} ${CHART_H + 34}`}
              width={W}
              height={CHART_H + 34}
              role="img"
              aria-label={`Water each day over the last seven days. ${weekKeys
                .map((k) => `${fmtDay(parseDateKey(k))}: ${group(dayTotals.get(k) ?? 0)} millilitres`)
                .join(", ")}.`}
            >
              <line
                x1={0}
                y1={CHART_H - (goal / weekMax) * CHART_H}
                x2={W}
                y2={CHART_H - (goal / weekMax) * CHART_H}
                stroke="var(--line-strong)"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              {weekKeys.map((k, i) => {
                const ml = dayTotals.get(k) ?? 0;
                const h = (ml / weekMax) * CHART_H;
                const x = i * (BAR + GAP);
                return (
                  <g key={k}>
                    <rect x={x} y={CHART_H - Math.max(h, ml > 0 ? 1 : 0)} width={BAR} height={Math.max(h, ml > 0 ? 1 : 0)} rx={4} fill="var(--ink-soft)" />
                    <text x={x + BAR / 2} y={CHART_H + 16} textAnchor="middle" fontSize="9" fill="var(--ink-faint)">
                      {parseDateKey(k).toLocaleDateString([], { weekday: "narrow" })}
                    </text>
                    <text x={x + BAR / 2} y={CHART_H + 28} textAnchor="middle" fontSize="8" fill="var(--ink-faint)">
                      {ml > 0 ? group(ml) : "0"}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <p className="hint mt-2">The dashed line is your goal of {group(goal)} ml a day. You can change it in Settings.</p>
        </Card>
      </section>
    </div>
  );
  });
}
