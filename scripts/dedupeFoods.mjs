/**
 * Removes duplicate reference entries, keeping one row per food.
 *
 * A starter slice was inserted so the search could be exercised before the full reference existed,
 * and where the two overlap the same food now appears twice with slightly different figures. Two
 * different answers to "how many carbs is a carne asada taco" is worse than either answer alone, so
 * the duplicates go.
 *
 * Which one survives: the entry with more portions wins, then the one with the longer note, then
 * the lower id. Any `meal_items` rows pointing at a removed food are repointed at the survivor, so
 * no history is lost.
 */
import { createClient } from "@libsql/client";

const client = createClient({ url: process.env.DATABASE_URL ?? "file:./data/steady.db" });

const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[,()]/g, " ")
    .replace(/\b(cooked|raw|with skin|plain|one slice|regular)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const foods = (await client.execute("select id,name,note from foods where custom = 0")).rows;
const portionCounts = new Map();
for (const r of (await client.execute("select food_id, count(*) n from food_portions group by food_id")).rows) {
  portionCounts.set(String(r.food_id), Number(r.n));
}

const groups = new Map();
for (const f of foods) {
  const key = norm(String(f.name));
  groups.set(key, [...(groups.get(key) ?? []), { id: String(f.id), name: String(f.name), note: String(f.note ?? "") }]);
}

let removed = 0;
let repointed = 0;

for (const [key, rows] of groups) {
  if (rows.length < 2) continue;
  const ranked = [...rows].sort((a, b) => {
    const pa = portionCounts.get(a.id) ?? 0;
    const pb = portionCounts.get(b.id) ?? 0;
    if (pa !== pb) return pb - pa;
    if (a.note.length !== b.note.length) return b.note.length - a.note.length;
    return a.id < b.id ? -1 : 1;
  });
  const keep = ranked[0];
  const drop = ranked.slice(1);
  console.log(`"${key}": keeping ${keep.id}, removing ${drop.map((d) => d.id).join(", ")}`);
  for (const d of drop) {
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
console.log(`\nremoved ${removed} duplicate entries, repointed ${repointed} logged meals`);
console.log(`the reference now holds ${total} foods, one row per food`);
