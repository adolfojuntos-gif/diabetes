import { test } from "node:test";
import assert from "node:assert/strict";
import { mgdlToMmol, mmolToMgdl, toMgdl, formatGlucose, bandOf, MGDL_PER_MMOL } from "../src/lib/units";

/**
 * Expected values worked out independently of the implementation:
 *   70 / 18.0156 = 3.8855  → 3.9      180 / 18.0156 = 9.9913 → 10.0
 *   54 / 18.0156 = 2.9974  → 3.0      250 / 18.0156 = 13.877 → 13.9
 *   5.5 * 18.0156 = 99.086 → 99       10.0 * 18.0156 = 180.156 → 180
 */
test("mg/dL to mmol/L matches the clinical anchor points", () => {
  assert.equal(mgdlToMmol(70), 3.9);
  assert.equal(mgdlToMmol(180), 10);
  assert.equal(mgdlToMmol(54), 3);
  assert.equal(mgdlToMmol(250), 13.9);
  assert.equal(mgdlToMmol(100), 5.6);
});

test("mmol/L to mg/dL matches the clinical anchor points", () => {
  assert.equal(mmolToMgdl(5.5), 99);
  assert.equal(mmolToMgdl(10), 180);
  assert.equal(mmolToMgdl(3.9), 70);
  assert.equal(mmolToMgdl(3), 54);
});

test("the conversion factor is the exact molar one, not the clinical shorthand 18", () => {
  assert.equal(MGDL_PER_MMOL, 18.0156);
});

test("toMgdl treats the person's unit as the input unit and always returns mg/dL", () => {
  assert.equal(toMgdl(120, "mgdl"), 120);
  assert.equal(toMgdl(6.7, "mmol"), 121); // 6.7 * 18.0156 = 120.70 → 121
  // A number typed in mmol must never be stored as if it were mg/dL.
  assert.notEqual(toMgdl(6.7, "mmol"), 7);
});

test("formatGlucose shows one decimal for mmol and none for mg/dL", () => {
  assert.equal(formatGlucose(121, "mmol"), "6.7");
  assert.equal(formatGlucose(121, "mgdl"), "121");
  assert.equal(formatGlucose(180, "mmol"), "10.0");
});

test("bands use the fixed clinical thresholds outside the personal target", () => {
  assert.equal(bandOf(53), "very_low");
  assert.equal(bandOf(54), "low");
  assert.equal(bandOf(69), "low");
  assert.equal(bandOf(70), "in_range");
  assert.equal(bandOf(180), "in_range");
  assert.equal(bandOf(181), "high");
  assert.equal(bandOf(250), "high");
  assert.equal(bandOf(251), "very_high");
});

test("a tighter personal target narrows only the in-range band, never the very-low threshold", () => {
  // Personal target 80–140.
  assert.equal(bandOf(75, 80, 140), "low");
  assert.equal(bandOf(150, 80, 140), "high");
  assert.equal(bandOf(53, 80, 140), "very_low");
  assert.equal(bandOf(60, 80, 140), "low", "60 is above 54, so it is level-1 low even with a tight target");
});
