/**
 * Lab result extraction from pasted text. Deterministic. It recognises common diabetes-care tests,
 * pulls value + unit + a reference range IF ONE IS PRESENT ON THE SAME LINE, and returns
 * everything as "unverified" for the person to confirm. It never invents a range.
 */
export type LabTestDef = {
  key: string;
  name: string;
  aliases: RegExp;
  unitHints: string[];
  /** What the test generally measures. Educational, not interpretive. Knowledge id in data/knowledge/clinical.json. */
  knowledgeId: string;
};

export const LAB_TESTS: LabTestDef[] = [
  { key: "a1c", name: "Hemoglobin A1C", aliases: /\b(hba1c|hb a1c|a1c|hemoglobin a1c|glycated hemoglobin|glycohemoglobin)\b/i, unitHints: ["%", "mmol/mol"], knowledgeId: "lab_a1c" },
  { key: "fasting_glucose", name: "Fasting glucose", aliases: /\b(fasting (plasma )?glucose|glucose, fasting|fpg|glucose fasting|glucose)\b/i, unitHints: ["mg/dL", "mmol/L"], knowledgeId: "lab_fasting_glucose" },
  { key: "ldl", name: "LDL cholesterol", aliases: /\b(ldl|ldl-c|ldl cholesterol)\b/i, unitHints: ["mg/dL", "mmol/L"], knowledgeId: "lab_lipids" },
  { key: "hdl", name: "HDL cholesterol", aliases: /\b(hdl|hdl-c|hdl cholesterol)\b/i, unitHints: ["mg/dL", "mmol/L"], knowledgeId: "lab_lipids" },
  { key: "triglycerides", name: "Triglycerides", aliases: /\b(triglycerides?|trig|tg)\b/i, unitHints: ["mg/dL", "mmol/L"], knowledgeId: "lab_lipids" },
  { key: "total_cholesterol", name: "Total cholesterol", aliases: /\b(total cholesterol|cholesterol, total|cholesterol)\b/i, unitHints: ["mg/dL", "mmol/L"], knowledgeId: "lab_lipids" },
  { key: "egfr", name: "eGFR (kidney filtration)", aliases: /\b(egfr|gfr|estimated gfr|glomerular filtration)\b/i, unitHints: ["mL/min/1.73m2", "mL/min/1.73 m²", "mL/min"], knowledgeId: "lab_kidney" },
  { key: "creatinine", name: "Creatinine", aliases: /\b(creatinine|creat)\b/i, unitHints: ["mg/dL", "µmol/L", "umol/L"], knowledgeId: "lab_kidney" },
  { key: "uacr", name: "Urine albumin-to-creatinine ratio", aliases: /\b(uacr|acr|albumin\/creatinine|albumin creatinine ratio|microalbumin)\b/i, unitHints: ["mg/g", "mg/mmol"], knowledgeId: "lab_kidney" },
  { key: "tsh", name: "TSH (thyroid)", aliases: /\b(tsh|thyroid stimulating hormone)\b/i, unitHints: ["mIU/L", "uIU/mL", "µIU/mL"], knowledgeId: "lab_thyroid" },
  { key: "vitamin_b12", name: "Vitamin B12", aliases: /\b(b12|vitamin b12|cobalamin)\b/i, unitHints: ["pg/mL", "pmol/L"], knowledgeId: "lab_b12" },
  { key: "alt", name: "ALT (liver)", aliases: /\b(alt|sgpt|alanine aminotransferase)\b/i, unitHints: ["U/L", "IU/L"], knowledgeId: "lab_liver" },
  { key: "ast", name: "AST (liver)", aliases: /\b(ast|sgot|aspartate aminotransferase)\b/i, unitHints: ["U/L", "IU/L"], knowledgeId: "lab_liver" },
  { key: "potassium", name: "Potassium", aliases: /\b(potassium|k\+?)\b/i, unitHints: ["mmol/L", "mEq/L"], knowledgeId: "lab_electrolytes" },
  { key: "sodium", name: "Sodium", aliases: /\b(sodium|na\+?)\b/i, unitHints: ["mmol/L", "mEq/L"], knowledgeId: "lab_electrolytes" },
  { key: "vitamin_d", name: "Vitamin D (25-OH)", aliases: /\b(vitamin d|25-oh|25-hydroxy)\b/i, unitHints: ["ng/mL", "nmol/L"], knowledgeId: "lab_vitamin_d" },
];

