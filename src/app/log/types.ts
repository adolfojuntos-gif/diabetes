/**
 * Shapes shared between the logging screens and their client components.
 *
 * `LogResult` is the `ActionResult` shape from `@/lib/actions` with two optional extras the
 * logging screens need: a `detail` line and a pointer at the Copilot. It stays assignable to
 * `ActionResult`, so `fail()` and `done()` can be returned from any of these actions.
 *
 * It lives in a plain module (no "use client", no "use server") so both sides can import it.
 */

export type LogOk = {
  ok: true;
  id?: string;
  message?: string;
  /** A second sentence under the message, when the save has something to report back. */
  detail?: string;
  /** Offer to carry on in the Copilot. Never advice, only a door. */
  copilot?: { mode: string; text: string; cta: string };
};

export type LogResult = LogOk | { ok: false; error: string };

export type LogAction = (prev: LogResult | null, fd: FormData) => Promise<LogResult>;

/* ----------------------------- CSV import ----------------------------- */

export type ImportReportView = {
  format: "dexcom" | "libreview" | "generic" | "unknown";
  found: number;
  firstAt: string | null;
  lastAt: string | null;
  skipped: number;
  skippedReasons: Record<string, number>;
  inserted: number;
  already: number;
};

export type ImportResult = (LogOk & { report?: ImportReportView }) | { ok: false; error: string; report?: ImportReportView };

export type ImportAction = (prev: ImportResult | null, fd: FormData) => Promise<ImportResult>;

/**
 * One slice of a large export. A ninety day Dexcom download is bigger than a single server action
 * body, so the browser posts it in pieces and adds these up into one report.
 */
export type ChunkOk = {
  ok: true;
  batch: string;
  format: ImportReportView["format"];
  found: number;
  inserted: number;
  skipped: number;
  skippedReasons: Record<string, number>;
  firstAtMs: number | null;
  lastAtMs: number | null;
};

export type ChunkResult = ChunkOk | { ok: false; error: string; batch?: string; inserted?: number };

export type ChunkAction = (input: { text: string; batch: string | null }) => Promise<ChunkResult>;

/* --------------------------- meal photo flow --------------------------- */

/**
 * Same shape as `EstimatedItem` in `@/lib/ai/mealPhoto`, restated so a client file needs no server
 * import.
 *
 * `carbsG` is NULL when the carbohydrate reference had no match for the identified food. Not
 * zero: a zero adds nothing to a total and looks measured, and the difference between those is
 * the whole safety argument. The screen shows a blank and asks the person to look it up.
 */
export type PhotoItem = {
  name: string;
  portion: string;
  carbsG: number | null;
  caloriesKcal: number | null;
  confidence: "low" | "medium" | "high";
  /** The reference row the figures came from, or null when nothing matched. */
  matchedName: string | null;
  source: string | null;
  match: "none" | "weak" | "good";
};

export type PhotoResult =
  | { ok: true; items: PhotoItem[]; note: string; totalCarbsG: number; totalCaloriesKcal: number }
  | { ok: false; error: string };

export type PhotoAction = (prev: PhotoResult | null, fd: FormData) => Promise<PhotoResult>;
