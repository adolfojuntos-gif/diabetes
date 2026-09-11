/**
 * Explain my labs.
 *
 * The extraction is deterministic (src/lib/engines/labs.ts) and the person verifies every value
 * before it is saved. The app never fills in a reference range the laboratory did not print, and
 * it never says whether a value is good or bad: it shows the lab's own range and the lab's own
 * flag, and it explains what the test generally measures from the controlled knowledge list.
 */
import { revalidatePath } from "next/cache";
import { and, desc, eq, like } from "drizzle-orm";
import { z } from "zod";
import { db, doctorQuestions, labResults, type LabResult } from "@/lib/db";
import { LAB_TESTS, a1cPctToMmolMol, a1cToEag, extractLabs } from "@/lib/engines/labs";
import { knowledgeById, KNOWLEDGE_VERSION } from "@/lib/knowledge/clinical";
import { requireAccount } from "@/lib/auth/session";
import { getProfile } from "@/lib/data/snapshot";
import { newId } from "@/lib/ids";
import { parseForm, zStr } from "@/lib/actions";
import { dateKey, fmtDay, parseDateKey } from "@/lib/time";
import { formatGlucose, unitLabel } from "@/lib/units";
import type { Units } from "@/lib/db/schema";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { FormError, FormNote, param, type SP } from "../_shared/ui";
import { failTo, noteTo } from "../_shared/server";
import { PrintButton } from "../_shared/client";

const PATH = "/toolkit/labs";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * There is no column for "the line this came from", so the raw line is kept in `note` behind this
 * marker. A note without the marker is the person's own note and is never described as extracted.
 */
const RAW_PREFIX = "Read from the pasted report: ";

function rawLineOf(note: string | null): string | null {
  return note && note.startsWith(RAW_PREFIX) ? note.slice(RAW_PREFIX.length) : null;
}

/** Rows this screen extracted and has not saved yet. Anything else unverified is left alone. */
const pendingHere = () => and(eq(labResults.verified, false), like(labResults.note, `${RAW_PREFIX}%`));

/* ------------------------------- actions ------------------------------- */

async function extractPasted(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(z.object({ text: z.string().max(20000), at: z.string().regex(DATE_RE) }), fd);
  if ("error" in r) failTo(PATH, r.error);
  const rows = extractLabs(r.data.text);
  if (rows.length === 0) {
    failTo(
      PATH,
      "Nothing in that text looked like a test result. Paste the lines with the test name, the value and the unit on them.",
    );
  }
  const at = parseDateKey(r.data.at);
  const now = new Date();
  // Clear any earlier half-finished extraction from this screen so the verify table is never two
  // reports deep. Unverified rows from elsewhere are not touched.
  await db.delete(labResults).where(pendingHere());
  for (const x of rows) {
    await db.insert(labResults).values({
      id: newId(),
      at,
      testKey: x.testKey,
      name: x.name,
      value: x.value,
      unit: x.unit,
      refLow: x.refLow,
      refHigh: x.refHigh,
      labFlag: x.labFlag,
      verified: false,
      note: `${RAW_PREFIX}${x.rawLine}`,
      createdAt: now,
    });
  }
  revalidatePath(PATH);
  noteTo(PATH, `Read ${rows.length} result${rows.length === 1 ? "" : "s"} from your text. Check every line before saving.`);
  });
}

async function discardExtraction() {
  "use server";
  return requireAccount(async () => {
  await db.delete(labResults).where(pendingHere());
  revalidatePath(PATH);
  });
}

const numish = z.array(z.string().max(24));

