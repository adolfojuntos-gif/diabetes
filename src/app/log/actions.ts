"use server";
/**
 * Deletes for every kind of row the logging screens show. One action per table, each validated,
 * each returning the readable result the screen renders.
 *
 * Nothing here interprets a value. Removing a row removes a row.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  glucoseReadings,
  meals,
  insulinDoses,
  exerciseSessions,
  hydrationLogs,
  sleepLogs,
  symptomLogs,
  weightLogs,
  bloodPressureLogs,
  medicationTaken,
  medications,
} from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { fail, parseForm } from "@/lib/actions";
import { revalidateLog } from "./revalidate";
import type { LogResult } from "./types";

const IdForm = z.object({ id: z.string().min(1).max(40) });

async function removeRow(fd: FormData, run: (id: string) => Promise<unknown>, what: string, paths: string[]): Promise<LogResult> {
  const parsed = parseForm(IdForm, fd);
  if ("error" in parsed) return fail(parsed.error);
  try {
    await run(parsed.data.id);
  } catch {
    return fail(`Could not delete that ${what}. Please try again.`);
  }
  revalidateLog(...paths);
  return { ok: true };
}

export async function deleteGlucose(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  return requireAccount(async () =>
    removeRow(fd, (id) => db.delete(glucoseReadings).where(eq(glucoseReadings.id, id)), "reading", [
      "/log/glucose",
      "/log/glucose/import",
      "/trends",
    ]),
  );
}

export async function deleteMeal(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  return requireAccount(async () =>
    removeRow(fd, (id) => db.delete(meals).where(eq(meals.id, id)), "meal", ["/log/meal", "/trends"]),
  );
}

export async function deleteInsulin(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  return requireAccount(async () =>
    removeRow(fd, (id) => db.delete(insulinDoses).where(eq(insulinDoses.id, id)), "insulin entry", ["/log/insulin"]),
  );
}

export async function deleteExercise(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  return requireAccount(async () =>
    removeRow(fd, (id) => db.delete(exerciseSessions).where(eq(exerciseSessions.id, id)), "movement entry", ["/move"]),
  );
}

export async function deleteHydration(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  return requireAccount(async () =>
    removeRow(fd, (id) => db.delete(hydrationLogs).where(eq(hydrationLogs.id, id)), "water entry", ["/log/water"]),
  );
}

export async function deleteSleep(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  return requireAccount(async () =>
    removeRow(fd, (id) => db.delete(sleepLogs).where(eq(sleepLogs.id, id)), "night", ["/log/sleep"]),
  );
}

export async function deleteSymptom(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  return requireAccount(async () =>
    removeRow(fd, (id) => db.delete(symptomLogs).where(eq(symptomLogs.id, id)), "symptom note", ["/log/more"]),
  );
}

export async function deleteWeight(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  return requireAccount(async () =>
    removeRow(fd, (id) => db.delete(weightLogs).where(eq(weightLogs.id, id)), "weight entry", ["/log/more"]),
  );
}

export async function deleteBloodPressure(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  return requireAccount(async () =>
    removeRow(fd, (id) => db.delete(bloodPressureLogs).where(eq(bloodPressureLogs.id, id)), "blood pressure entry", ["/log/more"]),
  );
}

export async function deleteMedicationTaken(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  return requireAccount(async () =>
    removeRow(fd, (id) => db.delete(medicationTaken).where(eq(medicationTaken.id, id)), "medication entry", ["/log/more"]),
  );
}

/** Stops showing a medication without erasing the history of taking it. */
export async function archiveMedication(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  return requireAccount(async () => {
  const parsed = parseForm(IdForm, fd);
  if ("error" in parsed) return fail(parsed.error);
  try {
    await db.update(medications).set({ active: false }).where(eq(medications.id, parsed.data.id));
  } catch {
    return fail("Could not put that medication away. Please try again.");
  }
  revalidateLog("/log/more");
  return { ok: true, message: "Put away. Your record of taking it is kept." };
  });
}
