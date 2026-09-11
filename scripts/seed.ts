/**
 * Seeds the content tables and creates the single profile row. Idempotent: run it as often as
 * you like. It creates NO sample readings, meals or insulin — a diabetes app seeded with invented
 * numbers would show invented patterns, which is the one thing this app must never do.
 *
 * For a populated demo, run `npm run demo` instead, which labels itself clearly.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, profile, recipes, exerciseIdeas, packingItems, trips } from "../src/lib/db";
import { RECIPES } from "../src/lib/data/seed/recipes";
import { EXERCISE_IDEAS } from "../src/lib/data/seed/exerciseIdeas";
import { PACKING_TEMPLATE } from "../src/lib/data/seed/packing";
import { newId } from "../src/lib/ids";

async function main() {
  const now = new Date();

  const existingProfile = await db.select().from(profile).where(eq(profile.id, 1)).limit(1);
  if (!existingProfile[0]) {
    await db.insert(profile).values({ id: 1, createdAt: now, updatedAt: now });
    console.log("profile: created (onboarding will ask for the details)");
  } else {
    console.log("profile: already exists, left alone");
  }

  let r = 0;
  for (const rec of RECIPES) {
    const res = await db.insert(recipes).values(rec).onConflictDoNothing();
    if ((res as { rowsAffected?: number }).rowsAffected) r++;
  }
  console.log(`recipes: ${r} added, ${RECIPES.length - r} already present`);

  let e = 0;
  for (const idea of EXERCISE_IDEAS) {
    const res = await db.insert(exerciseIdeas).values(idea).onConflictDoNothing();
    if ((res as { rowsAffected?: number }).rowsAffected) e++;
  }
  console.log(`exercise ideas: ${e} added, ${EXERCISE_IDEAS.length - e} already present`);

  // Packing items have generated ids, so seed only when the template rows are absent.
  const existingPacking = await db.select({ label: packingItems.label }).from(packingItems);
  const have = new Set(existingPacking.map((x) => x.label.toLowerCase()));
  let p = 0;
  for (const item of PACKING_TEMPLATE) {
    if (have.has(item.label.toLowerCase())) continue;
    await db.insert(packingItems).values({ ...item, id: newId() });
    p++;
  }
  console.log(`packing items: ${p} added, ${PACKING_TEMPLATE.length - p} already present`);

  const existingTrip = await db.select().from(trips).where(eq(trips.id, 1)).limit(1);
  if (!existingTrip[0]) {
    await db.insert(trips).values({ id: 1, name: "", days: 7, spareFraction: 0.5, updatedAt: now });
    console.log("trip: created (7 days, 50% spare)");
  }

  console.log("\nNo readings, meals or insulin were created. Those are yours to log.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
