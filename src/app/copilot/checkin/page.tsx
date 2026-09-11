import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, wellbeingCheckins } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { PageHeader, Card, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { loadCopilotContext } from "@/lib/data/snapshot";
import { dateKey, fmtDayLong } from "@/lib/time";
import { submitCheckin } from "../actions";

export const dynamic = "force-dynamic";

/** The third question adapts to what today actually looks like. */
function adaptiveQuestion(ctx: Awaited<ReturnType<typeof loadCopilotContext>>): { label: string; placeholder: string } {
  const today = ctx.windows.find((w) => w.label === "Today");
  const patterns = ctx.patterns.patterns;
  if (today && today.stats.n === 0) return { label: "Anything getting in the way of checking today?", placeholder: "Busy morning, forgot my kit, did not feel like it." };
  if (today && today.stats.lowsCount > 0) return { label: "You had a low today. What was happening around it?", placeholder: "Skipped lunch, walked further than usual." };
  if (today && today.stats.pct.high + today.stats.pct.very_high > 50) return { label: "Today has been running high. Anything different about it?", placeholder: "Slept badly, ate out, stressful day." };
  const p = patterns.find((x) => x.severity === "attention" || x.severity === "watch");
  if (p) return { label: `About "${p.title}". Does that match what you feel?`, placeholder: "Say whether this rings true. It changes what I look at next." };
  return { label: "Anything you want to talk about?", placeholder: "Anything at all, or leave it blank." };
}

const SCALE = [
  { v: 1, l: "Rough" },
  { v: 2, l: "Meh" },
  { v: 3, l: "OK" },
  { v: 4, l: "Good" },
  { v: 5, l: "Great" },
];

export default async function Checkin({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const sp = await searchParams;
  return requireAccount(async () => {
  const ctx = await loadCopilotContext();
  const today = dateKey(new Date());
  const existing = (await db.select().from(wellbeingCheckins).where(eq(wellbeingCheckins.date, today)).limit(1))[0];
  const q3 = adaptiveQuestion(ctx);

  return (
    <div className="page">
      <PageHeader eyebrow="Daily check-in" title={fmtDayLong(new Date())} lede="Three questions. Thirty seconds. You can change your answers any time today." />

      {sp.saved ? <Notice tone="juniper">Saved. Thank you.</Notice> : null}

      <Card className="mt-4">
        <div className="eyebrow mb-1">What today looks like so far</div>
        <p className="text-sm muted">{ctx.todayLog}</p>
      </Card>

      <form action={submitCheckin} className="grid gap-5 mt-4">
        <Card>
          <fieldset className="field">
            <legend className="label">How are you feeling today?</legend>
            <div className="seg mt-1 flex-wrap" role="radiogroup">
              {SCALE.map((o) => (
                <label key={o.v} className="cursor-pointer">
                  <input type="radio" name="feeling" value={o.v} defaultChecked={existing ? existing.feeling === o.v : o.v === 3} className="sr-only" />
                  {o.l}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2 mt-4">
            <div className="field">
              <label className="label" htmlFor="energy">
                Energy, 1 to 5
              </label>
              <input id="energy" name="energy" type="number" min={1} max={5} defaultValue={existing?.energy ?? ""} className="input" />
            </div>
            <div className="field">
              <label className="label" htmlFor="stress">
                Stress, 1 to 5
              </label>
              <input id="stress" name="stress" type="number" min={1} max={5} defaultValue={existing?.stress ?? ""} className="input" />
            </div>
          </div>
        </Card>

        <Card>
          <div className="field">
            <label className="label" htmlFor="unusual">
              Have you noticed anything unusual?
            </label>
            <textarea id="unusual" name="unusual" className="textarea" rows={2} maxLength={600} defaultValue={existing?.unusual ?? ""} placeholder="Nothing, or whatever caught your attention." />
          </div>
          <div className="field mt-4">
            <label className="label" htmlFor="wantToDiscuss">
              {q3.label}
            </label>
            <textarea id="wantToDiscuss" name="wantToDiscuss" className="textarea" rows={2} maxLength={600} defaultValue={existing?.wantToDiscuss ?? ""} placeholder={q3.placeholder} />
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <SubmitButton className="btn btn-slate" pendingText="Saving…">
            Done for today
          </SubmitButton>
          <Link href="/" className="btn btn-ghost">
            Skip
          </Link>
        </div>
      </form>

      <p className="hint mt-6 prose-measure">
        Your answers are kept with your logs so patterns can include how you felt, not only what your meter said. Nothing here is shared unless you have set up a caregiver link.
      </p>
    </div>
  );
  });
}
