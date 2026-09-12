import "server-only";
/**
 * Writing what the Fuel Forge makes.
 *
 * A forged recipe becomes an ordinary row in the carbohydrate reference, marked as the person's own.
 * Not a separate recipes table, and that is the whole design: the moment a pot of chili is a food,
 * it is already in the search box on every screen, it already works in Build Your Plate, the Food
 * Detective already matches it, and the Food Forest already grows from it. A parallel table would
 * have meant a parallel set of figures, and two sets of figures for one dinner is how somebody ends
 * up dosing against the wrong one.
 */
import { db, journeyAwards } from "../db";
import { newId } from "../ids";
import { addCustomFood } from "./foods";
import { provenance } from "../engines/rules";
import { recipeNote, type Forged, type ForgeIngredient } from "../engines/forge";
import { dateKey } from "../time";

/**
 * Paid for making the thing, not for what is in it.
 *
 * Once a day at most, whatever gets forged. Measuring a recipe once so it never has to be guessed
 * again is real work and worth marking; doing it eleven times in an evening is not eleven times the
 * work, and an app that pays by the row is an app that teaches people to file rows.
 */
export const FORGE_XP = 40;

export async function forgeRecipe(input: {
  name: string;
  ingredients: ForgeIngredient[];
  forged: Forged;
  now?: Date;
}): Promise<{ foodId: string }> {
  const now = input.now ?? new Date();
  const f = input.forged;

  const foodId = await addCustomFood({
    name: input.name,
    carbsG: f.per100.carbsG,
    proteinG: f.per100.proteinG,
    fatG: f.per100.fatG,
    fiberG: f.per100.fiberG,
    caloriesKcal: f.per100.caloriesKcal,
    portionLabel: "1 serving",
    portionGrams: f.servingGrams,
    /*
     * The recipe travels with the food. A figure somebody doses against in six months should be
     * able to say what it was made of and how it was divided, without which it is just a number
     * with nobody's name on it.
     */
    note: recipeNote(input.ingredients, f),
    extraPortions: f.servings > 1 ? [{ label: `the whole batch, ${f.servings} servings`, grams: f.basisGrams }] : [],
  });

  const prov = provenance({ sampleSize: input.ingredients.length, windowFrom: now, windowTo: now, dataQuality: "high" });
  await db
    .insert(journeyAwards)
    .values({
      id: newId(),
      key: `forge:${dateKey(now)}`,
      code: "forge",
      kind: "habit",
      title: "You measured something once so you never have to again",
      body: "Working a recipe out takes a while and then it is done. Every time you cook it from now on the figures are already there.",
      evidence: `forged ${input.name} from ${input.ingredients.length} ${input.ingredients.length === 1 ? "ingredient" : "ingredients"}, ${f.servings} ${f.servings === 1 ? "serving" : "servings"}`,
      xp: FORGE_XP,
      gems: 0,
      earnedAt: now,
      createdAt: now,
      seenAt: null,
      engineVersion: prov.engineVersion,
      ruleVersion: prov.ruleVersion,
      metricVersion: prov.metricVersion,
      sampleSize: prov.sampleSize,
      windowFrom: prov.windowFrom,
      windowTo: prov.windowTo,
      compareFrom: prov.compareFrom,
      compareTo: prov.compareTo,
      dataQuality: prov.dataQuality,
    })
    .onConflictDoNothing();

  return { foodId };
}
