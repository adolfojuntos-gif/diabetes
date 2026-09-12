/**
 * A starter slice of the carbohydrate reference, from before the full reference list existed.
 *
 * WHAT THIS IS FOR NOW: almost nothing. Every new account is seeded with all 174 reference foods by
 * `seedAccountReference`, so there is no longer a state where a database has search but no foods.
 * It is kept because the per-100g figures and the notes here are hand-checked against named sources,
 * and that is worth not throwing away.
 *
 * TWO BUGS FIXED HERE, and the second is the one that mattered.
 *
 * It opened `data/steady.db`, which since the database split is only the pre-migration backup, so
 * it wrote foods into a table no account reads and reported how many it had added.
 *
 * And it skipped a food only when the ID already existed. Six of the eight entries below share an
 * id with the canonical reference and were correctly skipped. Two do not: `egg-whole-cooked`
 * against the canonical `egg-cooked`, whose NAME is identical, and `bread-white` against
 * `white-bread`. So running this on a modern account inserted exactly two foods that then appeared
 * twice in search with different figures, which is the precise mess `foods:dedupe` was written to
 * clean up. A seeding script skipping on id alone cannot see that, so it now skips on name too.
 *
 *   npm run foods:starter -- you@example.com
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { clientFromArgv } from "./_account";
import { foodKey } from "./_foodName";

const USAGE = "npm run foods:starter -- you@example.com";

const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const newId = (n = 14) => Array.from(randomBytes(n), (b) => A[b & 63]).join("");

const SR = "USDA FoodData Central (SR Legacy)";
const FN = "USDA FoodData Central (Survey FNDDS)";
const LB = "Manufacturer label";

type Starter = {
  id: string;
  name: string;
  category: string;
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  kcal: number;
  aliases: string;
  source: string;
  aisle: string;
  note: string;
  portions: [string, number][];
};

const FOODS = [
  { id: "rice-white-cooked", name: "Rice, white, cooked", category: "grains and starches", carbs: 28, protein: 2.7, fat: 0.3, fiber: 0.4, kcal: 130, aliases: "arroz,arroz blanco,white rice", source: SR, aisle: "grains", note: "Mostly starch with very little fibre, so the portion is what decides the rise.", portions: [["1/2 cup cooked", 79], ["1 cup cooked", 158], ["restaurant scoop", 250]] },
  { id: "rice-brown-cooked", name: "Rice, brown, cooked", category: "grains and starches", carbs: 25.6, protein: 2.7, fat: 1, fiber: 1.6, kcal: 123, aliases: "arroz integral,brown rice", source: SR, aisle: "grains", note: "A little more fibre than white rice, which softens the rise slightly at the same portion.", portions: [["1/2 cup cooked", 98], ["1 cup cooked", 195]] },
  { id: "tortilla-corn", name: "Tortilla, corn", category: "breads and tortillas", carbs: 44.6, protein: 5.7, fat: 4.1, fiber: 6.3, kcal: 237, aliases: "tortilla de maiz,corn tortilla,tortillas", source: SR, aisle: "grains", note: "Small and fibrous for its weight, so two corn tortillas land gentler than one large flour one.", portions: [["1 tortilla (6 inch)", 26], ["2 tortillas", 52], ["3 tortillas", 78]] },
  { id: "tortilla-flour", name: "Tortilla, flour", category: "breads and tortillas", carbs: 49.4, protein: 8.2, fat: 7.1, fiber: 2.9, kcal: 304, aliases: "tortilla de harina,flour tortilla", source: SR, aisle: "grains", note: "Refined flour with little fibre, and the big ones weigh far more than they look.", portions: [["1 tortilla (8 inch)", 45], ["1 burrito size (10 inch)", 72]] },
  { id: "black-beans-cooked", name: "Black beans, cooked", category: "beans and legumes", carbs: 23.7, protein: 8.9, fat: 0.5, fiber: 8.7, kcal: 132, aliases: "frijoles negros,frijol,black beans", source: SR, aisle: "pantry", note: "High fibre and protein alongside the starch, which is why beans usually land slowly.", portions: [["1/2 cup", 86], ["1 cup", 172]] },
  { id: "refried-beans", name: "Refried beans", category: "beans and legumes", carbs: 13.3, protein: 5.3, fat: 1.7, fiber: 4.7, kcal: 91, aliases: "frijoles refritos,refried beans", source: FN, aisle: "pantry", note: "Still fibrous, though added fat changes how long the meal takes to finish.", portions: [["1/2 cup", 119], ["1 cup", 238]] },
  { id: "burrito-bean-cheese", name: "Bean and cheese burrito", category: "mexican dishes", carbs: 29.5, protein: 9.4, fat: 9.1, fiber: 3.3, kcal: 240, aliases: "burrito de frijol con queso,bean burrito", source: FN, aisle: "other", note: "A large tortilla is most of the carbohydrate here, and the beans and cheese slow it down.", portions: [["1 burrito", 198], ["1 large burrito", 280]] },
  { id: "taco-carne-asada", name: "Carne asada taco", category: "mexican dishes", carbs: 17.4, protein: 12.8, fat: 8.6, fiber: 2.4, kcal: 203, aliases: "taco de carne asada,steak taco", source: FN, aisle: "other", note: "Nearly all the carbohydrate is the tortilla, so the count scales with how many you eat.", portions: [["1 taco", 92], ["2 tacos", 184], ["3 tacos", 276]] },
  { id: "pizza-cheese-slice", name: "Cheese pizza, one slice", category: "prepared dishes", carbs: 28.3, protein: 11.4, fat: 10.1, fiber: 1.9, kcal: 266, aliases: "pizza de queso,cheese pizza", source: FN, aisle: "frozen", note: "Fat and protein alongside a refined crust, which often pushes the peak later than expected.", portions: [["1 slice (medium)", 107], ["2 slices", 214]] },
  { id: "spaghetti-meat-sauce", name: "Spaghetti with meat sauce", category: "prepared dishes", carbs: 17.4, protein: 6.6, fat: 3.7, fiber: 1.7, kcal: 131, aliases: "espagueti con carne,spaghetti bolognese,pasta with meat sauce", source: FN, aisle: "pantry", note: "A restaurant plate is often two or three times a measured cup, which is where the carbs hide.", portions: [["1 cup", 250], ["restaurant plate", 450]] },
  { id: "pad-thai-chicken", name: "Chicken pad thai", category: "asian dishes", carbs: 21.2, protein: 8.4, fat: 5.9, fiber: 1.5, kcal: 175, aliases: "pad thai de pollo,pad thai", source: FN, aisle: "other", note: "Rice noodles plus sugar in the sauce, so the carbohydrate is higher than the vegetables suggest.", portions: [["1 cup", 200], ["restaurant portion", 400]] },
  { id: "banana", name: "Banana", category: "fruit", carbs: 22.8, protein: 1.1, fat: 0.3, fiber: 2.6, kcal: 89, aliases: "platano,banana,guineo", source: SR, aisle: "produce", note: "Carbohydrate rises as it ripens, so a spotted banana behaves differently from a green one.", portions: [["1 medium", 118], ["1 large", 136], ["1 small", 101]] },
  { id: "apple", name: "Apple, with skin", category: "fruit", carbs: 13.8, protein: 0.3, fat: 0.2, fiber: 2.4, kcal: 52, aliases: "manzana,apple", source: SR, aisle: "produce", note: "The skin carries most of the fibre, which is part of why whole fruit lands slower than juice.", portions: [["1 medium", 182], ["1 large", 223]] },
  { id: "chicken-breast-cooked", name: "Chicken breast, cooked", category: "protein and meat", carbs: 0, protein: 31, fat: 3.6, fiber: 0, kcal: 165, aliases: "pollo,pechuga de pollo,chicken breast", source: SR, aisle: "protein", note: "No carbohydrate at all, and protein alongside a meal tends to slow the whole thing down.", portions: [["1 breast", 172], ["4 oz", 113]] },
  { id: "egg-whole-cooked", name: "Egg, whole, cooked", category: "breakfast", carbs: 1.1, protein: 12.6, fat: 10.6, fiber: 0, kcal: 155, aliases: "huevo,huevos,egg,eggs", source: SR, aisle: "dairy", note: "Almost no carbohydrate, which is why eggs are a common anchor for a gentler breakfast.", portions: [["1 large egg", 50], ["2 eggs", 100], ["3 eggs", 150]] },
  { id: "orange-juice", name: "Orange juice", category: "drinks", carbs: 10.4, protein: 0.7, fat: 0.2, fiber: 0.2, kcal: 45, aliases: "jugo de naranja,orange juice,zumo", source: SR, aisle: "drinks", note: "Liquid sugar with the fibre removed, so it arrives fast. It is also what many people use to treat a low.", portions: [["1 cup", 248], ["small glass", 180]] },
  { id: "cola-regular", name: "Cola, regular", category: "drinks", carbs: 10.6, protein: 0, fat: 0, fiber: 0, kcal: 41, aliases: "coca,refresco,soda,cola", source: LB, aisle: "drinks", note: "Sugar in liquid form with nothing to slow it, which makes it useful for a low and difficult otherwise.", portions: [["12 oz can", 355], ["20 oz bottle", 591]] },
  { id: "potato-chips", name: "Potato chips", category: "snacks and sweets", carbs: 52.9, protein: 6.6, fat: 34.6, fiber: 4.4, kcal: 536, aliases: "papas fritas,chips,potato chips", source: SR, aisle: "snacks", note: "Starch plus a lot of fat, so the rise is usually slower but longer than the carb count suggests.", portions: [["small bag (1 oz)", 28], ["handful", 15]] },
  { id: "bread-white", name: "Bread, white", category: "breads and tortillas", carbs: 49.2, protein: 7.6, fat: 3.3, fiber: 2.3, kcal: 266, aliases: "pan blanco,white bread,pan de caja", source: SR, aisle: "grains", note: "Two slices is a common serving and roughly the carbohydrate of a cup of cooked rice.", portions: [["1 slice", 25], ["2 slices", 50]] },
  { id: "oatmeal-cooked", name: "Oatmeal, cooked", category: "breakfast", carbs: 12, protein: 2.5, fat: 1.4, fiber: 1.7, kcal: 71, aliases: "avena,oatmeal,oats", source: SR, aisle: "grains", note: "Soluble fibre is what makes plain oats behave differently from instant sweetened packets.", portions: [["1 cup", 234], ["1/2 cup", 117]] },
];

async function main() {
  const { client } = await clientFromArgv(USAGE);
  try {
    const rows = (await client.execute("select id,name from foods")).rows;
    const haveId = new Set(rows.map((r) => String(r.id)));
    const haveName = new Map(rows.map((r) => [foodKey(String(r.name)), String(r.id)]));

    const now = Math.floor(Date.now() / 1000);
    let added = 0;
    let portions = 0;
    let skippedById = 0;
    const skippedByName: string[] = [];

    for (const f of FOODS as Starter[]) {
      if (haveId.has(f.id)) {
        skippedById++;
        continue;
      }
      /**
       * The guard that stops this script recreating the duplicate problem. A food already present
       * under a different id is the same food, and inserting it gives search two answers to one
       * question, which is worse than either answer alone.
       */
      const clash = haveName.get(foodKey(f.name));
      if (clash) {
        skippedByName.push(`${f.id} would duplicate ${clash} ("${f.name}")`);
        continue;
      }

      await client.execute({
        sql:
          "insert into foods (id,name,brand,category,carbs_g,protein_g,fat_g,fiber_g,calories_kcal,aliases,source,aisle,note,custom,times_used,last_used_at,created_at)" +
          " values (?,?,null,?,?,?,?,?,?,?,?,?,?,0,0,null,?)",
        args: [f.id, f.name, f.category, f.carbs, f.protein, f.fat, f.fiber, f.kcal, f.aliases, f.source, f.aisle, f.note, now],
      });
      added++;
      let sort = 0;
      for (const [label, grams] of f.portions) {
        await client.execute({
          sql: "insert into food_portions (id,food_id,label,grams,sort,custom) values (?,?,?,?,?,0)",
          args: [newId(), f.id, label, grams, sort++],
        });
        portions++;
      }
    }

    const total = (await client.execute("select count(*) n from foods")).rows[0].n;
    console.log(`starter reference: ${added} foods added, ${portions} portions. This account now holds ${total} foods.`);
    console.log(`skipped ${skippedById} already present by id.`);
    for (const s of skippedByName) console.log(`  skipped ${s}`);
    if (added === 0) {
      console.log(`
Nothing to add. The canonical reference already covers all of this, which is expected.`);
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
