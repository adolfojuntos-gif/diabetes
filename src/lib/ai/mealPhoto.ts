import "server-only";
/**
 * "Show me what you're eating." The model identifies likely foods in a photo and gives ESTIMATES
 * of carbohydrate and calories with a confidence per item. The person corrects them before
 * anything is saved. The photo is never stored — only the accepted items.
 */
import { aiAvailable, aiClient, AI_MODEL, textOf, extractJson } from "./client";
import { filterDoseLanguage, softenCertainty } from "./filter";
import { recordAiUse, checkSpendLimit } from "../data/aiAudit";

export type EstimatedItem = { name: string; portion: string; carbsG: number; caloriesKcal: number; confidence: "low" | "medium" | "high" };
export type MealEstimate = { items: EstimatedItem[]; totalCarbsG: number; totalCaloriesKcal: number; note: string; model: string } | { error: string };

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
        "You estimate food from a photo for a diabetes app. Identify the likely foods and give a rough portion, carbohydrate grams and calories for each, with a confidence of low, medium or high. These are ESTIMATES: a camera cannot know exact nutrition, hidden ingredients, sauces or portion depth. Be conservative and honest; when unsure, say so in the confidence and the note. Never give medical or dosing advice. Respond with JSON only: {\"items\":[{\"name\":\"\",\"portion\":\"\",\"carbsG\":0,\"caloriesKcal\":0,\"confidence\":\"low|medium|high\"}],\"note\":\"one sentence on what makes this estimate uncertain\"}. If there is no food in the image, return {\"items\":[],\"note\":\"No food visible.\"}.",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: base64 } },
            { type: "text", text: "What am I eating? Estimate carbs and calories per item." },
          ],
        },
      ],
    });
    if (res.stop_reason === "refusal") return { error: "The model declined to analyse this image." };
    const parsed = extractJson<{ items?: EstimatedItem[]; note?: string }>(textOf(res));
    if (!parsed || !Array.isArray(parsed.items)) return { error: "Couldn't read an estimate from the model. Try another photo or log by hand." };
    const items = parsed.items
      .filter((i) => i && typeof i.name === "string")
      .map((i) => ({
        name: String(i.name).slice(0, 80),
        portion: String(i.portion ?? "").slice(0, 60),
        carbsG: Math.max(0, Math.round(Number(i.carbsG) || 0)),
        caloriesKcal: Math.max(0, Math.round(Number(i.caloriesKcal) || 0)),
        confidence: (["low", "medium", "high"] as const).includes(i.confidence) ? i.confidence : "low",
      }));
    /**
     * The note is free model prose that a person reads, so it gets the same guard as anything else
     * a model writes here. The system prompt forbids dosing advice, and the entire premise of the
     * filter is that a prompt is not enough.
     */
    const rawNote = String(parsed.note ?? "Estimates only. Correct anything that looks off.").slice(0, 300);
    const filteredNote = filterDoseLanguage(rawNote);
    const note = softenCertainty(filteredNote.text).text;

    // A carbohydrate number somebody eats against is a clinically relevant AI response, so it is
    // audited like one. This path used to leave no trace at all.
    await recordAiUse({
      feature: "photo",
      mode: "talk",
      userQuestion: "photo estimate: what am I eating?",
      dataAccessed: ["meal photo (not stored)"],
      triageLevel: "general",
      responder: "model",
      model: AI_MODEL,
      filtered: filteredNote.filtered,
    });

    return {
      items,
      totalCarbsG: items.reduce((a, i) => a + i.carbsG, 0),
      totalCaloriesKcal: items.reduce((a, i) => a + i.caloriesKcal, 0),
      note,
      model: AI_MODEL,
    };
  } catch (err) {
    return { error: `Couldn't reach the model (${err instanceof Error ? err.message.slice(0, 80) : "error"}). Log the meal by hand.` };
  }
}
