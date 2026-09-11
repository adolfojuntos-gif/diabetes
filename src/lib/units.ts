/**
 * Glucose is stored in mg/dL. These are the ONLY conversion functions; screens call them at the
 * edge and never store the result.
 *
 * 1 mmol/L = 18.0156 mg/dL (glucose molar mass 180.156 g/mol). Clinical software rounds with 18.
 * We use the exact factor and round for display: 70 mg/dL -> 3.9, 180 -> 10.0, 54 -> 3.0, 250 -> 13.9.
 */
import type { Units } from "./db/schema";

export type { Units };

export const MGDL_PER_MMOL = 18.0156;

export function mgdlToMmol(mgdl: number): number {
  return Math.round((mgdl / MGDL_PER_MMOL) * 10) / 10;
}

export function mmolToMgdl(mmol: number): number {
  return Math.round(mmol * MGDL_PER_MMOL);
}

/** Parse a value typed by the person in their own unit into canonical mg/dL. */
export function toMgdl(value: number, units: Units): number {
  return units === "mmol" ? mmolToMgdl(value) : Math.round(value);
}

export function formatGlucose(mgdl: number, units: Units): string {
  return units === "mmol" ? mgdlToMmol(mgdl).toFixed(1) : String(Math.round(mgdl));
}

export function unitLabel(units: Units): string {
  return units === "mmol" ? "mmol/L" : "mg/dL";
}

/** Sanity bounds for a typed reading, in mg/dL. Meters read 20–600. */
export const GLUCOSE_MIN_MGDL = 20;
export const GLUCOSE_MAX_MGDL = 600;

/** Clinical thresholds (mg/dL) from the international consensus on time in range. */
export const VERY_LOW_MGDL = 54;
export const LOW_MGDL = 70;
export const HIGH_MGDL = 180;
export const VERY_HIGH_MGDL = 250;

export type Band = "very_low" | "low" | "in_range" | "high" | "very_high";

export function bandOf(mgdl: number, low = LOW_MGDL, high = HIGH_MGDL): Band {
  if (mgdl < VERY_LOW_MGDL) return "very_low";
  if (mgdl < low) return "low";
  if (mgdl <= high) return "in_range";
  if (mgdl <= VERY_HIGH_MGDL) return "high";
  return "very_high";
}

export const BAND_LABEL: Record<Band, string> = {
  very_low: "Very low",
  low: "Low",
  in_range: "In range",
  high: "High",
  very_high: "Very high",
};
