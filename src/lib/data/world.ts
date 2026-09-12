import "server-only";
/**
 * The living world's data layer: run the tick, write what happened, read what is new.
 *
 * Everything here is idempotent by `world_events.key`, which is date or week anchored. The tick can
 * run on every page load, on a retry, and on two requests in the same instant, and the world's
 * history does not move. That property is why there is no lock and no scheduler: the day decides
 * what happened, not the moment the page was opened.
 *
 * NOTHING IN THIS FILE TOUCHES CLINICAL DATA. It reads the day roll-up the journey layer already
 * built, and it writes to one table that holds no health information of any kind. The bridge runs
 * one way and the world can never write a reading.
 */
import { desc, eq, isNull, sql } from "drizzle-orm";
import { db, worldEvents, type WorldEvent } from "../db";
import { newId } from "../ids";
import { tickWorld, worldExtras, whatsNew, WORLD_ENGINE_VERSION, type WorldExtras } from "../engines/world";
import type { DayRoll } from "../engines/journey";

/**
 * Run the tick and record anything new.
 *
 * Returns the events it wrote THIS call, which is not the same as the unseen list: something
 * written last night and not yet looked at is still new to the person, and that is read separately.
 */
export async function tickAndRecord(input: {
  now: Date;
  level: number;
  rolls: DayRoll[];
  away: number;
  theme: "forest" | "coast" | "city";
}): Promise<number> {
  const drafts = tickWorld(input);
  let written = 0;
  for (const d of drafts) {
    const r = await db
      .insert(worldEvents)
      .values({
        id: newId(),
        key: d.key,
        kind: d.kind,
        title: d.title,
        body: d.body,
        at: d.at,
        createdAt: input.now,
        seenAt: null,
        engineVersion: WORLD_ENGINE_VERSION,
      })
      .onConflictDoNothing();
    if ((r as { rowsAffected?: number }).rowsAffected) written++;
  }
  return written;
}

/** Everything that has ever happened here, newest first. */
export async function history(limit = 60): Promise<WorldEvent[]> {
  return db.select().from(worldEvents).orderBy(desc(worldEvents.at), desc(worldEvents.createdAt)).limit(limit);
}

/** What the person has not looked at yet. This is What's New. */
export async function unseenEvents(limit = 8): Promise<WorldEvent[]> {
  return db.select().from(worldEvents).where(isNull(worldEvents.seenAt)).orderBy(desc(worldEvents.at)).limit(limit);
}

export async function markWorldSeen(now = new Date()): Promise<void> {
  await db.update(worldEvents).set({ seenAt: now }).where(isNull(worldEvents.seenAt));
}

export async function unseenWorldCount(): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)` }).from(worldEvents).where(isNull(worldEvents.seenAt));
  return Number(rows[0]?.n ?? 0);
}

/**
 * What the ledger adds to the drawing. Counted from every event ever recorded, not from the unseen
 * ones: a visitor who arrived in March is still living there in September.
 */
export async function extras(now = new Date()): Promise<WorldExtras> {
  const rows = await db.select({ kind: worldEvents.kind }).from(worldEvents);
  return worldExtras(rows, now);
}

/** One line for the top of the world, or null when there is genuinely nothing to say. */
export async function newsLine(): Promise<string | null> {
  const rows = await db
    .select({ kind: worldEvents.kind, title: worldEvents.title })
    .from(worldEvents)
    .where(isNull(worldEvents.seenAt))
    .orderBy(desc(worldEvents.at))
    .limit(8);
  return whatsNew(rows);
}

/** Landmarks and arrivals, for the places list. */
export async function placesFound(limit = 40): Promise<WorldEvent[]> {
  return db
    .select()
    .from(worldEvents)
    .where(eq(worldEvents.kind, "landmark"))
    .orderBy(desc(worldEvents.at))
    .limit(limit);
}
