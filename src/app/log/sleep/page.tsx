import { desc, gte } from "drizzle-orm";
import { z } from "zod";
import { db, sleepLogs } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { fail, parseForm, zLocalDateTime, zNum, zOptStr } from "@/lib/actions";
import { getProfile } from "@/lib/data/snapshot";
import { addDays, dateKey, fmtDay, fmtTime, parseDateKey, startOfDay, toDateTimeInput } from "@/lib/time";
import { newId } from "@/lib/ids";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { ActionForm, DeleteButton } from "../ActionForm";
import { deleteSleep } from "../actions";
import { revalidateLog } from "../revalidate";
import { QUALITY_LABEL } from "../labels";
import type { LogResult } from "../types";

const Form = z.object({
  bedAt: zLocalDateTime,
  wakeAt: zLocalDateTime,
  quality: zNum(1, 5),
  note: zOptStr(300),
});

async function logSleep(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  "use server";
  return requireAccount(async () => {
  const parsed = parseForm(Form, fd);
  if ("error" in parsed) return fail(parsed.error);
  const { bedAt, wakeAt, quality, note } = parsed.data;

  const minutes = Math.round((wakeAt.getTime() - bedAt.getTime()) / 60000);
  if (minutes <= 0) return fail("Wake time needs to be after bed time. If you went to bed before midnight, the bed date is yesterday.");
  if (minutes > 24 * 60) return fail("That is more than a day apart. Check the two dates.");

  const wakeDate = dateKey(wakeAt);
  const now = new Date();
  try {
    await db
      .insert(sleepLogs)
      .values({ id: newId(), wakeDate, bedAt, wakeAt, minutes, quality: Math.round(quality), note, createdAt: now })
      .onConflictDoUpdate({
        target: sleepLogs.wakeDate,
        set: { bedAt, wakeAt, minutes, quality: Math.round(quality), note },
      });
  } catch {
    return fail("Could not save that night. Please try again.");
  }

  revalidateLog("/log/sleep", "/trends", "/review");
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return {
    ok: true,
    message: `Saved ${h} h ${String(m).padStart(2, "0")} for the morning of ${fmtDay(wakeAt)}.`,
    detail: "One night per morning, so saving again just updates it.",
  };
  });
}

export default async function LogSleepPage() {
  return requireAccount(async () => {
  const profile = await getProfile();
  const now = new Date();

  const bedDefault = addDays(startOfDay(now), -1);
  bedDefault.setHours(23, 0, 0, 0);
  const wakeDefault = startOfDay(now);
  wakeDefault.setHours(7, 0, 0, 0);

  const since = dateKey(addDays(startOfDay(now), -13));
  const nights = await db.select().from(sleepLogs).where(gte(sleepLogs.wakeDate, since)).orderBy(desc(sleepLogs.wakeDate));

  const byDate = new Map(nights.map((n) => [n.wakeDate, n]));
  const keys: string[] = [];
  for (let i = 13; i >= 0; i--) keys.push(dateKey(addDays(startOfDay(now), -i)));

  const goalH = profile.sleepGoalMinutes / 60;
  const maxH = Math.max(10, goalH + 1, ...nights.map((n) => n.minutes / 60));

  const BAR = 22;
  const GAP = 8;
  const CHART_H = 110;
  const W = keys.length * (BAR + GAP);
  const goalY = CHART_H - (goalH / maxH) * CHART_H;

  const label = keys
    .map((k) => {
      const n = byDate.get(k);
      return `${fmtDay(parseDateKey(k))}: ${n ? `${(n.minutes / 60).toFixed(1)} hours` : "not logged"}`;
    })
    .join(", ");

  return (
    <div className="page">
      <PageHeader
        eyebrow="Log"
        title="Sleep"
        lede="One entry per morning. If you went to bed before midnight, the bed date is the day before."
      />

      <Card>
        <ActionForm action={logSleep} pendingText="Saving the night…">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="field">
              <label className="label" htmlFor="bedAt">
                Went to bed
              </label>
              <input id="bedAt" name="bedAt" type="datetime-local" className="input" defaultValue={toDateTimeInput(bedDefault)} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="wakeAt">
                Woke up
              </label>
              <input id="wakeAt" name="wakeAt" type="datetime-local" className="input" defaultValue={toDateTimeInput(wakeDefault)} required />
            </div>
          </div>

          <fieldset className="field">
            <legend className="label">How was it</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((q) => (
                <label key={q} className="pill cursor-pointer">
                  <input type="radio" name="quality" value={q} defaultChecked={q === 3} /> {QUALITY_LABEL[q]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="field">
            <label className="label" htmlFor="note">
              Note
            </label>
            <input id="note" name="note" className="input" maxLength={300} placeholder="Woke twice" />
          </div>

          <div>
            <SubmitButton className="btn btn-lg">Save the night</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <section className="mt-8">
        <h2 className="mb-1">The last fourteen nights</h2>
        <p className="lede mb-3 prose-measure">Hours slept, with your goal of {goalH.toFixed(1)} hours marked.</p>

        <Card>
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${CHART_H + 34}`} width={W} height={CHART_H + 34} role="img" aria-label={`Hours slept over the last fourteen nights. ${label}.`}>
              <line x1={0} y1={goalY} x2={W} y2={goalY} stroke="var(--line-strong)" strokeDasharray="3 3" strokeWidth={1} />
              {keys.map((k, i) => {
                const n = byDate.get(k);
                const hours = n ? n.minutes / 60 : 0;
                const h = (hours / maxH) * CHART_H;
                const x = i * (BAR + GAP);
                return (
                  <g key={k}>
                    {n ? (
                      <>
                        <rect x={x} y={CHART_H - h} width={BAR} height={Math.max(h, 1)} rx={4} fill="var(--ink-soft)" />
                        <text x={x + BAR / 2} y={CHART_H - h - 4} textAnchor="middle" fontSize="9" fill="var(--ink-faint)">
                          {hours.toFixed(1)}
                        </text>
                      </>
                    ) : (
                      <rect x={x} y={CHART_H - 2} width={BAR} height={2} rx={1} fill="var(--line)" />
                    )}
                    <text x={x + BAR / 2} y={CHART_H + 16} textAnchor="middle" fontSize="9" fill="var(--ink-faint)">
                      {parseDateKey(k).toLocaleDateString([], { weekday: "narrow" })}
                    </text>
                    <text x={x + BAR / 2} y={CHART_H + 28} textAnchor="middle" fontSize="8" fill="var(--ink-faint)">
                      {parseDateKey(k).getDate()}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </Card>

        <div className="mt-4">
          {nights.length === 0 ? (
            <EmptyState title="No nights logged yet" body="Save one above and it will show up in the chart and the list." />
          ) : (
            <ul className="card divide-y">
              {nights.map((n) => (
                <li key={n.id} className="flex items-center gap-3 p-3 md:p-4">
                  <div className="w-28 shrink-0">
                    <div className="text-sm">{fmtDay(parseDateKey(n.wakeDate))}</div>
                    <div className="hint num">
                      {fmtTime(n.bedAt)} to {fmtTime(n.wakeAt)}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num font-semibold">{(n.minutes / 60).toFixed(1)} h</span>
                      <span className="pill">{QUALITY_LABEL[n.quality] ?? "OK"}</span>
                    </div>
                    {n.note ? <div className="hint truncate">{n.note}</div> : null}
                  </div>
                  <DeleteButton action={deleteSleep} id={n.id} what="night" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
  });
}
