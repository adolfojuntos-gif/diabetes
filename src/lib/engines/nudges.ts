/**
 * Nudges: small, deduplicated, dismissible. Built from the pattern report plus today's gaps.
 * One nudge per (key, ISO week). Quiet hours are respected by the screen, not here.
 */
import type { Pattern } from "./patterns";
import type { NudgeKind } from "../db/schema";
import { weekKey, dateKey } from "../time";

export type NudgeDraft = { dedupeKey: string; kind: NudgeKind; title: string; body: string; href: string | null };

export type TodayState = {
  now: Date;
  readingsToday: number;
  lastReadingAt: Date | null;
  mealsToday: number;
  waterTodayMl: number;
  hydrationGoalMl: number;
  sleepLoggedForToday: boolean;
  checkinDoneToday: boolean;
  veryLowLast24h: boolean;
  nextAppointment: { at: Date; withWhom: string } | null;
};

export function nudgesFromPatterns(patterns: Pattern[], now: Date): NudgeDraft[] {
  const wk = weekKey(now);
  return patterns
    .filter((p) => p.severity !== "info" || p.key.startsWith("logging") || p.key.startsWith("meals_uncovered"))
    .slice(0, 6)
    .map((p) => ({
      dedupeKey: `${p.key}:${wk}`,
      kind: p.severity === "win" ? "win" : p.severity === "attention" ? "safety" : "pattern",
      title: p.title,
      body: `${p.evidence} ${p.suggestion}`,
      href: p.href,
    }));
}

export function nudgesFromToday(t: TodayState): NudgeDraft[] {
  const day = dateKey(t.now);
  const h = t.now.getHours();
  const out: NudgeDraft[] = [];

  if (t.veryLowLast24h) {
    out.push({
      dedupeKey: `very_low_24h:${day}`,
      kind: "safety",
      title: "You had a very low in the last day",
      body: "Readings under 54 are the ones to tell your care team about. Keep fast-acting carbs close today, and let someone near you know.",
      href: "/copilot?mode=symptoms",
    });
  }
  if (h >= 10 && t.readingsToday === 0) {
    out.push({
      dedupeKey: `no_reading_today:${day}`,
      kind: "gap",
      title: "No reading yet today",
      body: "One reading, any time, keeps your patterns alive.",
      href: "/log/glucose",
    });
  }
  if (h >= 13 && t.waterTodayMl < t.hydrationGoalMl * 0.3) {
    out.push({
      dedupeKey: `water_behind:${day}`,
      kind: "reminder",
      title: "Water is behind for the day",
      body: `${t.waterTodayMl} ml logged so far of ${t.hydrationGoalMl}. A glass now catches you up.`,
      href: "/log/water",
    });
  }
  if (h >= 9 && !t.sleepLoggedForToday) {
    out.push({
      dedupeKey: `sleep_unlogged:${day}`,
      kind: "gap",
      title: "How did you sleep?",
      body: "Ten seconds to log last night. It's one of the few things that moves morning glucose.",
      href: "/log/sleep",
    });
  }
  if (h >= 18 && !t.checkinDoneToday) {
    out.push({
      dedupeKey: `checkin:${day}`,
      kind: "reminder",
      title: "Daily check-in",
      body: "Three quick questions about how today felt.",
      href: "/copilot?mode=checkin",
    });
  }
  if (t.nextAppointment) {
    const days = Math.ceil((t.nextAppointment.at.getTime() - t.now.getTime()) / 86_400_000);
    if (days >= 0 && days <= 3) {
      out.push({
        dedupeKey: `appt_prep:${dateKey(t.nextAppointment.at)}`,
        kind: "reminder",
        title: days === 0 ? "Appointment today" : `Appointment in ${days} day${days === 1 ? "" : "s"}`,
        body: `${t.nextAppointment.withWhom || "Your visit"}, build your appointment brief so nothing gets forgotten in the room.`,
        href: "/toolkit/appointments",
      });
    }
  }
  return out;
}