async function saveVerified(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(
    z.object({
      at: z.string().regex(DATE_RE),
      id: z.array(zStr(40)),
      keep: z.array(z.string().max(8)),
      name: z.array(zStr(120)),
      value: numish,
      unit: z.array(z.string().max(24)),
      refLow: numish,
      refHigh: numish,
      labFlag: z.array(z.enum(["", "H", "L"])),
    }),
    fd,
  );
  if ("error" in r) failTo(PATH, r.error);
  const d = r.data;
  const at = parseDateKey(d.at);
  const num = (s: string): number | null => {
    const t = s.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  let saved = 0;
  for (let i = 0; i < d.id.length; i++) {
    const id = d.id[i];
    const keep = d.keep[i] === "yes";
    if (!keep) {
      await db.delete(labResults).where(eq(labResults.id, id));
      continue;
    }
    const value = num(d.value[i] ?? "");
    const name = (d.name[i] ?? "").trim();
    if (value === null || !name) {
      failTo(PATH, "Every row you keep needs a test name and a number. Leave a row out if it was read wrongly.");
    }
    await db
      .update(labResults)
      .set({
        at,
        name,
        value,
        unit: (d.unit[i] ?? "").trim(),
        refLow: num(d.refLow[i] ?? ""),
        refHigh: num(d.refHigh[i] ?? ""),
        labFlag: d.labFlag[i] ? d.labFlag[i] : null,
        verified: true,
      })
      .where(eq(labResults.id, id));
    saved++;
  }
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  noteTo(PATH, saved === 0 ? "Nothing saved." : `Saved ${saved} result${saved === 1 ? "" : "s"}.`);
  });
}

async function deleteResult(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(z.object({ id: zStr(40) }), fd);
  if ("error" in r) failTo(PATH, r.error);
  await db.delete(labResults).where(eq(labResults.id, r.data.id));
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function addLabQuestions(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(z.object({ name: zStr(120), date: z.string().regex(DATE_RE) }), fd);
  if ("error" in r) failTo(PATH, r.error);
  await db.insert(doctorQuestions).values({
    id: newId(),
    text: `Can we go over my ${r.data.name} result from ${r.data.date}?`,
    evidence: null,
    source: "manual",
    createdAt: new Date(),
  });
  revalidatePath(PATH);
  revalidatePath("/toolkit/questions");
  revalidatePath("/toolkit");
  noteTo(PATH, "Added to your questions for the doctor.");
  });
}

/* -------------------------------- pieces -------------------------------- */

function rangeText(l: LabResult): string {
  if (l.refLow !== null && l.refHigh !== null) return `The lab's range: ${l.refLow} to ${l.refHigh}${l.unit ? ` ${l.unit}` : ""}`;
  if (l.refHigh !== null) return `The lab's range: under ${l.refHigh}${l.unit ? ` ${l.unit}` : ""}`;
  if (l.refLow !== null) return `The lab's range: over ${l.refLow}${l.unit ? ` ${l.unit}` : ""}`;
  return "No range supplied by the lab";
}

/** Only the lab's own range or the lab's own flag can produce a flag. The app never decides. */
function flagText(l: LabResult): string | null {
  const outLow = l.refLow !== null && l.value < l.refLow;
  const outHigh = l.refHigh !== null && l.value > l.refHigh;
  if (outLow) return "Below the lab's own range";
  if (outHigh) return "Above the lab's own range";
  const f = (l.labFlag ?? "").toUpperCase();
  if (f === "H") return "The lab marked this H";
  if (f === "L") return "The lab marked this L";
  if (f) return `The lab marked this ${f}`;
  return null;
}

