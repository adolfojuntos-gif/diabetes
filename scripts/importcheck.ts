/**
 * Evidence for the chunked CGM import. Not part of the app: a throwaway check that the slicing the
 * browser does produces the same readings the whole file would, that the batch stays one batch,
 * and that running it twice adds nothing. Dates are in 2019 so the rows cannot land in any window
 * the engines look at, and the batch is deleted at the end.
 *
 *   npx tsx scripts/importcheck.ts
 */
import "dotenv/config";
import { eq, sql, and, lt } from "drizzle-orm";
import { db, glucoseReadings } from "../src/lib/db";
import { parseCgmCsv, findHeaderIndex } from "../src/lib/engines/cgmImport";
import { newId } from "../src/lib/ids";

const ROWS_PER_SLICE = 4000; // must match Paste.tsx
const CHUNK_ROWS = 100; // must match actions.ts
const EGV_ROWS = 9000;
const BOUNDARY = new Date(2020, 0, 1);

function buildClarityCsv() {
  const header =
    "Index,Timestamp (YYYY-MM-DDThh:mm:ss),Event Type,Event Subtype,Patient Info,Device Info,Source Device ID,Glucose Value (mg/dL),Insulin Value (u),Carb Value (grams),Duration (hh:mm:ss),Glucose Rate of Change (mg/dL/min),Transmitter Time (Long Integer),Transmitter ID";
  const rows = [header];
  const start = new Date(2019, 0, 1, 0, 0, 0).getTime();
  const pad = (n: number) => String(n).padStart(2, "0");
  let nonEgv = 0;
  for (let i = 0; i < EGV_ROWS; i++) {
    const t = new Date(start + i * 5 * 60_000);
    const ts = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}:00`;
    const val = Math.round(120 + 35 * Math.sin(i / 26) + (i % 7));
    rows.push(`${i},${ts},EGV,,,G6,SM12345,${val},,,,,,`);
    if (i % 500 === 0) {
      rows.push(`${i},${ts},Insulin,Fast-Acting,,G6,SM12345,,6,,,,,`);
      nonEgv++;
    }
  }
  return { csv: rows.join("\n"), nonEgv };
}

/** Exactly the slicing Paste.tsx does. */
function slice(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headerIdx = findHeaderIndex(lines);
  if (headerIdx === -1) throw new Error("header not found");
  const preamble = lines.slice(0, headerIdx + 1);
  const body = lines.slice(headerIdx + 1);
  const out: string[] = [];
  for (let i = 0; i < body.length; i += ROWS_PER_SLICE) {
    out.push([...preamble, ...body.slice(i, i + ROWS_PER_SLICE)].join("\n"));
  }
  return out;
}

/** Exactly the insert importChunk does. */
async function insertSlice(text: string, batch: string) {
  const report = parseCgmCsv(text, "mgdl");
  let inserted = 0;
  const now = new Date();
  for (let i = 0; i < report.readings.length; i += CHUNK_ROWS) {
    const rows = report.readings.slice(i, i + CHUNK_ROWS).map((r) => ({
      id: newId(),
      at: r.at,
      valueMgdl: r.valueMgdl,
      source: "cgm_import" as const,
      importBatch: batch,
      createdAt: now,
    }));
    const back = await db
      .insert(glucoseReadings)
      .values(rows)
      .onConflictDoNothing({ target: [glucoseReadings.at, glucoseReadings.source] })
      .returning({ id: glucoseReadings.id });
    inserted += back.length;
  }
  return { report, inserted };
}

async function countPre2020() {
  const r = await db
    .select({ n: sql<number>`count(*)` })
    .from(glucoseReadings)
    .where(lt(glucoseReadings.at, BOUNDARY));
  return Number(r[0].n);
}

async function main() {
  const { csv, nonEgv } = buildClarityCsv();
  const whole = parseCgmCsv(csv, "mgdl");
  const slices = slice(csv);

  console.log("FILE");
  console.log("  bytes             ", csv.length.toLocaleString(), `(${(csv.length / 1048576).toFixed(2)} MB)`);
  console.log("  EGV rows written  ", EGV_ROWS.toLocaleString());
  console.log("  non-EGV rows      ", nonEgv);
  console.log("  slices            ", slices.length);
  console.log("  largest slice     ", Math.max(...slices.map((s) => s.length)).toLocaleString(), "bytes");

  // 1. slicing must not lose or invent a reading
  let slicedTotal = 0;
  for (const s of slices) slicedTotal += parseCgmCsv(s, "mgdl").readings.length;
  console.log("\nPARSE");
  console.log("  whole file        ", whole.readings.length.toLocaleString(), "readings,", whole.skipped, "skipped");
  console.log("  sum of slices     ", slicedTotal.toLocaleString(), "readings");
  console.log("  match             ", slicedTotal === whole.readings.length ? "YES" : "NO  <-- FAIL");

  const before = await countPre2020();
  const batch = newId();

  let inserted1 = 0;
  for (const s of slices) inserted1 += (await insertSlice(s, batch)).inserted;
  const after1 = await countPre2020();

  // 2. a second identical run must add nothing
  let inserted2 = 0;
  for (const s of slices) inserted2 += (await insertSlice(s, batch)).inserted;
  const after2 = await countPre2020();

  const batches = await db
    .select({ b: glucoseReadings.importBatch, n: sql<number>`count(*)` })
    .from(glucoseReadings)
    .where(and(lt(glucoseReadings.at, BOUNDARY)))
    .groupBy(glucoseReadings.importBatch);

  console.log("\nINSERT (rows dated 2019 only)");
  console.log("  pre-2020 before   ", before);
  console.log("  first run added   ", inserted1.toLocaleString());
  console.log("  pre-2020 after    ", after1.toLocaleString());
  console.log("  second run added  ", inserted2, inserted2 === 0 ? "(idempotent)" : " <-- FAIL, duplicates");
  console.log("  pre-2020 after 2  ", after2.toLocaleString());
  console.log("  batches in range  ", batches.map((x) => `${x.b}=${Number(x.n)}`).join(", "), batches.length === 1 ? "(one batch)" : "<-- FAIL");

  await db.delete(glucoseReadings).where(eq(glucoseReadings.importBatch, batch));
  const cleaned = await countPre2020();
  console.log("\nCLEANUP");
  console.log("  undo by batch     ", cleaned === before ? `YES, back to ${cleaned}` : `NO, left ${cleaned} <-- FAIL`);

  const pass =
    slicedTotal === whole.readings.length &&
    inserted1 === whole.readings.length &&
    inserted2 === 0 &&
    batches.length === 1 &&
    cleaned === before;
  console.log("\nRESULT:", pass ? "PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
}

main();
