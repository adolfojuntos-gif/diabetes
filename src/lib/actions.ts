import "server-only";
/**
 * Server-action helpers. Every action validates with zod, never trusts the form, and returns a
 * plain { ok, error } so the screen can render the message the person actually needs to see.
 */
import { z } from "zod";

export type ActionResult = { ok: true; id?: string; message?: string } | { ok: false; error: string };

export function fail(error: string): ActionResult {
  return { ok: false, error };
}
export function done(id?: string, message?: string): ActionResult {
  return { ok: true, id, message };
}

/** Parse FormData against a schema, returning field-level errors as one readable line. */
export function parseForm<T extends z.ZodTypeAny>(schema: T, fd: FormData): { data: z.infer<T> } | { error: string } {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$")) continue;
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      // A repeated field name, e.g. `canView[]`, collects into an array.
      const existing = obj[key] as unknown[] | undefined;
      if (existing) existing.push(v);
      else obj[key] = [v];
    } else obj[k] = v;
  }
  const r = schema.safeParse(obj);
  if (r.success) return { data: r.data };
  const first = r.error.issues[0];
  return { error: `${first.path.join(".") || "form"}: ${first.message}` };
}

/**
 * "YYYY-MM-DDTHH:MM" from datetime-local, to a local Date, RANGE CHECKED.
 *
 * The range check is the point. Without it, a date of "9999-99-99T99:99" happily produced the
 * year 10007, and a single future-dated glucose reading sorted to the front of the safety engine's
 * list and switched the whole engine off: it passed the three-hour staleness test because its age
 * was negative. That is how a typo turned an emergency banner into "nothing urgent".
 *
 * So nothing in this app can record a moment more than a few minutes ahead of now, or more than
 * two years behind it. Both bounds are deliberately generous for a human backfilling a log and
 * deliberately tight enough that no arithmetic downstream has to defend itself.
 */
const FUTURE_SLACK_MS = 15 * 60_000;
const PAST_LIMIT_MS = 2 * 365 * 24 * 60 * 60_000;

export const zLocalDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "needs a date and a time")
  .transform((s) => {
    const [d, t] = s.split("T");
    const [y, m, day] = d.split("-").map(Number);
    const [h, min] = t.split(":").map(Number);
    return new Date(y, m - 1, day, h, min);
  })
  .refine((d) => Number.isFinite(d.getTime()), { message: "is not a real date" })
  .refine((d) => d.getTime() - Date.now() <= FUTURE_SLACK_MS, { message: "is in the future" })
  .refine((d) => Date.now() - d.getTime() <= PAST_LIMIT_MS, { message: "is more than two years ago" });

export const zNum = (min: number, max: number) =>
  z.coerce
    .number()
    .refine((n) => !Number.isNaN(n), "must be a number")
    .min(min)
    .max(max);

export const zOptNum = (min: number, max: number) =>
  z
    .union([z.literal(""), z.coerce.number().min(min).max(max)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v));

export const zStr = (max = 200) => z.string().trim().max(max);
export const zOptStr = (max = 500) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