function A1cChart({ points }: { points: { date: string; value: number }[] }) {
  if (points.length < 2) return null;
  const w = 640;
  const h = 180;
  const pad = { l: 40, r: 12, t: 14, b: 26 };
  const values = points.map((p) => p.value);
  const lo = Math.min(...values) - 0.5;
  const hi = Math.max(...values) + 0.5;
  const span = hi - lo || 1;
  const x = (i: number) => pad.l + (i * (w - pad.l - pad.r)) / (points.length - 1);
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (h - pad.t - pad.b);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  return (
    <div className="overflow-x-auto mt-3">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        role="img"
        aria-label={`A1C over time: ${points.map((p) => `${p.value}% on ${p.date}`).join(", ")}`}
        style={{ minWidth: 320 }}
      >
        <line x1={pad.l} y1={h - pad.b} x2={w - pad.r} y2={h - pad.b} stroke="var(--line-strong)" strokeWidth="1" />
        <text x={4} y={y(hi - 0.5) + 4} fontSize="10" fill="var(--ink-faint)">
          {(hi - 0.5).toFixed(1)}%
        </text>
        <text x={4} y={y(lo + 0.5) + 4} fontSize="10" fill="var(--ink-faint)">
          {(lo + 0.5).toFixed(1)}%
        </text>
        <path d={path} fill="none" stroke="var(--slate)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={`${p.date}-${i}`}>
            <circle cx={x(i)} cy={y(p.value)} r="3.5" fill="var(--slate)" />
            <text x={x(i)} y={h - pad.b + 14} fontSize="9" textAnchor="middle" fill="var(--ink-faint)">
              {p.date.slice(5)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function KnowledgeBlock({ id, heading }: { id: string; heading: string }) {
  const k = knowledgeById(id);
  if (!k) return null;
  return (
    <div className="card-sunk p-3 mt-3">
      <div className="eyebrow">{heading}</div>
      <p className="text-sm mt-1 prose-measure">{k.statement}</p>
      <p className="hint mt-2">
        Source: {k.source}. Written {k.updated}. Review status: {k.reviewStatus.replace(/_/g, " ")}. Knowledge list{" "}
        {KNOWLEDGE_VERSION}.
      </p>
    </div>
  );
}

function ResultLine({ l, units }: { l: LabResult; units: Units }) {
  const flag = flagText(l);
  const raw = rawLineOf(l.note);
  void units;
  return (
    <div className="divider py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="num text-lg">
          {l.value}
          {l.unit ? <span className="text-sm muted ml-1">{l.unit}</span> : null}
        </span>
        <span className="text-sm muted">{fmtDay(l.at)}</span>
        {flag ? <span className="pill">{flag}</span> : null}
        <form action={deleteResult} className="ml-auto no-print">
          <input type="hidden" name="id" value={l.id} />
          <SubmitButton className="btn btn-ghost btn-sm" pendingText="Deleting…">
            Delete
          </SubmitButton>
        </form>
      </div>
      <p className="hint mt-1">{rangeText(l)}</p>
      {raw ? <p className="hint mt-1">Read from your pasted report: “{raw}”</p> : l.note ? <p className="hint mt-1">Your note: {l.note}</p> : null}
    </div>
  );
}

/* --------------------------------- page --------------------------------- */

export default async function LabsPage({ searchParams }: { searchParams?: SP }) {
  const [error, note] = await Promise.all([param(searchParams, "e"), param(searchParams, "m")]);
  return requireAccount(async () => {
  const profile = await getProfile();
  const units = profile.units;
  const today = dateKey(new Date());

  const rows = await db.select().from(labResults).orderBy(desc(labResults.at), desc(labResults.createdAt));
  const pending = rows.filter((l) => !l.verified && rawLineOf(l.note) !== null);
  const saved = rows.filter((l) => l.verified);

  // Group saved results by test, newest first inside each group.
  const groups = new Map<string, { label: string; testKey: string | null; items: LabResult[] }>();
  for (const l of saved) {
    const key = l.testKey ?? `name:${l.name.toLowerCase()}`;
    const g = groups.get(key);
    if (g) g.items.push(l);
    else groups.set(key, { label: l.name, testKey: l.testKey, items: [l] });
  }

  const a1cRows = saved
    .filter((l) => l.testKey === "a1c")
    .slice()
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const latestA1c = a1cRows[a1cRows.length - 1];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Toolkit"
        title="Explain my labs"
        lede="Paste a lab report, check every line the app read, and keep the results with the laboratory's own reference ranges. Steady explains what each test measures. It never tells you what your value means."
      />

      <FormError message={error} />
      <FormNote message={note} />

      <Card className="no-print">
        <h2>Paste a lab report</h2>
        <form action={extractPasted} className="mt-3 grid gap-3">
          <div className="field">
            <label className="label" htmlFor="lab-text">
              The text from your report
            </label>
            <textarea
              id="lab-text"
              name="text"
              className="textarea"
              rows={8}
              required
              placeholder={"HbA1c 7.2 % (4.0-5.6)\nLDL cholesterol 96 mg/dL (<100)\neGFR 88 mL/min/1.73m2"}
            />
            <span className="hint">One result per line, with the test name, the value and the unit. Nothing leaves this device.</span>
          </div>
          <div className="field md:max-w-xs">
            <label className="label" htmlFor="lab-date">
              The date these were drawn
            </label>
            <input id="lab-date" name="at" type="date" className="input" defaultValue={today} max={today} required />
          </div>
          <div>
            <SubmitButton pendingText="Reading…">Read this report</SubmitButton>
          </div>
        </form>
      </Card>

      {pending.length > 0 ? (
        <Card className="mt-6 no-print">
          <h2>Check these before saving</h2>
          <p className="text-sm muted mt-1 prose-measure">
            These values were read from your text by a plain pattern match, so they can be wrong. Correct anything that does
            not match your report. The app never fills in a reference range the lab did not give: a blank range stays blank.
            Set the flag column to None unless the lab actually printed an H or an L on that line.
          </p>
          <form action={saveVerified} className="mt-4">
            <div className="field md:max-w-xs">
              <label className="label" htmlFor="verify-date">
                Date of these results
              </label>
              <input
                id="verify-date"
                name="at"
                type="date"
                className="input"
                defaultValue={dateKey(pending[0].at)}
                max={today}
                required
              />
            </div>

            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm" style={{ minWidth: 900 }}>
                <thead>
                  <tr className="text-left">
                    <th className="p-2 eyebrow">Test</th>
                    <th className="p-2 eyebrow">Value</th>
                    <th className="p-2 eyebrow">Unit</th>
                    <th className="p-2 eyebrow">Ref low</th>
                    <th className="p-2 eyebrow">Ref high</th>
                    <th className="p-2 eyebrow">Lab&rsquo;s flag</th>
                    <th className="p-2 eyebrow">Keep</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((l, i) => (
                    <tr key={l.id} className="divider align-top">
                      <td className="p-2">
                        <input type="hidden" name="id[]" value={l.id} />
                        <label className="sr-only" htmlFor={`name-${i}`}>
                          Test name for row {i + 1}
                        </label>
                        <input id={`name-${i}`} name="name[]" className="input" defaultValue={l.name} maxLength={120} />
                        <span className="hint block mt-1">The line it came from: “{rawLineOf(l.note) ?? l.note ?? ""}”</span>
                      </td>
                      <td className="p-2">
                        <label className="sr-only" htmlFor={`value-${i}`}>
                          Value for row {i + 1}
                        </label>
                        <input id={`value-${i}`} name="value[]" className="input num" inputMode="decimal" defaultValue={String(l.value)} />
                      </td>
                      <td className="p-2">
                        <label className="sr-only" htmlFor={`unit-${i}`}>
                          Unit for row {i + 1}
                        </label>
                        <input id={`unit-${i}`} name="unit[]" className="input" defaultValue={l.unit} maxLength={24} />
                      </td>
                      <td className="p-2">
                        <label className="sr-only" htmlFor={`reflow-${i}`}>
                          Reference low for row {i + 1}
                        </label>
                        <input
                          id={`reflow-${i}`}
                          name="refLow[]"
                          className="input num"
                          inputMode="decimal"
                          defaultValue={l.refLow === null ? "" : String(l.refLow)}
                          placeholder="none given"
                        />
                      </td>
                      <td className="p-2">
                        <label className="sr-only" htmlFor={`refhigh-${i}`}>
                          Reference high for row {i + 1}
                        </label>
                        <input
                          id={`refhigh-${i}`}
                          name="refHigh[]"
                          className="input num"
                          inputMode="decimal"
                          defaultValue={l.refHigh === null ? "" : String(l.refHigh)}
                          placeholder="none given"
                        />
                      </td>
                      <td className="p-2">
                        <label className="sr-only" htmlFor={`flag-${i}`}>
                          The lab&rsquo;s own flag for row {i + 1}
                        </label>
                        <select
                          id={`flag-${i}`}
                          name="labFlag[]"
                          className="select"
                          defaultValue={l.labFlag === "H" || l.labFlag === "L" ? l.labFlag : ""}
                        >
                          <option value="">None</option>
                          <option value="H">H</option>
                          <option value="L">L</option>
                        </select>
                        <span className="hint block mt-1">Only what the lab printed.</span>
                      </td>
                      <td className="p-2">
                        <label className="sr-only" htmlFor={`keep-${i}`}>
                          Keep row {i + 1}
                        </label>
                        <select id={`keep-${i}`} name="keep[]" className="select" defaultValue="yes">
                          <option value="yes">Save</option>
                          <option value="no">Leave out</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4">
              <SubmitButton pendingText="Saving…">Save these results</SubmitButton>
            </div>
          </form>
          <form action={discardExtraction} className="mt-3">
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="Discarding…">
              Discard this extraction
            </SubmitButton>
          </form>
        </Card>
      ) : null}

      {saved.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No labs saved yet" body="Paste a report above. You check every value before anything is kept." />
        </div>
      ) : (
        <section className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <h2>Your saved results</h2>
            <PrintButton />
          </div>
          <div className="grid gap-3 mt-3">
            {[...groups.values()].map((g) => {
              const def = g.testKey ? LAB_TESTS.find((t) => t.key === g.testKey) : undefined;
              const newest = g.items[0];
              return (
                <Card key={g.label + (g.testKey ?? "")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3>{g.label}</h3>
                    <form action={addLabQuestions} className="no-print">
                      <input type="hidden" name="name" value={g.label} />
                      <input type="hidden" name="date" value={dateKey(newest.at)} />
                      <SubmitButton className="btn btn-secondary btn-sm" pendingText="Adding…">
                        Add these to my doctor questions
                      </SubmitButton>
                    </form>
                  </div>
                  <div className="mt-2">
                    {g.items.map((l) => (
                      <ResultLine key={l.id} l={l} units={units} />
                    ))}
                  </div>
                  {def ? <KnowledgeBlock id={def.knowledgeId} heading="What this test generally measures" /> : null}
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {a1cRows.length > 0 ? (
        <section className="mt-8">
          <h2>A1C over time</h2>
          <Card className="mt-3">
            <A1cChart points={a1cRows.map((l) => ({ date: dateKey(l.at), value: l.value }))} />
            <div className="mt-3">
              {a1cRows
                .slice()
                .reverse()
                .map((l) => (
                  <div key={l.id} className="divider py-2 first:border-t-0 flex flex-wrap items-baseline gap-x-3">
                    <span className="num">
                      {l.value}
                      {l.unit ? ` ${l.unit}` : " %"}
                    </span>
                    <span className="text-sm muted">{fmtDay(l.at)}</span>
                    <span className="hint">{rangeText(l)}</span>
                  </div>
                ))}
            </div>

            {latestA1c ? (
              <div className="card-sunk p-3 mt-4">
                <div className="eyebrow">Conversions of your latest A1C ({latestA1c.value}%)</div>
                <p className="text-sm mt-1">
                  Estimated average glucose: {formatGlucose(a1cToEag(latestA1c.value), units)} {unitLabel(units)}. In IFCC
                  units: {a1cPctToMmolMol(latestA1c.value)} mmol/mol.
                </p>
                <p className="hint mt-1">
                  Both of these are arithmetic conversions of the same A1C number, not separate measurements. Estimated
                  average glucose uses 28.7 × A1C − 46.7 (ADAG). IFCC uses (A1C − 2.15) × 10.929.
                </p>
              </div>
            ) : null}

            <KnowledgeBlock id="lab_a1c" heading="What A1C measures" />

            <p className="text-sm mt-3 prose-measure">
              One A1C number does not tell the whole story. It is an average, so a calm fortnight and a rough one can add up
              to the same figure, and it says nothing about how often you went low. Some conditions change how A1C reads at
              all, including anemia, hemoglobin variants, pregnancy, kidney disease and a recent transfusion. If your A1C and
              your day-to-day readings do not seem to agree, that is worth asking about rather than explaining away.
            </p>
          </Card>
        </section>
      ) : null}

      <div className="mt-8 no-print">
        <Notice>
          Steady shows the laboratory's own range and the laboratory's own flag, and nothing else. It does not decide whether
          a value is normal for you, and it does not interpret a single result. That reading belongs with the clinician who
          ordered the test.
        </Notice>
      </div>
    </div>
  );
  });
}
