import "server-only";
/**
 * FOOD DETECTIVE. "Show me what you're eating."
 *
 * THE MODEL IDENTIFIES AND THE REFERENCE MEASURES, and the split is the whole point of this file.
 *
 * It used to ask the model for carbohydrate and calories directly and pass `Number(i.carbsG)`
 * through to somebody who may be counting carbohydrate to decide an insulin dose. A vision model
 * is genuinely good at recognising a tortilla and has no way to know how many grams of
 * carbohydrate are in one, so that figure was a guess dressed as a measurement, with nothing in
 * the pipeline able to catch a wrong one.
 *
 * Now it is asked for NAMES, PORTIONS AND CONFIDENCE and nothing else. The names are matched
 * against the carbohydrate reference by `engines/detective.ts`, and every gram comes from a USDA
 * or published figure. Anything the reference does not hold comes back with no number at all,
 * which is honest and is what makes this safe in front of somebody who doses.
 *
 * The person corrects everything before it is saved. The photo is never stored.
 */
import { aiAvailable, aiClient, AI_MODEL, textOf, extractJson } from "./client";
import { filterDoseLanguage, softenCertainty } from "./filter";
import { recordAiUse, checkSpendLimit } from "../data/aiAudit";
import { db, foods, foodPortions } from "../db";
import { investigate, totals, coverageNote, type Identified } from "../engines/detective";

/**
 * What one identified item looks like after the reference has been consulted.
 *
 * `carbsG` and `caloriesKcal` are NULL when nothing matched. Not zero: null. A zero would add
 * nothing to a total and look like a measured figure, and the difference between those two things
 * is the entire safety argument here.
 */
export type EstimatedItem = {
  name: string;
  portion: string;
  carbsG: number | null;
  caloriesKcal: number | null;
  confidence: "low" | "medium" | "high";
  /** The reference row the figures came from, or null when there was no match. */
  matchedName: string | null;
  /** Where that row's figures come from, so the person can see what they are trusting. */
  source: string | null;
  match: "none" | "weak" | "good";
};

export type MealEstimate =
  | { items: EstimatedItem[]; totalCarbsG: number; totalCaloriesKcal: number; note: string; model: string }
  | { error: string };

const MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function estimateMealFromPhoto(base64: string, mediaType: string): Promise<MealEstimate> {
  if (!aiAvailable()) return { error: "Photo estimates need an API key. You can still log the meal by hand." };
  if (!MEDIA.has(mediaType)) return { error: "Please use a JPEG, PNG or WebP photo." };

  // Metered. A photo estimate is the cheapest thing in this app to trigger and one of the more
  // expensive to serve, which is the wrong way round for an endpoint behind a shared passphrase.
  const limit = await checkSpendLimit("photo");
  if (!limit.allowed) return { error: limit.message };
  try {
    const res = await aiClient().messages.create({
      model: AI_MODEL,
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system:
        "You identify food in a photo for a diabetes app. Name each food you can see and describe roughly how much of it there is, with a confidence of low, medium or high.\n\nYOU DO NOT GIVE NUTRITION FIGURES. Do not state carbohydrate, calories, protein, fat or fibre, in the names, the portions or the note. Those come from a separate carbohydrate reference and are not your job. A camera cannot know them and a guess at them is dangerous, because somebody may count carbohydrate to decide an insulin dose.\n\nName foods in the way a reference would list them, plainly and in the singular where you can: say 'corn tortilla' rather than 'delicious homemade tortillas'. Put any count in the portion instead: '2 tortillas', 'a scoop', 'half a plate'. Be honest in the confidence; sauces, oils and portion depth are usually invisible.\n\nNever give medical or dosing advice. Respond with JSON only: {\"items\":[{\"name\":\"\",\"portion\":\"\",\"confidence\":\"low|medium|high\"}],\"note\":\"one sentence on what is hard to see in this photo\"}. If there is no food in the image, return {\"items\":[],\"note\":\"No food visible.\"}.",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: base64 } },
            { type: "text", text: "What foods are in this photo, and roughly how much of each?" },
          ],
        },
      ],
    });
    if (res.stop_reason === "refusal") return { error: "The model declined to analyse this image." };
    const parsed = extractJson<{ items?: Identified[]; note?: string }>(textOf(res));
    if (!parsed || !Array.isArray(parsed.items)) return { error: "Couldn't read an identification from the model. Try another photo or log by hand." };

    /*
     * Only three fields are read off the model, and any nutrition figure it volunteered against
     * instruction is dropped here rather than trusted. A prompt is a request; this is the part
     * that makes it a guarantee.
     */
    const identified: Identified[] = parsed.items
      .filter((i) => i && typeof i.name === "string" && i.name.trim().length > 0)
      .slice(0, 12)
      .map((i) => ({
        name: String(i.name).slice(0, 80),
        portion: String(i.portion ?? "").slice(0, 60),
        confidence: (["low", "medium", "high"] as const).includes(i.confidence) ? i.confidence : "low",
      }));

    // THE REFERENCE MEASURES. Every figure below this line comes out of the food table.
    const [foodRows, portionRows] = await Promise.all([
      db.select().from(foods),
      db.select({ id: foodPortions.id, foodId: foodPortions.foodId, label: foodPortions.label, grams: foodPortions.grams, sort: foodPortions.sort }).from(foodPortions),
    ]);
    const matched = investigate({ identified, foods: foodRows, portions: portionRows });
    const t = totals(matched);
    const items: EstimatedItem[] = matched.map((m) => ({
      name: m.identified.name,
      portion: m.portion ? `${m.count > 1 ? `${m.count} × ` : ""}${m.portion.label}` : m.identified.portion,
      carbsG: m.figures ? m.figures.carbsG : null,
      caloriesKcal: m.figures ? m.figures.caloriesKcal : null,
      confidence: m.identified.confidence,
      matchedName: m.food ? m.food.name : null,
      source: m.food ? m.food.source : null,
      match: m.match,
    }));
    /**
     * The note is free model prose that a person reads, so it gets the same guard as anything else
     * a model writes here. The system prompt forbids dosing advice, and the entire premise of the
     * filter is that a prompt is not enough.
     */
    /*
     * The coverage line comes FIRST and is the engine's, not the model's. It is the sentence that
     * says whether the total below can be relied on, and it must not be something a model can
     * soften. The model's own note follows it as colour.
     */
    const rawNote = `${coverageNote(matched)} ${String(parsed.note ?? "").slice(0, 200)}`.trim();
    const filteredNote = filterDoseLanguage(rawNote);
    const note = softenCertainty(filteredNote.text).text;

    // A carbohydrate number somebody eats against is a clinically relevant AI response, so it is
    // audited like one. This path used to leave no trace at all.
    await recordAiUse({
      feature: "photo",
      mode: "talk",
      userQuestion: "photo estimate: what am I eating?",
      dataAccessed: ["meal photo (not stored)", "foods:reference", "food_portions"],
      triageLevel: "general",
      responder: "model",
      model: AI_MODEL,
      filtered: filteredNote.filtered,
    });

    return {
      items,
      totalCarbsG: t.carbsG,
      totalCaloriesKcal: t.caloriesKcal,
      note,
      model: AI_MODEL,
    };
  } catch (err) {
    return { error: `Couldn't reach the model (${err instanceof Error ? err.message.slice(0, 80) : "error"}). Log the meal by hand.` };
  }
}
