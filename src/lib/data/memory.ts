import "server-only";
/**
 * Personal Diabetes Memory — the only "memory" the Copilot has. Facts are upserted with
 * first/last seen so the app can say "similar to a pattern first seen on <date>" and mean it.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, memoryFacts, type MemoryKind } from "../db";
import { newId } from "../ids";
import type { Pattern } from "../engines/patterns";

export async function upsertMemory(kind: MemoryKind, key: string, text: string, source: "engine" | "user" | "copilot", evidence?: string | null, now = new Date()) {
  const existing = await db.select().from(memoryFacts).where(and(eq(memoryFacts.kind, kind), eq(memoryFacts.key, key))).limit(1);
  if (existing[0]) {
    await db
      .update(memoryFacts)
      .set({ text, evidence: evidence ?? existing[0].evidence, lastSeen: now, timesSeen: sql`${memoryFacts.timesSeen} + 1` })
      .where(eq(memoryFacts.id, existing[0].id));
    return existing[0].id;
  }
  const id = newId();
  await db.insert(memoryFacts).values({ id, kind, key, text, evidence: evidence ?? null, source, firstSeen: now, lastSeen: now, timesSeen: 1 });
  return id;
}

/** Called whenever a pattern report is generated; wins are remembered too, they are part of the story. */
export async function rememberPatterns(patterns: Pattern[], now = new Date()) {
  for (const p of patterns) {
    if (p.severity === "info" && (p.key === "logging_gaps" || p.key === "meals_uncovered")) continue;
    await upsertMemory("pattern", p.key, `${p.title} (${p.severity})`, "engine", p.evidence, now);
  }
}

export async function rememberQuestion(question: string, now = new Date()) {
  const key = question.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).slice(0, 10).join(" ");
  if (key.length < 8) return;
  await upsertMemory("question_asked", key, `Asked: “${question.slice(0, 140)}”`, "copilot", null, now);
}
