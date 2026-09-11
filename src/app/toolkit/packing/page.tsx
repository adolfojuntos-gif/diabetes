/**
 * The travel packing checklist. Quantities are worked out from the length of the trip and a spare
 * margin the person picks. Nothing here says when to take anything: travel and time-zone questions
 * about medication timing are written as a question for the care team.
 */
import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, packingItems, trips, PACKING_CATEGORIES, type PackingCategory, type PackingItem, type Profile } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { getProfile } from "@/lib/data/snapshot";
import { newId } from "@/lib/ids";
import { parseForm, zNum, zOptNum, zStr, zOptStr } from "@/lib/actions";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { FormError, param, type SP } from "../_shared/ui";
import { failTo } from "../_shared/server";
import { PrintButton } from "../_shared/client";

const PATH = "/toolkit/packing";

const CATEGORY_LABEL: Record<PackingCategory, string> = {
  glucose_monitoring: "Glucose monitoring",
  insulin_and_delivery: "Insulin and delivery",
  lows_kit: "Lows kit",
  documents: "Documents",
  food_and_drink: "Food and drink",
  comfort_and_care: "Comfort and care",
  tech: "Tech",
};

const SPARE_OPTIONS = [
  { value: "0.25", label: "25% spare" },
  { value: "0.5", label: "50% spare" },
  { value: "1", label: "100% spare (double)" },
];

/* ------------------------------- actions ------------------------------- */

