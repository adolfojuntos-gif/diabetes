import "server-only";
/**
 * Reading and writing progress through the Nutrition Knowledge Tree.
 *
 * A row means one lesson was read. It is not a score, there is no correct-answer column, and
 * nothing here can be lost: the tree only ever moves forwards, because the thing it records is
 * something that already happened.
 */
import { db, journeyAwards, knowledgeProgress } from "../db";
import { newId } from "../ids";
import { provenance } from "../engines/rules";
import { KNOWLEDGE_ENGINE_VERSION, LESSON_XP, availableLessons, canOpen, treeState, type TreeState } from "../engines/knowledge";

export async function learnedKeys(): Promise<string[]> {
  const rows = await db.select().from(knowledgeProgress);
  return rows.map((r) => r.lessonKey);
}

export async function loadTree(): Promise<{ state: TreeState; chosen: Map<string, number> }> {
  const rows = await db.select().from(knowledgeProgress);
  return {
    state: treeState(rows.map((r) => r.lessonKey)),
    chosen: new Map(rows.map((r) => [r.lessonKey, r.chose])),
  };
}

/**
 * Record that a lesson was read, and pay for it.
 *
 * PAID FOR READING, NOT FOR BEING RIGHT. The award key is the lesson, so the amount cannot depend
 * on which option was chosen even by accident, and reading the same lesson again cannot pay twice.
 * A version of this that paid more for the expected answer would turn every lesson into an exam,
 * and the one thing this tree must never become is something a person can fail.
 */
export async function learnLesson(lessonKey: string, chose: number, now = new Date()): Promise<{ recorded: boolean }> {
  const lesson = availableLessons().find((l) => l.key === lessonKey);
  if (!lesson) return { recorded: false };

  /*
   * The tier gate is checked HERE and not only on the screen. A form post is a form post, and a
   * lesson four tiers ahead should not be markable by anyone who can type a key into it.
   */
  if (!canOpen(lessonKey, await learnedKeys())) return { recorded: false };

  const index = Number.isInteger(chose) && chose >= 0 && chose < lesson.check.options.length ? chose : 0;

  await db
    .insert(knowledgeProgress)
    .values({
      id: newId(),
      lessonKey,
      learnedAt: now,
      chose: index,
      engineVersion: KNOWLEDGE_ENGINE_VERSION,
    })
    .onConflictDoNothing();

  const prov = provenance({ sampleSize: 1, windowFrom: now, windowTo: now, dataQuality: "high" });
  await db
    .insert(journeyAwards)
    .values({
      id: newId(),
      key: `lesson:${lessonKey}`,
      code: "lesson",
      kind: "habit",
      title: "You read something worth knowing",
      body: "Understanding where a figure came from is what turns it from a number you obey into a number you can use.",
      evidence: `read "${lesson.title}" in the ${lesson.tier} tier`,
      xp: LESSON_XP,
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

  return { recorded: true };
}
