import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { db, insulinDoses, meals, INSULIN_KINDS } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { fail, parseForm, zLocalDateTime, zNum, zOptStr, zStr } from "@/lib/actions";
import { getProfile, usesInsulin } from "@/lib/data/snapshot";
import { addDays, dateKey, fmtDay, fmtTime, startOfDay, toDateTimeInput } from "@/lib/time";
import { newId } from "@/lib/ids";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { ActionForm, DeleteButton } from "../ActionForm";
import { deleteInsulin } from "../actions";
import { revalidateLog } from "../revalidate";
import { INSULIN_KIND_LABEL, SLOT_LABEL } from "../labels";
import type { LogResult } from "../types";

const Form = z.object({
  kind: z.enum(INSULIN_KINDS),
  insulinName: zStr(80).optional(),
  units: zNum(0, 100),
  at: zLocalDateTime,
  mealId: zStr(40).optional(),
  note: zOptStr(300),
});

async function logInsulin(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  "use server";
  return requireAccount(async () => {
  const parsed = parseForm(Form, fd);
  if ("error" in parsed) return fail(parsed.error);
  const d = parsed.data;

  if (!(d.units > 0)) return fail("Enter how many units you took.");

  let mealId: string | null = null;
  if (d.mealId && d.mealId.length > 0) {
    const found = await db.select({ id: meals.id }).from(meals).where(eq(meals.id, d.mealId)).limit(1);
    if (found.length === 0) return fail("That meal is no longer there. Pick another one, or leave the meal blank.");
    mealId = d.mealId;
  }

  const id = newId();
  try {
    await db.insert(insulinDoses).values({
      id,
      at: d.at,
      kind: d.kind,
      insulinName: (d.insulinName ?? "").trim(),
      units: d.units,
      mealId,
      note: d.note,
      createdAt: new Date(),
    });
  } catch {
    return fail("Could not save that entry. Please try again.");
  }

  revalidateLog("/log/insulin", "/trends", "/review");
  return {
    ok: true,
    id,
    message: `Recorded ${d.units} unit${d.units === 1 ? "" : "s"} of ${INSULIN_KIND_LABEL[d.kind].toLowerCase()} at ${fmtTime(d.at)}.`,
  };
  });
}

export default async function LogInsulinPage() {
  return requireAccount(async () => {
  const profile = await getProfile();
  const now = new Date();
  const since = addDays(startOfDay(now), -13);
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

  const [doses, recentMeals, nameRows] = await Promise.all([
    db.select().from(insulinDoses).where(gte(insulinDoses.at, since)).orderBy(desc(insulinDoses.at)),
    db
      .select({ id: meals.id, at: meals.at, name: meals.name, carbsG: meals.carbsG, slot: meals.slot })
      .from(meals)
      .where(and(gte(meals.at, threeHoursAgo), lte(meals.at, now)))
      .orderBy(asc(meals.at)),
    db.selectDistinct({ name: insulinDoses.insulinName }).from(insulinDoses),
  ]);

  const names = nameRows.map((r) => r.name).filter((n) => n.trim().length > 0);
  const mealName = new Map(recentMeals.map((m) => [m.id, m.name]));

  const byDay = new Map<string, typeof doses>();
  for (const d of doses) {
    const k = dateKey(d.at);
    byDay.set(k, [...(byDay.get(k) ?? []), d]);
  }
  const days = [...byDay.keys()].sort().reverse();
  const todayKey = dateKey(now);

  return (
    <div className="page">
      <PageHeader eyebrow="Log" title="Insulin" lede="What you took, and when. That is all this screen does." />

      <div className="mb-6">
        <Notice>
          Steady records what you took. It never suggests a dose. Dose decisions belong to you and your prescriber.
        </Notice>
      </div>

      {!usesInsulin(profile) ? (
        <div className="mb-6">
          <Notice tone="slate">
            Your profile says you are not using insulin at the moment. You can still record an entry here if you need to, and you can change
            that in Settings whenever it changes.
          </Notice>
        </div>
      ) : null}

      <Card>
        <ActionForm action={logInsulin} pendingText="Recording…">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="field">
              <label className="label" htmlFor="kind">
                Which kind
              </label>
              <select id="kind" name="kind" className="select" defaultValue="bolus">
                {INSULIN_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {INSULIN_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="insulinName">
                Name of the insulin
              </label>
              <input id="insulinName" name="insulinName" className="input" list="insulin-names" maxLength={80} placeholder="As it says on the pen" />
              <datalist id="insulin-names">
                {names.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              {names.length ? <p className="hint">Names you have used before are in the list.</p> : null}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="field">
              <label className="label" htmlFor="units">
                Units
              </label>
              <input
                id="units"
                name="units"
                className="input input-big"
                inputMode="decimal"
                step="0.5"
                min={0}
                max={100}
                placeholder="0"
                required
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="at">
                When
              </label>
              <input id="at" name="at" type="datetime-local" className="input" defaultValue={toDateTimeInput(now)} required />
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="mealId">
              With a meal
            </label>
            <select id="mealId" name="mealId" className="select" defaultValue="">
              <option value="">Not with a meal</option>
              {recentMeals.map((m) => (
                <option key={m.id} value={m.id}>
                  {fmtTime(m.at)} · {m.name} · {Math.round(m.carbsG)} g · {SLOT_LABEL[m.slot]}
                </option>
              ))}
            </select>
            <p className="hint">
              {recentMeals.length
                ? "Meals you logged in the last three hours."
                : "Nothing logged in the last three hours. Log the meal first if you want them linked."}
            </p>
          </div>

          <div className="field">
            <label className="label" htmlFor="note">
              Note
            </label>
            <input id="note" name="note" className="input" maxLength={300} placeholder="Injected in the thigh" />
          </div>

          <div>
            <SubmitButton className="btn btn-lg">Record it</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <section className="mt-8">
        <h2 className="mb-3">The last fourteen days</h2>
        {doses.length === 0 ? (
          <EmptyState title="Nothing recorded yet" body="Entries appear here grouped by day, with the day's totals." />
        ) : (
          <div className="grid gap-4">
            {days.map((k) => {
              const rows = byDay.get(k)!;
              const basal = rows.filter((r) => r.kind === "basal").reduce((a, r) => a + r.units, 0);
              const bolus = rows.filter((r) => r.kind !== "basal").reduce((a, r) => a + r.units, 0);
              return (
                <div key={k}>
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <div className="eyebrow">{k === todayKey ? "Today" : fmtDay(rows[0].at)}</div>
                    <div className="text-sm muted num">
                      Background {Math.round(basal * 10) / 10} u · Mealtime and correction {Math.round(bolus * 10) / 10} u
                    </div>
                  </div>
                  <ul className="card divide-y">
                    {rows.map((r) => (
                      <li key={r.id} className="flex items-center gap-3 p-3 md:p-4">
                        <div className="w-16 shrink-0 num text-sm">{fmtTime(r.at)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="num font-semibold">{r.units} u</span>
                            <span className="pill">{INSULIN_KIND_LABEL[r.kind]}</span>
                            {r.insulinName ? <span className="text-sm muted">{r.insulinName}</span> : null}
                            {r.mealId ? <span className="pill pill-slate">{mealName.get(r.mealId) ?? "With a meal"}</span> : null}
                          </div>
                          {r.note ? <div className="hint truncate">{r.note}</div> : null}
                        </div>
                        <DeleteButton action={deleteInsulin} id={r.id} what="insulin entry" />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
  });
}
