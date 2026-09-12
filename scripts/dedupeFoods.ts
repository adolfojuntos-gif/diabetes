/**
 * Removes duplicate reference entries from ONE account, keeping one row per food.
 *
 * The original mess: a starter slice of foods was inserted so search could be exercised before the
 * full reference existed, and where the two overlapped the same food appeared twice with slightly
 * different figures. Two different answers to "how many carbs is a carne asada taco" is worse than
 * either answer alone, so the duplicates go.
 *
 * Which one survives, in order: a canonical id from `SEED_FOODS` beats anything else, then more
 * portions, then the longer note, then the lower id. Any `meal_items` rows pointing at a removed
 * food are repointed at the survivor, so no logged history is lost.
 *
 * Takes an ACCOUNT, because the reference is copied into each account's own database rather than
 * shared. It used to open `data/steady.db`, which since the split is only the pre-migration backup,
 * so it deduplicated a table nothing reads and reported how many rows it had fixed.
 *
 * Safe to re-run: with no duplicates it removes nothing and says so. It also reports rather than
 * deletes unless given `--apply`.
 *
 *   npm run foods:dedupe -- you@example.com
 *   npm run foods:dedupe -- you@example.com --apply
 */
import "dotenv/config";
import { clientFromArgv } from "./_account";
import { foodKey } from "./_foodName";
import { SEED_FOODS } from "../src/lib/data/seed/foods";

const USAGE = "npm run foods:dedupe -- you@example.com";

/**
 * REPORTS BY DEFAULT. Deleting needs `--apply`.
 *
 * This removes rows and repoints logged meals at a survivor, and the grouping it does that on is
 * deliberately fuzzy, because word order is exactly what the real duplicates differ by. Fuzzy plus
 * destructive plus silent is the combination worth not having, so the default run prints what it
 * would do and changes nothing.
 *
 * Grouping used to be this script's own normaliser, which kept word order and therefore did not
 * see "White rice, cooked" and "Rice, white, cooked" as the same food. That is now `foodKey`,
 * shared with the seeding script so the two cannot disagree about what a duplicate is.
 */
const APPLY = process.argv.includes("--apply");

/** The ids the reference itself defines. A row with one of these will be re-created if deleted. */
const canonical = new Set(SEED_FOODS.map((f) => f.id));

async function main() {
  const { client } = await clientFromArgv(USAGE);
  try {
    const foods = (await client.execute("select id,name,note from foods where custom = 0")).rows;
    const portionCounts = new Map<string, number>();
    for (const r of (await client.execute("select food_id, count(*) n from food_portions group by food_id")).rows) {
      portionCounts.set(String(r.food_id), Number(r.n));
    }

    const groups = new Map<string, { id: string; name: string; note: string }[]>();
    for (const f of foods) {
      const key = foodKey(String(f.name));
      groups.set(key, [...(groups.get(key) ?? []), { id: String(f.id), name: String(f.name), note: String(f.note ?? "") }]);
    }

    let removed = 0;
    let repointed = 0;

    for (const [key, rows] of groups) {
      if (rows.length < 2) continue;
      const ranked = [...rows].sort((a, b) => {
        /**
         * A CANONICAL ID WINS, ahead of everything else.
         *
         * Without this the ranking picked on portion count and note length, and for the tortillas
         * that chose the old starter row over the reference one. Deleting a canonical row does not
         * hold: `seed:foods` and the next signup both re-add it from `SEED_FOODS`, so the duplicate
         * comes back and this script has to be run again, forever. Keeping the canonical row is the
         * only choice that is stable under re-seeding.
         */
        const ca = canonical.has(a.id);
        const cb = canonical.has(b.id);
        if (ca !== cb) return ca ? -1 : 1;

        const pa = portionCounts.get(a.id) ?? 0;
        const pb = portionCounts.get(b.id) ?? 0;
        if (pa !== pb) return pb - pa;
        if (a.note.length !== b.note.length) return b.note.length - a.note.length;
        return a.id < b.id ? -1 : 1;
      });
      const keep = ranked[0];
      const drop = ranked.slice(1);
      console.log(
        `"${key}": keeping ${keep.id} ("${keep.name}"), ${APPLY ? "removing" : "would remove"} ${drop
          .map((d) => `${d.id} ("${d.name}")`)
          .join(", ")}`,
      );
      if (!APPLY) {
        removed += drop.length;
        continue;
      }
      for (const d of drop) {
        // Repoint the logged meals BEFORE deleting, or the history loses what it was pointing at.
        const r = await client.execute({ sql: "update meal_items set food_id = ? where food_id = ?", args: [keep.id, d.id] });
        repointed += Number(r.rowsAffected ?? 0);
        await client.execute({ sql: "delete from food_portions where food_id = ?", args: [d.id] });
        await client.execute({ sql: "delete from foods where id = ?", args: [d.id] });
        removed++;
      }
      await client.execute({
        sql: "update foods set times_used = (select count(*) from meal_items where food_id = ?) where id = ?",
        args: [keep.id, keep.id],
      });
    }

    const total = (await client.execute("select count(*) n from foods")).rows[0].n;
    if (removed === 0) {
      console.log(`\nNo duplicates. The reference holds ${total} foods, one row per food.`);
    } else if (APPLY) {
      console.log(`\nremoved ${removed} duplicate entries, repointed ${repointed} logged meals`);
      console.log(`the reference now holds ${total} foods, one row per food`);
    } else {
      console.log(`\n${removed} duplicate entries found. Nothing was changed.`);
      console.log(`Re-run with --apply to remove them:  ${USAGE} --apply`);
    }
  } finally {
    try {
      client.close();
    } catch {
      /* a handle that will not close is not worth failing over */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
