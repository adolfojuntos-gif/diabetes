/**
 * CGM / meter CSV import. Pure parser: text in, readings out, with a report of what was skipped.
 *
 * Recognised layouts:
 *  - Dexcom Clarity export: "Timestamp (YYYY-MM-DDThh:mm:ss)" + "Glucose Value (mg/dL)" (or mmol/L)
 *    with "Event Type" = EGV rows. "Low"/"High" glucose values become 40 / 400.
 *  - LibreView export: "Device Timestamp" + "Historic Glucose mg/dL" (record type 0) and
 *    "Scan Glucose mg/dL" (record type 1); mmol/L variants.
 *  - Generic: any header containing a time column and a glucose column; unit taken from the header
 *    (mmol → converted) or from the caller's default.
 */
import { mmolToMgdl, GLUCOSE_MIN_MGDL, GLUCOSE_MAX_MGDL } from "../units";
import type { Units } from "../db/schema";

export type ParsedReading = { at: Date; valueMgdl: number };
export type ImportReport = {
  format: "dexcom" | "libreview" | "generic" | "unknown";
  readings: ParsedReading[];
  skipped: number;
  skippedReasons: Record<string, number>;
  unit: Units;
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseWhen(s: string): Date | null {
  if (!s) return null;
  // ISO-ish "2026-09-01T07:15:00" or "2026-09-01 07:15:00"
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
  // LibreView "09-01-2026 07:15 AM" or "01-09-2026 07:15" (day-month varies by locale; assume MM-DD-YYYY for US export)
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (m) {
    let h = +m[4];
    const ap = m[7]?.toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return new Date(+m[3], +m[1] - 1, +m[2], h, +m[5], m[6] ? +m[6] : 0);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Index of the header row among non-empty lines, or -1. LibreView puts two metadata lines first,
 * so it is never safe to assume line 0.
 *
 * Exported because a large export is uploaded in pieces, and the uploader has to repeat the
 * preamble and header on every piece. Both sides call this, so the two cannot drift apart.
 */
export function findHeaderIndex(lines: string[]): number {
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const l = lines[i].toLowerCase();
    if (l.includes("timestamp") && (l.includes("glucose") || l.includes("mg/dl") || l.includes("mmol"))) return i;
  }
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const l = lines[i].toLowerCase();
    if ((l.includes("time") || l.includes("date")) && (l.includes("glucose") || l.includes("value") || l.includes("mg/dl") || l.includes("mmol"))) {
      return i;
    }
  }
  return -1;
}

export function parseCgmCsv(text: string, defaultUnit: Units = "mgdl"): ImportReport {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const skippedReasons: Record<string, number> = {};
  const skip = (why: string) => (skippedReasons[why] = (skippedReasons[why] ?? 0) + 1);
  const readings: ParsedReading[] = [];
  if (lines.length === 0) return { format: "unknown", readings, skipped: 0, skippedReasons, unit: defaultUnit };

  const headerIdx = findHeaderIndex(lines);
  if (headerIdx === -1) return { format: "unknown", readings, skipped: lines.length, skippedReasons: { "no header found": lines.length }, unit: defaultUnit };

  const header = splitCsvLine(lines[headerIdx]).map((h) => h.toLowerCase());
  const find = (...needles: string[]) => header.findIndex((h) => needles.every((n) => h.includes(n)));

  let format: ImportReport["format"] = "generic";
  let timeCol = -1;
  let valueCols: number[] = [];
  let unit: Units = defaultUnit;
  let eventTypeCol = -1;
  let recordTypeCol = -1;

  if (header.some((h) => h.startsWith("timestamp (yyyy-mm-dd")) && header.some((h) => h.includes("glucose value"))) {
    format = "dexcom";
    timeCol = find("timestamp");
    valueCols = [find("glucose value")];
    eventTypeCol = find("event type");
    unit = header[valueCols[0]].includes("mmol") ? "mmol" : "mgdl";
  } else if (header.some((h) => h === "device timestamp")) {
    format = "libreview";
    timeCol = header.indexOf("device timestamp");
    recordTypeCol = header.indexOf("record type");
    const hist = find("historic glucose");
    const scan = find("scan glucose");
    valueCols = [hist, scan].filter((i) => i >= 0);
    const anyCol = valueCols[0];
    unit = anyCol !== undefined && header[anyCol].includes("mmol") ? "mmol" : "mgdl";
  } else {
    timeCol = header.findIndex((h) => h.includes("timestamp") || h.includes("time") || h.includes("date"));
    let v = header.findIndex((h) => h.includes("glucose"));
    if (v === -1) v = header.findIndex((h) => h.includes("value") || h.includes("mg/dl") || h.includes("mmol"));
    valueCols = v >= 0 ? [v] : [];
    if (v >= 0 && header[v].includes("mmol")) unit = "mmol";
    else if (v >= 0 && header[v].includes("mg/dl")) unit = "mgdl";
  }
  if (timeCol === -1 || valueCols.length === 0) {
    return { format: "unknown", readings, skipped: lines.length - headerIdx - 1, skippedReasons: { "columns not recognised": lines.length - headerIdx - 1 }, unit };
  }

  const seen = new Set<number>();
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (format === "dexcom" && eventTypeCol >= 0 && cells[eventTypeCol] && cells[eventTypeCol].toUpperCase() !== "EGV") {
      skip("non-glucose event row");
      continue;
    }
    if (format === "libreview" && recordTypeCol >= 0 && cells[recordTypeCol] && !["0", "1"].includes(cells[recordTypeCol])) {
      skip("non-glucose record type");
      continue;
    }
    const when = parseWhen(cells[timeCol] ?? "");
    if (!when) {
      skip("unreadable time");
      continue;
    }
    let raw: string | undefined;
    for (const c of valueCols) {
      if (cells[c] && cells[c] !== "") {
        raw = cells[c];
        break;
      }
    }
    if (raw === undefined) {
      skip("empty glucose cell");
      continue;
    }
    let num: number;
    const up = raw.toUpperCase();
    if (up === "LOW" || up === "LO") num = unit === "mmol" ? 2.2 : 40;
    else if (up === "HIGH" || up === "HI") num = unit === "mmol" ? 22.2 : 400;
    else {
      num = parseFloat(raw.replace(",", "."));
      if (Number.isNaN(num)) {
        skip("glucose not a number");
        continue;
      }
    }
    const mgdl = unit === "mmol" ? mmolToMgdl(num) : Math.round(num);
    if (mgdl < GLUCOSE_MIN_MGDL || mgdl > GLUCOSE_MAX_MGDL) {
      skip("out of range 20–600");
      continue;
    }
    const key = Math.floor(when.getTime() / 1000);
    if (seen.has(key)) {
      skip("duplicate timestamp in file");
      continue;
    }
    seen.add(key);
    readings.push({ at: when, valueMgdl: mgdl });
  }
  readings.sort((a, b) => a.at.getTime() - b.at.getTime());
  const skipped = Object.values(skippedReasons).reduce((a, b) => a + b, 0);
  return { format, readings, skipped, skippedReasons, unit };
}