async function saveTrip(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(
    z.object({
      name: zStr(120),
      days: zNum(1, 120),
      spareFraction: z.enum(["0.25", "0.5", "1"]),
    }),
    fd,
  );
  if ("error" in r) failTo(PATH, r.error);
  const now = new Date();
  await db
    .insert(trips)
    .values({ id: 1, name: r.data.name, days: Math.round(r.data.days), spareFraction: Number(r.data.spareFraction), updatedAt: now })
    .onConflictDoUpdate({
      target: trips.id,
      set: { name: r.data.name, days: Math.round(r.data.days), spareFraction: Number(r.data.spareFraction), updatedAt: now },
    });
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function toggleItem(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(z.object({ id: zStr(40), next: z.enum(["0", "1"]) }), fd);
  if ("error" in r) failTo(PATH, r.error);
  await db.update(packingItems).set({ checked: r.data.next === "1" }).where(eq(packingItems.id, r.data.id));
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function addCustom(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(
    z.object({
      label: zStr(120),
      category: z.enum(PACKING_CATEGORIES),
      perDay: zOptNum(0, 100),
      unit: zOptStr(24),
      tip: zOptStr(300),
    }),
    fd,
  );
  if ("error" in r) failTo(PATH, r.error);
  if (r.data.label.trim().length < 2) failTo(PATH, "Give the item a name.");
  await db.insert(packingItems).values({
    id: newId(),
    category: r.data.category,
    label: r.data.label.trim(),
    perDay: r.data.perDay,
    unit: r.data.unit,
    tip: r.data.tip,
    onlyIf: null,
    custom: true,
    checked: false,
    sort: 900,
  });
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function deleteCustom(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(z.object({ id: zStr(40) }), fd);
  if ("error" in r) failTo(PATH, r.error);
  await db.delete(packingItems).where(and(eq(packingItems.id, r.data.id), eq(packingItems.custom, true)));
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function uncheckAll() {
  "use server";
  return requireAccount(async () => {
  await db.update(packingItems).set({ checked: false });
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

/* -------------------------------- helpers -------------------------------- */

function showsFor(item: PackingItem, p: Profile): boolean {
  if (!item.onlyIf) return true;
  if (item.onlyIf === "insulin") return p.insulinRegimen !== "none";
  if (item.onlyIf === "pump") return p.insulinRegimen === "pump";
  if (item.onlyIf === "cgm") return p.usesCgm;
  return true;
}

function quantity(item: PackingItem, days: number, spare: number): string | null {
  if (item.perDay === null) return null;
  const n = Math.ceil(item.perDay * days * (1 + spare));
  return `${n}${item.unit ? ` ${item.unit}` : ""}`;
}

/* --------------------------------- page --------------------------------- */

export default async function PackingPage({ searchParams }: { searchParams?: SP }) {
  const error = await param(searchParams, "e");
  return requireAccount(async () => {
  const profile = await getProfile();

  const [tripRows, items] = await Promise.all([
    db.select().from(trips).where(eq(trips.id, 1)).limit(1),
    db.select().from(packingItems).orderBy(asc(packingItems.sort), asc(packingItems.label)),
  ]);

  const trip = tripRows[0] ?? { id: 1, name: "", days: 7, spareFraction: 0.5, updatedAt: new Date() };
  const visible = items.filter((i) => showsFor(i, profile));
  const packed = visible.filter((i) => i.checked).length;
  const spareValue = SPARE_OPTIONS.some((o) => Number(o.value) === trip.spareFraction) ? String(trip.spareFraction) : "0.5";

  return (
    <div className="page">
      <PageHeader
        eyebrow="Toolkit"
        title="Packing for a trip"
        lede="Tell Steady how long you are away and it works out how many of each consumable to count out, with a spare margin."
        action={
          visible.length > 0 ? (
            <div className="no-print flex gap-2">
              <form action={uncheckAll}>
                <SubmitButton className="btn btn-secondary" pendingText="Clearing…">
                  Uncheck all
                </SubmitButton>
              </form>
              <PrintButton className="btn btn-secondary" />
            </div>
          ) : undefined
        }
      />

      <FormError message={error} />

      <Card className="no-print">
        <h2>This trip</h2>
        <form action={saveTrip} className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="field">
            <label className="label" htmlFor="trip-name">
              Where are you going
            </label>
            <input id="trip-name" name="name" className="input" defaultValue={trip.name} maxLength={120} placeholder="Lisbon" />
          </div>
          <div className="field">
            <label className="label" htmlFor="trip-days">
              How many days
            </label>
            <input id="trip-days" name="days" type="number" min={1} max={120} className="input num" defaultValue={trip.days} required />
          </div>
          <div className="field">
            <label className="label" htmlFor="trip-spare">
              Spare margin
            </label>
            <select id="trip-spare" name="spareFraction" className="select" defaultValue={spareValue}>
              {SPARE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="hint">Delays, breakages and a sensor that fails on day two all come out of the spare.</span>
          </div>
          <div className="md:col-span-3">
            <SubmitButton pendingText="Saving…">Save trip</SubmitButton>
          </div>
        </form>
      </Card>

      {visible.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="The packing template has not been loaded yet"
            body="Run npm run setup in the project folder. That creates the tables and fills in the standard packing list, and this screen fills itself in."
          />
        </div>
      ) : (
        <>
          <p className="muted mt-6">
            {trip.name ? `${trip.name}: ` : ""}
            {trip.days} day{trip.days === 1 ? "" : "s"}, quantities include a {Math.round(trip.spareFraction * 100)}% spare
            margin. {packed} of {visible.length} packed.
          </p>

          <div className="grid gap-3 mt-3">
            {PACKING_CATEGORIES.map((cat) => {
              const inCat = visible.filter((i) => i.category === cat);
              if (inCat.length === 0) return null;
              return (
                <Card key={cat}>
                  <h3>{CATEGORY_LABEL[cat]}</h3>
                  <ul className="mt-2">
                    {inCat.map((i) => {
                      const qty = quantity(i, trip.days, trip.spareFraction);
                      return (
                        <li key={i.id} className="divider py-2 first:border-t-0 flex items-start gap-3">
                          <form action={toggleItem} className="shrink-0 pt-0.5 no-print">
                            <input type="hidden" name="id" value={i.id} />
                            <input type="hidden" name="next" value={i.checked ? "0" : "1"} />
                            <button
                              type="submit"
                              role="checkbox"
                              aria-checked={i.checked}
                              aria-label={`${i.label}: ${i.checked ? "packed" : "not packed yet"}`}
                              className="w-7 h-7 rounded-md border flex items-center justify-center"
                              style={{
                                borderColor: "var(--line-strong)",
                                background: i.checked ? "var(--juniper-soft)" : "transparent",
                                color: "var(--juniper)",
                              }}
                            >
                              {i.checked ? "✓" : ""}
                            </button>
                          </form>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className={i.checked ? "muted line-through" : ""}>{i.label}</span>
                              {qty ? <span className="pill num">{qty}</span> : null}
                              {i.custom ? <span className="hint">yours</span> : null}
                            </div>
                            {i.tip ? <p className="hint mt-1">{i.tip}</p> : null}
                          </div>
                          {i.custom ? (
                            <form action={deleteCustom} className="shrink-0 no-print">
                              <input type="hidden" name="id" value={i.id} />
                              <SubmitButton className="btn btn-ghost btn-sm" pendingText="Deleting…">
                                Delete
                              </SubmitButton>
                            </form>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <Card className="mt-6 no-print">
        <h2>Add something of your own</h2>
        <form action={addCustom} className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="field">
            <label className="label" htmlFor="item-label">
              What is it
            </label>
            <input id="item-label" name="label" className="input" required maxLength={120} placeholder="Spare charging cable" />
          </div>
          <div className="field">
            <label className="label" htmlFor="item-category">
              Where does it belong
            </label>
            <select id="item-category" name="category" className="select" defaultValue="comfort_and_care">
              {PACKING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="item-perday">
              How many per day (optional)
            </label>
            <input id="item-perday" name="perDay" type="number" step="0.5" min={0} max={100} className="input num" placeholder="Leave blank if it is not a consumable" />
          </div>
          <div className="field">
            <label className="label" htmlFor="item-unit">
              Unit (optional)
            </label>
            <input id="item-unit" name="unit" className="input" maxLength={24} placeholder="strips, pods, sachets" />
          </div>
          <div className="field md:col-span-2">
            <label className="label" htmlFor="item-tip">
              A note to yourself (optional)
            </label>
            <input id="item-tip" name="tip" className="input" maxLength={300} />
          </div>
          <div className="md:col-span-2">
            <SubmitButton pendingText="Adding…">Add to the list</SubmitButton>
          </div>
        </form>
      </Card>

      <div className="mt-6">
        <Notice>
          <p>
            These quantities are a starting point, not a prescription. Count what you actually use in a normal week and
            adjust.
          </p>
          <p className="mt-2">
            Split your supplies across two bags, and keep insulin, meter and lows kit in the one that stays with you. Bags go
            missing and holds get cold.
          </p>
          <p className="mt-2">
            Crossing time zones changes when your day starts and ends. That is a question to take to your care team before
            you fly: ask them what they want you to do about the timing of each medicine while you travel, and write the
            answer down. Steady will not work that out for you.
          </p>
        </Notice>
      </div>
    </div>
  );
  });
}
