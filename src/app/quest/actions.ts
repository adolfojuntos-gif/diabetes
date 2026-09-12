"use server";
/**
 * LIFE QUEST's actions. Four verbs and none of them can take anything away.
 *
 * There is deliberately no "reset", no "forfeit" and no way to spend XP, because every one of those
 * is a mechanism for the app to make somebody feel worse, and the whole feature is built on the
 * promise that it cannot.
 */
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/session";
import { parseForm, zStr } from "@/lib/actions";
import {
  completeQuest,
  addDiscovery,
  startRest,
  endRest,
  setWorldTheme,
  setArchetype,
  markRegionSeen,
  markMorningSeen,
} from "@/lib/data/lifequest";
import { THEME_KEYS } from "@/lib/game/themes";
import { ARCHETYPE_KEYS } from "@/lib/game/archetypes";
import { markSeen } from "@/lib/data/journey";
import { markWorldSeen } from "@/lib/data/world";

function refresh() {
  for (const p of ["/", "/quest/journey", "/quest/journal", "/quest/world", "/quest/you", "/quest/unlocked", "/quest/recap", "/today"])
    revalidatePath(p);
}

/**
 * Switch which world they are building in. It is a view change and nothing else: no points move,
 * no level changes, nothing is reset, and it can be done as often as they like.
 */
/**
 * Choose who you are here. Changeable at any time and free: it tilts what the app offers and
 * changes nothing about what anything is worth, so there is no wrong answer to regret.
 */
export async function chooseArchetype(fd: FormData): Promise<void> {
  return requireAccount(async () => {
    const p = parseForm(z.object({ archetype: z.enum(ARCHETYPE_KEYS) }), fd);
    if ("error" in p) redirect("/quest/you");
    await setArchetype(p.data.archetype);
    refresh();
    redirect("/");
  });
}

export async function chooseWorld(fd: FormData): Promise<void> {
  return requireAccount(async () => {
    const p = parseForm(z.object({ theme: z.enum(THEME_KEYS) }), fd);
    if ("error" in p) redirect("/quest/world");
    await setWorldTheme(p.data.theme);
    refresh();
    redirect("/");
  });
}

/**
 * Acknowledge the unlock ceremony and go somewhere.
 *
 * BOTH buttons on that screen come here, including "not now". Deferring without recording it
 * would mean the ceremony fires again on the next visit and the one after, and a celebration
 * that will not take no for an answer stops being a celebration by about the third time. The
 * region is open either way; only where they land differs.
 */
export async function enterRegion(fd: FormData): Promise<void> {
  return requireAccount(async () => {
    const p = parseForm(z.object({ level: z.coerce.number().int().min(1).max(99), to: zStr(40).optional() }), fd);
    if ("error" in p) redirect("/");
    await markRegionSeen(p.data.level);
    refresh();
    redirect(p.data.to === "today" ? "/today" : "/");
  });
}

/**
 * Acknowledge the morning greeting. It is shown once a day and never reappears after it has been
 * read, because a greeting that keeps greeting you is a notification.
 */
export async function dismissMorning(fd: FormData): Promise<void> {
  return requireAccount(async () => {
    const p = parseForm(z.object({ date: zStr(10), to: zStr(80).optional() }), fd);
    if ("error" in p) redirect("/");
    await markMorningSeen(p.data.date);
    refresh();
    redirect(p.data.to && p.data.to.startsWith("/") ? p.data.to : "/");
  });
}

/** Tick off a manual quest. Auto quests are decided by the logs and this refuses them. */
export async function markQuestDone(fd: FormData): Promise<void> {
  return requireAccount(async () => {
    const p = parseForm(z.object({ key: zStr(120) }), fd);
    if ("error" in p) redirect("/");
    await completeQuest(p.data.key);
    refresh();
    redirect("/");
  });
}

/** Add to the Explorer Journal. A name is enough; everything else is optional. */
export async function recordDiscovery(fd: FormData): Promise<void> {
  return requireAccount(async () => {
    const p = parseForm(
      z.object({ name: z.string().trim().min(1, "needs a name").max(80), note: zStr(400).optional(), place: zStr(80).optional() }),
      fd,
    );
    if ("error" in p) redirect(`/quest/journal?error=${encodeURIComponent(p.error)}`);
    await addDiscovery(p.data.name, p.data.note ?? "", p.data.place ?? "");
    refresh();
    redirect("/quest/journal");
  });
}

/**
 * Enter Rest Mode. The world goes quiet, the quests stop asking, and nothing expires while it is
 * on. Nothing is deducted for using it, and it can be turned on for any reason or none.
 */
export async function enterRest(fd: FormData): Promise<void> {
  return requireAccount(async () => {
    const p = parseForm(z.object({ days: z.coerce.number().int().min(1).max(30) }), fd);
    await startRest("error" in p ? 3 : p.data.days);
    refresh();
    redirect("/");
  });
}

export async function leaveRest(): Promise<void> {
  return requireAccount(async () => {
    await endRest();
    refresh();
    redirect("/");
  });
}

/**
 * Mark What's New as read. The events stay in the world's history forever; only their newness is
 * spent, which is why this sets a timestamp rather than deleting anything.
 */
export async function seenTheWorld(): Promise<void> {
  return requireAccount(async () => {
    await markWorldSeen();
    refresh();
    redirect("/");
  });
}

/** Mark the celebration list as read, so the same things are not celebrated twice. */
export async function acknowledge(): Promise<void> {
  return requireAccount(async () => {
    await markSeen();
    refresh();
    redirect("/");
  });
}
