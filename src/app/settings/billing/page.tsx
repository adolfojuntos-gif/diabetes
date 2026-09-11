/**
 * Plan and billing.
 *
 * Three things had to be true of this screen, and they shaped it more than the layout did.
 *
 * IT RECONCILES BEFORE IT READS. A webhook that never arrived leaves a lapsed subscription looking
 * healthy, and the person most likely to notice is the one looking at this page. So
 * `reconcileAccount` runs first and the render reads whatever that settled on. It is the same sweep
 * the cron runs, called from the one place somebody is already asking the question.
 *
 * THE NUMBERS COME FROM THE ENFORCED LIMITS, NOT FROM COPY. Both the usage rows and the comparison
 * table are built from `PLAN_LIMITS` and the audit log. A hand-written price list is a promise that
 * drifts the first time a cap moves, and the drift is invisible until somebody is refused something
 * this page told them they had.
 *
 * IT STILL WORKS WITH NO STRIPE KEYS. `billingConfigured()` only removes the upgrade path. The plan,
 * the usage and the comparison all still render, because an account on a deployment with no billing
 * is still on a real plan with real allowances.
 */
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { planStateFor } from "@/lib/billing/plan";
import { reconcileAccount } from "@/lib/billing/apply";
import { startCheckout, portalUrl, freshAccount } from "@/lib/billing/checkout";
import { billingConfigured, isTestMode, PLUS_PRICE_DISPLAY } from "@/lib/billing/stripe";
import { spendUsage } from "@/lib/data/aiAudit";
import { PLAN_LIMITS } from "@/lib/ai/limits";
import { fmtDayLong } from "@/lib/time";
import { PageHeader, Card, Notice, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { FormError, FormNote, param, type SP } from "../../toolkit/_shared/ui";
import { failTo } from "../../toolkit/_shared/server";

export const dynamic = "force-dynamic";

const PATH = "/settings/billing";

const FEATURE_LABEL: Record<string, string> = {
  photo: "Photo estimates",
  copilot: "Copilot replies",
  coach: "Written check-ins",
};

/** Same order as the usage cards, so the two halves of the page read in step. */
const FEATURES = ["photo", "copilot", "coach"] as const;

/* ------------------------------- actions ------------------------------- */

/**
 * Both actions re-read the account rather than trusting the copy the page closed over.
 *
 * A server action runs on a later request than the render did, and in between somebody can have
 * finished a checkout in another tab or had a payment fail. The stale copy would then sell a second
 * subscription to an existing subscriber, or open a portal for an account that no longer has one.
 * `startCheckout` refuses both of those, but only when it is handed the current row.
 *
 * The redirect sits outside `requireAccount` on purpose. `redirect` works by throwing, so it must
 * not be inside anything that might catch it.
 */
async function beginUpgrade() {
  "use server";
  const result = await requireAccount(async (account) => {
    const fresh = await freshAccount(account.id);
    if (!fresh) return { ok: false as const, error: "That account could not be read. Try signing in again." };
    return startCheckout(fresh);
  });
  if (!result.ok) failTo(PATH, result.error);
  redirect(result.url);
}

async function openPortal() {
  "use server";
  const result = await requireAccount(async (account) => {
    const fresh = await freshAccount(account.id);
    if (!fresh) return { ok: false as const, error: "That account could not be read. Try signing in again." };
    return portalUrl(fresh);
  });
  if (!result.ok) failTo(PATH, result.error);
  redirect(result.url);
}

/* -------------------------------- pieces -------------------------------- */

/**
 * A zero maximum is a plan boundary, not a number that resets. The free tier's written check-in is
 * genuinely absent rather than rationed, and "0 of 0" reads as bad luck or as a bug when it is
 * neither: no amount of waiting helps, and only a plan change does.
 */
function usageValue(used: number, max: number): string {
  if (max === 0) return "Not on your plan";
  return `${used} of ${max}`;
}

/** The table describes plans rather than this account, so the absent case is worded for a plan. */
function allowanceLabel(max: number): string {
  return max === 0 ? "Not included" : String(max);
}

/**
 * Only the month window goes in the comparison. The hourly and daily caps are abuse protection that
 * a real person never meets, and putting every window in one table turns a short decision into a
 * grid nobody reads.
 */
function monthMax(plan: "free" | "plus", feature: (typeof FEATURES)[number]): number {
  const month = PLAN_LIMITS[plan][feature].find((w) => w.label === "month");
  return month ? month.max : 0;
}

/* --------------------------------- page --------------------------------- */

export default async function BillingPage({ searchParams }: { searchParams?: SP }) {
  const [error, note, checkout] = await Promise.all([
    param(searchParams, "e"),
    param(searchParams, "m"),
    param(searchParams, "checkout"),
  ]);

  return requireAccount(async (account) => {
    // Before anything is read. See the note at the top of this file.
    await reconcileAccount(account.id);

    const [state, spend] = await Promise.all([planStateFor(account.id), spendUsage()]);
    const onPlus = state.plan === "plus";
    const configured = billingConfigured();

    return (
      <div className="page">
        <PageHeader
          eyebrow="Settings"
          title="Plan and billing"
          lede="What this account is on, what that allows, and where to change it. Changing a plan never touches the data you have logged."
        />

        <FormError message={error} />
        <FormNote message={note} />

        <div className="grid gap-3">
          {checkout === "done" ? (
            <Notice tone="juniper">
              Payment received, thank you. The subscription can take a few seconds to reach this page. If it still says free
              plan below, refresh and it should be there.
            </Notice>
          ) : null}

          {checkout === "cancelled" ? (
            <Notice>Checkout was closed and nothing was charged. This account is on the same plan it was on before.</Notice>
          ) : null}

          {configured ? null : (
            <Notice>
              Billing is not set up on this deployment, so there is nothing to buy here. Everything below still applies. This
              account is on a real plan with real allowances, and nobody can be charged.
            </Notice>
          )}

          {isTestMode() ? (
            <Notice>
              This deployment is using Stripe test keys, so no real money moves. A checkout here runs against Stripe&rsquo;s
              test mode and no card is charged.
            </Notice>
          ) : null}
        </div>

        <Card className="mt-4">
          <h2>Your plan</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Stat label="Plan" value={onPlus ? "Steady Plus" : "Free"} />
            <Stat
              label="Status"
              value={state.endingAt ? "Ending" : onPlus ? "Active" : "No subscription"}
              sub={state.endingAt ? `Access stays on until ${fmtDayLong(state.endingAt)}` : undefined}
            />
          </div>

          {onPlus ? (
            <p className="mt-3 prose-measure">
              You are on Steady Plus. The allowances in the table below are the larger set, and the features that call a
              model use them.
            </p>
          ) : (
            <p className="mt-3 prose-measure">
              You are on the free plan. Nothing is being charged. Everything that costs nothing to run stays open to you with
              no limit: the carbohydrate reference, the pattern engine, trends, the planner, the packing list and appointment
              prep.
            </p>
          )}

          {state.endingAt ? (
            <p className="mt-2 prose-measure">
              Steady Plus on this account ends on {fmtDayLong(state.endingAt)}. You keep everything on Plus until that date.
              After it the account goes back to the free plan, and nothing you have logged is removed.
            </p>
          ) : null}

          {onPlus ? (
            <div className="mt-4">
              {configured ? (
                <>
                  <form action={openPortal}>
                    <SubmitButton className="btn btn-secondary" pendingText="Opening Stripe…">
                      Manage or cancel
                    </SubmitButton>
                  </form>
                  <p className="hint mt-2 prose-measure">
                    This opens Stripe, which is where your invoices and your card live. Cancelling is done there too, and
                    it is deliberately not a button in this app, so there is only ever one record of whether you are a
                    subscriber. Cancelling leaves your access on until the end of the period you have already paid for.
                  </p>
                </>
              ) : (
                /**
                 * On the paid plan with no keys configured. Rare and worth saying plainly, because
                 * the person cannot cancel from here and needs to know where to go instead.
                 */
                <p className="hint prose-measure">
                  Billing is not set up on this deployment, so this account cannot be managed from here. To change or
                  cancel it, get in touch.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-4">
              {/**
               * The explanation lives WITH the button, because it describes the button. Rendered
               * unconditionally it told somebody on a deployment with no keys what "the button"
               * would do, next to no button. The notice at the top of the page already covers that
               * case, so the honest thing here is to say nothing.
               */}
              {configured ? (
                <>
                  <form action={beginUpgrade}>
                    <SubmitButton className="btn btn-lg" pendingText="Opening Stripe…">
                      Upgrade to Steady Plus
                    </SubmitButton>
                  </form>
                  <p className="hint mt-2 prose-measure">
                    Steady Plus is {PLUS_PRICE_DISPLAY}. The button opens Stripe, which takes the payment and holds the
                    card. No card details reach this app at any point. You can cancel from the same place afterwards.
                  </p>
                </>
              ) : (
                <p className="hint prose-measure">
                  Steady Plus is {PLUS_PRICE_DISPLAY} where it is available. There is nothing to buy on this deployment.
                </p>
              )}
            </div>
          )}
        </Card>

        <Card className="mt-4">
          <h2>What you have used</h2>
          <p className="text-sm muted mt-1 prose-measure">
            Each feature that calls a paid model is capped, and the cap comes from your plan. These counts are read from the
            audit log, so they are what actually happened and what the app is enforcing rather than a separate tally. A month
            here is a rolling window, so nothing resets on the first.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {spend.map((s) => (
              <div key={s.feature} className="card-sunk p-3">
                <div className="eyebrow">{FEATURE_LABEL[s.feature] ?? s.feature}</div>
                {s.windows.map((w) => (
                  <div key={w.label} className="mt-1">
                    <div className="num text-lg">{usageValue(w.used, w.max)}</div>
                    <div className="hint">this {w.label}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="hint mt-3 prose-measure">
            Past a cap, the feature falls back to this app&rsquo;s own engine over your own data, and says so in the reply.
            The Copilot still answers, the check-in is still written, and a meal can still be typed by hand or looked up in
            the carbohydrate reference. Nothing stops working.
          </p>
        </Card>

        <Card className="mt-4">
          <h2>What each plan allows</h2>
          <p className="text-sm muted mt-1 prose-measure">
            Per month, for the features that call a paid model. These figures are read from the same limits the app enforces,
            so this table cannot disagree with what you are actually allowed.
          </p>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left py-2 eyebrow">Each month</th>
                  <th className="text-right py-2 eyebrow">Free</th>
                  <th className="text-right py-2 eyebrow">Steady Plus</th>
                </tr>
              </thead>
              <tbody>
                {FEATURES.map((f) => (
                  <tr key={f}>
                    <td className="py-2 divider">{FEATURE_LABEL[f]}</td>
                    <td className="py-2 divider text-right num">{allowanceLabel(monthMax("free", f))}</td>
                    <td className="py-2 divider text-right num">{allowanceLabel(monthMax("plus", f))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint mt-3 prose-measure">
            Steady Plus has hourly and daily caps on top of these. They are there to stop a runaway bill, and they are set
            loose enough that ordinary use never meets them.
          </p>
        </Card>

        <div className="mt-6">
          <Notice>
            A plan decides how often this app may ask a model a question. It decides nothing clinical. No plan changes a
            target, a medicine or a dose, and no plan gives you a reply that a clinician has seen.
          </Notice>
        </div>
      </div>
    );
  });
}
