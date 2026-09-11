"use server";
/**
 * CGM import, one piece at a time.
 *
 * A Dexcom G6 writes 288 readings a day, so ninety days of Clarity is about 26,000 rows and well
 * over a megabyte. A server action body is capped at 1 MB, and the old screen dealt with that by
 * silently cutting the file at 900,000 characters and telling the person to come back with a
 * shorter date range. Importing your own history should not be a chore you do four times.
 *
 * So the browser slices the file on line boundaries and posts the slices in order. Every slice
 * repeats the preamble and header (LibreView puts two metadata lines before its header, which is
 * why `findHeaderIndex` is shared rather than reimplemented), and every slice after the first
 * carries the batch id the first one returned. The whole import therefore stays one batch and one
 * Undo, however many pieces it arrived in.
 *
 * Duplicate protection is not done here and never was: `glucose_at_source_uq` makes the same
 * instant from the same source the same row, so a re-import, a retried slice and two overlapping
 * exports all collapse to one reading. That guarantee is the reason this can be retried safely.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, glucoseReadings } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { fail, parseForm } from "@/lib/actions";
import { getProfile } from "@/lib/data/snapshot";
import { parseCgmCsv } from "@/lib/engines/cgmImport";
import { newId } from "@/lib/ids";
import { revalidateLog } from "../../revalidate";
import type { ChunkResult, LogResult } from "../../types";

/** 8 columns a row, so a hundred rows a statement stays well inside SQLite's variable limit. */
const CHUNK_ROWS = 100;

export type ChunkInput = {
  text: string;
  /** Null on the first slice; the id this returns is passed back on every slice after it. */
  batch: string | null;
};

export async function importChunk({ text, batch }: ChunkInput): Promise<ChunkResult> {
  return requireAccount(async () => {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, error: "That slice arrived empty. Nothing was saved." };
  }
  if (batch !== null && (typeof batch !== "string" || batch.length > 40)) {
    return { ok: false, error: "That import could not be matched to a batch." };
  }

  const profile = await getProfile();
  const report = parseCgmCsv(text, profile.units);

  if (report.format === "unknown") {
    return {
      ok: false,
      error:
        "Steady could not find a time column and a glucose column in that file. Dexcom Clarity and LibreView exports work exactly as they download, headers included.",
    };
  }

  const batchId = batch ?? newId();
  const now = new Date();
  let inserted = 0;

  try {
    for (let i = 0; i < report.readings.length; i += CHUNK_ROWS) {
      const rows = report.readings.slice(i, i + CHUNK_ROWS).map((r) => ({
        id: newId(),
        at: r.at,
        valueMgdl: r.valueMgdl,
        source: "cgm_import" as const,
        importBatch: batchId,
        createdAt: now,
      }));
      const back = await db
        .insert(glucoseReadings)
        .values(rows)
        .onConflictDoNothing({ target: [glucoseReadings.at, glucoseReadings.source] })
        .returning({ id: glucoseReadings.id });
      inserted += back.length;
    }
  } catch {
    // Whatever did save is already under this batch id, so Undo still takes all of it back out.
    return { ok: false, error: "Something went wrong partway through saving this part of the file.", batch: batchId, inserted };
  }

  return {
    ok: true,
    batch: batchId,
    format: report.format,
    found: report.readings.length,
    inserted,
    skipped: report.skipped,
    skippedReasons: report.skippedReasons,
    firstAtMs: report.readings.length ? report.readings[0].at.getTime() : null,
    lastAtMs: report.readings.length ? report.readings[report.readings.length - 1].at.getTime() : null,
  };
  });
}

/** Called once when every slice has landed, so the screens refresh a single time rather than per slice. */
export async function finishImport(): Promise<void> {
  return requireAccount(async () => {
  revalidateLog("/log/glucose", "/log/glucose/import", "/trends", "/review");
  });
}

const UndoForm = z.object({ id: z.string().min(1).max(40) });

export async function undoImport(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  return requireAccount(async () => {
  const parsed = parseForm(UndoForm, fd);
  if ("error" in parsed) return fail(parsed.error);
  try {
    await db.delete(glucoseReadings).where(eq(glucoseReadings.importBatch, parsed.data.id));
  } catch {
    return fail("Could not undo that import. Please try again.");
  }
  revalidateLog("/log/glucose", "/log/glucose/import", "/trends", "/review");
  return { ok: true, message: "That import has been taken back out." };
  });
}
