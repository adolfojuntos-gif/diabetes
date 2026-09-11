/**
 * The toolkit: the things you take to an appointment, the things you carry on a trip, and the
 * record of what this app knows about you. Every count on this page is read from your own rows.
 */
import { and, asc, eq, gte } from "drizzle-orm";
import { db, appointments, caregivers, doctorQuestions, labResults, memoryFacts, packingItems } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { getProfile } from "@/lib/data/snapshot";
import { unreadCount } from "@/lib/data/nudges";
import { startOfDay, fmtDay } from "@/lib/time";
import { PageHeader, Notice } from "@/components/ui";
import { ToolCard } from "./_shared/ui";

export default async function ToolkitPage() {
  return requireAccount(async () => {
  const now = new Date();
  const profile = await getProfile();

  const [unread, openQuestions, packing, nextAppt, memory, labs, cgs] = await Promise.all([
    unreadCount(),
    db.select({ id: doctorQuestions.id }).from(doctorQuestions).where(eq(doctorQuestions.asked, false)),
    db.select().from(packingItems),
    db.select().from(appointments).where(gte(appointments.at, startOfDay(now))).orderBy(asc(appointments.at)).limit(1),
    db.select({ id: memoryFacts.id }).from(memoryFacts),
    db.select({ id: labResults.id }).from(labResults).where(and(eq(labResults.verified, true))),
    db.select({ id: caregivers.id, status: caregivers.status }).from(caregivers),
  ]);

  const visible = packing.filter(
    (i) =>
      !i.onlyIf ||
      (i.onlyIf === "insulin" && profile.insulinRegimen !== "none") ||
      (i.onlyIf === "pump" && profile.insulinRegimen === "pump") ||
      (i.onlyIf === "cgm" && profile.usesCgm),
  );
  const unpacked = visible.filter((i) => !i.checked).length;
  const activeCaregivers = cgs.filter((c) => c.status === "active").length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Toolkit"
        title="Your toolkit"
        lede="The practical things: what to ask, what to pack, what to bring to an appointment, and everything Steady has written down about you."
      />

      <div className="grid gap-3 md:grid-cols-2">
        <ToolCard
          href="/toolkit/inbox"
          title="Inbox"
          body="What the engines noticed in your own logged data."
          count={unread > 0 ? `${unread} unread` : "all read"}
        />
        <ToolCard
          href="/toolkit/questions"
          title="Questions for your doctor"
          body="Questions with your own numbers attached, ready to print."
          count={openQuestions.length > 0 ? `${openQuestions.length} open` : "none open"}
        />
        <ToolCard
          href="/toolkit/appointments"
          title="Appointments"
          body="Dates, and a brief the engine writes from your last 30 days."
          count={nextAppt[0] ? fmtDay(nextAppt[0].at) : "none booked"}
        />
        <ToolCard
          href="/toolkit/labs"
          title="Explain my labs"
          body="Paste a lab report, check every value, and read what each test measures."
          count={labs.length > 0 ? `${labs.length} saved` : "none saved"}
        />
        <ToolCard
          href="/toolkit/packing"
          title="Travel packing list"
          body="Quantities worked out from the length of your trip."
          count={visible.length > 0 ? `${unpacked} left to pack` : "run npm run setup"}
        />
        <ToolCard
          href="/toolkit/memory"
          title="What Steady knows about you"
          body="Every fact the Copilot can see, and the buttons to correct or delete it."
          count={`${memory.length} fact${memory.length === 1 ? "" : "s"}`}
        />
        <ToolCard
          href="/toolkit/caregivers"
          title="Caregiver mode"
          body="Share only the sections you choose with someone you trust."
          count={activeCaregivers > 0 ? `${activeCaregivers} active` : "nobody yet"}
        />
      </div>

      <div className="mt-6">
        <Notice>
          Nothing here changes or suggests a medication or an insulin dose. When a number or a symptom needs a decision, the
          toolkit turns it into a question for your care team instead.
        </Notice>
      </div>
    </div>
  );
  });
}