export type ExtractedLab = {
  testKey: string | null;
  name: string;
  value: number;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  labFlag: string | null;
  rawLine: string;
  knowledgeId: string | null;
};

const UNIT_RE = /(%|mmol\/mol|mmol\/L|mg\/dL|mg\/g|mg\/mmol|mL\/min(?:\/1\.73\s*m[²2])?|µmol\/L|umol\/L|mIU\/L|uIU\/mL|µIU\/mL|pg\/mL|pmol\/L|U\/L|IU\/L|mEq\/L|ng\/mL|nmol\/L)/i;
const RANGE_RE = /(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/;
const LT_RE = /(?:<|less than|below)\s*(\d+(?:\.\d+)?)/i;
const GT_RE = /(?:>|greater than|above)\s*(\d+(?:\.\d+)?)/i;

export function extractLabs(text: string): ExtractedLab[] {
  const out: ExtractedLab[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Which test does this line name? First alias match by position wins, preferring longer names.
    let def: LabTestDef | null = null;
    let namePos = Infinity;
    for (const t of LAB_TESTS) {
      const m = line.match(t.aliases);
      if (m && m.index !== undefined && m.index < namePos) {
        // Avoid "glucose" swallowing an "A1C" line or "cholesterol" swallowing LDL/HDL lines.
        if (t.key === "fasting_glucose" && /a1c/i.test(line)) continue;
        if (t.key === "total_cholesterol" && /\b(ldl|hdl)\b/i.test(line)) continue;
        if ((t.key === "potassium" || t.key === "sodium") && !/\b(potassium|sodium)\b/i.test(line)) continue;
        def = t;
        namePos = m.index;
      }
    }
    // Numbers after the test name
    const rest = def ? line.slice(namePos + (line.match(def.aliases)?.[0].length ?? 0)) : line;
    const nums = [...rest.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => ({ v: parseFloat(m[0]), i: m.index ?? 0 }));
    if (!def || nums.length === 0) continue;

    const value = nums[0].v;
    const unitM = rest.match(UNIT_RE);
    const unit = unitM ? unitM[1].replace("umol", "µmol").replace("uIU", "µIU") : "";
    const afterValue = rest.slice(nums[0].i + String(nums[0].v).length);
    let refLow: number | null = null;
    let refHigh: number | null = null;
    const r = afterValue.match(RANGE_RE);
    if (r) {
      refLow = parseFloat(r[1]);
      refHigh = parseFloat(r[2]);
    } else {
      const lt = afterValue.match(LT_RE);
      const gt = afterValue.match(GT_RE);
      if (lt) refHigh = parseFloat(lt[1]);
      if (gt) refLow = parseFloat(gt[1]);
    }
    // The flag must be a standalone token, never a letter borrowed from a unit. mIU/L, mEq/L and
    // mg/dL all end in a letter a naive match reads as a flag, and printing "the lab marked this
    // L" for a flag no lab gave is a verdict this app cannot stand behind.
    const flagSearch = unitM ? afterValue.replace(unitM[1], " ") : afterValue;
    const flagM = flagSearch.match(/(?:^|[\s([])(HH|LL|HIGH|LOW|ABNORMAL|H|L)(?=[\s)\]*,.;]|$)/i);
    out.push({
      testKey: def.key,
      name: def.name,
      value,
      unit: unit || (def.key === "a1c" && value < 20 ? "%" : ""),
      refLow,
      refHigh,
      labFlag: flagM ? flagM[1].toUpperCase().slice(0, 1) : null,
      rawLine: line,
      knowledgeId: def.knowledgeId,
    });
  }
  return out;
}

/** eAG (estimated average glucose) from A1C: 28.7 × A1C − 46.7 (ADAG study). Educational only. */
export function a1cToEag(a1cPct: number): number {
  return Math.round(28.7 * a1cPct - 46.7);
}

/** IFCC mmol/mol from NGSP %: (A1C% − 2.15) × 10.929. */
export function a1cPctToMmolMol(pct: number): number {
  return Math.round((pct - 2.15) * 10.929);
}
