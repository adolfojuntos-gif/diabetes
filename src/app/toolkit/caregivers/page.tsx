/**
 * Caregiver mode. The link token is the credential, indexed by digest in the control plane so it
 * can name an account, and stored readable in this patient's own database so they can re-send it.
 * The server
 * renders only the sections in `canView`, and revoking is immediate.
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  caregiverComments,
  caregivers,
  CAREGIVER_SCOPES,
  type Caregiver,
  type CaregiverScope,
} from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { newId } from "@/lib/ids";
import { registerToken, revokeTokensForSubject } from "@/lib/auth/tokens";
import { parseForm, zStr } from "@/lib/actions";
import { fmtDay, fmtTime, relative } from "@/lib/time";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { FormError, param, type SP } from "../_shared/ui";
import { failTo } from "../_shared/server";
import { CopyButton } from "../_shared/client";

const PATH = "/toolkit/caregivers";

const SCOPE_LABEL: Record<CaregiverScope, string> = {
  glucose: "Glucose readings",
  meals: "Meals and carbs",
  insulin: "Insulin entries",
  activity: "Movement",
  sleep: "Sleep",
  notes: "My notes",
  labs: "Lab results",
  medications: "Medications",
};

const ALERT_KINDS = ["safety", "pattern", "win"] as const;
const ALERT_LABELS: Record<(typeof ALERT_KINDS)[number], string> = {
  safety: "Safety alerts",
  pattern: "Patterns",
  win: "Wins",
};

const permissionFields = {
  name: zStr(120),
  relationship: zStr(80),
  canView: z.array(z.enum(CAREGIVER_SCOPES)).optional(),
  // Checkbox: absent when unchecked, "on" when checked. Anything else is treated as off.
  canComment: z.string().max(8).optional(),
  alertKinds: z.array(z.enum(ALERT_KINDS)).optional(),
};

/* ------------------------------- actions ------------------------------- */

async function addCaregiver(fd: FormData) {
  "use server";
  return requireAccount(async (account) => {
  const r = parseForm(z.object(permissionFields), fd);
  if ("error" in r) failTo(PATH, r.error);
  const name = r.data.name.trim();
  if (name.length < 2) failTo(PATH, "Give this person a name so you can tell their link apart from anyone else's.");
  const view = r.data.canView ?? [];
  if (view.length === 0) failTo(PATH, "Pick at least one section for them to see, or there is nothing to share.");
  /**
   * The link lives in two places on purpose. The readable token stays in this patient's own
   * database, so they can copy it again when a family member loses the message. Only its digest
   * goes to the control plane, which is what lets `/share/<token>` find WHICH account a link
   * belongs to without the control plane holding usable links for everybody.
   */
  const caregiverId = newId();
  const raw = `${newId()}${newId()}`;
  await db.insert(caregivers).values({
    id: caregiverId,
    name,
    relationship: r.data.relationship,
    token: raw,
    canView: view.join(","),
    canComment: r.data.canComment === "on",
    alertKinds: (r.data.alertKinds ?? []).join(","),
    status: "active",
    createdAt: new Date(),
  });
  await registerToken(raw, { kind: "share", accountId: account.id, subjectId: caregiverId, label: name });
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

/**
 * An id that arrived in a hidden form field is untrusted.
 *
 * The old schema was zStr(40), which has no minimum, so an empty string parsed cleanly and the
 * mutation ran against a filter that matched nothing and then reported success. Nothing checked
 * that the row existed or what state it was in either, so a crafted post could rewrite any link's
 * scopes, and the restore action could un-revoke a revoked link. That last one defeats the only
 * promise this screen makes, which is that revocation is immediate.
 */
const zRowId = z.string().trim().min(6).max(40);

/** Load the row or stop. The message does not confirm whether the id exists. */
async function mustFindCaregiver(id: string) {
  const rows = await db.select().from(caregivers).where(eq(caregivers.id, id)).limit(1);
  if (!rows[0]) failTo(PATH, "That link could not be found. It may already have been deleted.");
  return rows[0];
}

async function updateCaregiver(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(z.object({ id: zRowId, ...permissionFields }), fd);
  if ("error" in r) failTo(PATH, r.error);
  const view = r.data.canView ?? [];
  if (view.length === 0) failTo(PATH, "Pick at least one section, or revoke the link instead.");
  const existing = await mustFindCaregiver(r.data.id);
  if (existing.status === "revoked") {
    failTo(PATH, "That link is revoked. Restore it first if you want to change what it shows.");
  }
  await db
    .update(caregivers)
    .set({
      name: r.data.name.trim(),
      relationship: r.data.relationship,
      canView: view.join(","),
      canComment: r.data.canComment === "on",
      alertKinds: (r.data.alertKinds ?? []).join(","),
    })
    .where(eq(caregivers.id, r.data.id));
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function revokeCaregiver(fd: FormData) {
  "use server";
  return requireAccount(async (account) => {
  const r = parseForm(z.object({ id: zRowId }), fd);
  if ("error" in r) failTo(PATH, r.error);
  await mustFindCaregiver(r.data.id);
  await db.update(caregivers).set({ status: "revoked" }).where(eq(caregivers.id, r.data.id));
  // Revoking the directory entry is what actually stops the URL resolving. Without this the page
  // would still find the account and only then discover the caregiver row was revoked.
  await revokeTokensForSubject(account.id, r.data.id);
  // The share page is cached per URL, so revoking has to clear it or the old page can still render.
  revalidatePath("/share/[token]", "page");
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function restoreCaregiver(fd: FormData) {
  "use server";
  return requireAccount(async (account) => {
  const r = parseForm(z.object({ id: zRowId }), fd);
  if ("error" in r) failTo(PATH, r.error);
  const row = await mustFindCaregiver(r.data.id);
  if (row.status === "active") failTo(PATH, "That link is already active.");
  // A restored link gets a NEW token. Revoking promises the old URL stops working, and quietly
  // reusing the token would break that promise the moment someone changed their mind.
  const fresh = `${newId()}${newId()}`;
  await db.update(caregivers).set({ status: "active", token: fresh }).where(eq(caregivers.id, r.data.id));
  await revokeTokensForSubject(account.id, r.data.id);
  await registerToken(fresh, { kind: "share", accountId: account.id, subjectId: r.data.id, label: row.name });
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function deleteCaregiver(fd: FormData) {
  "use server";
  return requireAccount(async (account) => {
  const r = parseForm(z.object({ id: zRowId }), fd);
  if ("error" in r) failTo(PATH, r.error);
  await db.delete(caregiverComments).where(eq(caregiverComments.caregiverId, r.data.id));
  await db.delete(caregivers).where(eq(caregivers.id, r.data.id));
  await revokeTokensForSubject(account.id, r.data.id);
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function markCommentRead(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(z.object({ id: zRowId }), fd);
  if ("error" in r) failTo(PATH, r.error);
  await db.update(caregiverComments).set({ readAt: new Date() }).where(eq(caregiverComments.id, r.data.id));
  revalidatePath(PATH);
  });
}

/* -------------------------------- pieces -------------------------------- */

function ScopeCheckboxes({ idPrefix, selected }: { idPrefix: string; selected: Set<string> }) {
  return (
    <fieldset className="mt-3">
      <legend className="label">What they can see</legend>
      <div className="grid gap-2 sm:grid-cols-2 mt-2">
        {CAREGIVER_SCOPES.map((s) => (
          <label key={s} className="flex items-center gap-2 text-sm" htmlFor={`${idPrefix}-view-${s}`}>
            <input
              id={`${idPrefix}-view-${s}`}
              type="checkbox"
              name="canView[]"
              value={s}
              defaultChecked={selected.has(s)}
              className="w-5 h-5"
            />
            {SCOPE_LABEL[s]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AlertCheckboxes({ idPrefix, selected }: { idPrefix: string; selected: Set<string> }) {
  return (
    <fieldset className="mt-3">
      <legend className="label">Which alerts reach them</legend>
      <div className="grid gap-2 sm:grid-cols-3 mt-2">
        {ALERT_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm" htmlFor={`${idPrefix}-alert-${k}`}>
            <input
              id={`${idPrefix}-alert-${k}`}
              type="checkbox"
              name="alertKinds[]"
              value={k}
              defaultChecked={selected.has(k)}
              className="w-5 h-5"
            />
            {ALERT_LABELS[k]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CaregiverCard({ c, origin }: { c: Caregiver; origin: string }) {
  const view = c.canView.split(",").filter(Boolean);
  const alerts = c.alertKinds.split(",").filter(Boolean);
  const link = `${origin}/share/${c.token}`;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3>{c.name}</h3>
          <p className="text-sm muted mt-1">
            {c.relationship || "no relationship given"} · added {fmtDay(c.createdAt)} ·{" "}
            {c.lastSeenAt ? `last opened the link ${relative(c.lastSeenAt)}` : "has not opened the link yet"}
          </p>
        </div>
        <span className="pill shrink-0">{c.status === "active" ? "Active" : "Revoked"}</span>
      </div>

      <div className="mt-3 grid gap-1 text-sm">
        <p>
          <span className="muted">Can view: </span>
          {view.length ? view.map((v) => SCOPE_LABEL[v as CaregiverScope] ?? v).join(", ") : "nothing"}
        </p>
        <p>
          <span className="muted">Can leave comments: </span>
          {c.canComment ? "yes" : "no"}
        </p>
        <p>
          <span className="muted">Alerts: </span>
          {alerts.length ? alerts.map((a) => ALERT_LABELS[a as (typeof ALERT_KINDS)[number]] ?? a).join(", ") : "none"}
        </p>
      </div>

      {c.status === "active" ? (
        <div className="card-sunk p-3 mt-3">
          <div className="eyebrow">Their link</div>
          <p className="num text-sm mt-1 break-all">{link}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton text={link} label="Copy link" />
          </div>
          <p className="hint mt-2">
            Anyone who has this link can see the sections you ticked, without signing in. Send it only to someone you trust,
            and send it in a message you would be comfortable with them keeping. You can revoke it at any time and it stops
            working immediately.
          </p>
        </div>
      ) : (
        <p className="hint mt-3">This link has been revoked. Opening it now shows only a page saying it is no longer active.</p>
      )}

      <details className="mt-3">
        <summary className="hint cursor-pointer">Edit permissions</summary>
        <form action={updateCaregiver} className="mt-3">
          <input type="hidden" name="id" value={c.id} />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="field">
              <label className="label" htmlFor={`name-${c.id}`}>
                Name
              </label>
              <input id={`name-${c.id}`} name="name" className="input" defaultValue={c.name} maxLength={120} required />
            </div>
            <div className="field">
              <label className="label" htmlFor={`rel-${c.id}`}>
                Relationship
              </label>
              <input id={`rel-${c.id}`} name="relationship" className="input" defaultValue={c.relationship} maxLength={80} />
            </div>
          </div>
          <ScopeCheckboxes idPrefix={c.id} selected={new Set(view)} />
          <label className="flex items-center gap-2 text-sm mt-3" htmlFor={`comment-${c.id}`}>
            <input
              id={`comment-${c.id}`}
              type="checkbox"
              name="canComment"
              defaultChecked={c.canComment}
              className="w-5 h-5"
            />
            They can leave a comment for me
          </label>
          <AlertCheckboxes idPrefix={c.id} selected={new Set(alerts)} />
          <div className="mt-3">
            <SubmitButton className="btn btn-secondary" pendingText="Saving…">
              Save permissions
            </SubmitButton>
          </div>
        </form>
      </details>

      <div className="mt-3 flex flex-wrap gap-2">
        {c.status === "active" ? (
          <form action={revokeCaregiver}>
            <input type="hidden" name="id" value={c.id} />
            <SubmitButton className="btn btn-danger btn-sm" pendingText="Revoking…">
              Revoke the link
            </SubmitButton>
          </form>
        ) : (
          <form action={restoreCaregiver}>
            <input type="hidden" name="id" value={c.id} />
            <SubmitButton className="btn btn-secondary btn-sm" pendingText="Restoring…">
              Make the link work again
            </SubmitButton>
          </form>
        )}
        <form action={deleteCaregiver}>
          <input type="hidden" name="id" value={c.id} />
          <SubmitButton className="btn btn-ghost btn-sm" pendingText="Deleting…">
            Delete
          </SubmitButton>
        </form>
      </div>
    </Card>
  );
}

/* --------------------------------- page --------------------------------- */

export default async function CaregiversPage({ searchParams }: { searchParams?: SP }) {
  const error = await param(searchParams, "e");
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;
  return requireAccount(async () => {

  const [people, comments] = await Promise.all([
    db.select().from(caregivers).orderBy(desc(caregivers.createdAt)),
    db.select().from(caregiverComments).orderBy(desc(caregiverComments.at)).limit(50),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  return (
    <div className="page">
      <PageHeader
        eyebrow="Toolkit"
        title="Caregiver mode"
        lede="Give someone you trust a link to part of your data. You choose which parts, and you can switch it off whenever you want."
      />

      <FormError message={error} />

      {people.length === 0 ? (
        <EmptyState title="Nobody has a link yet" body="Add someone below. Nothing is shared until you create a link and send it." />
      ) : (
        <div className="grid gap-3">
          {people.map((c) => (
            <CaregiverCard key={c.id} c={c} origin={origin} />
          ))}
        </div>
      )}

      <Card className="mt-6">
        <h2>Give someone a link</h2>
        <form action={addCaregiver} className="mt-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="field">
              <label className="label" htmlFor="cg-name">
                Their name
              </label>
              <input id="cg-name" name="name" className="input" required maxLength={120} placeholder="Ana" />
            </div>
            <div className="field">
              <label className="label" htmlFor="cg-rel">
                How they are related to you
              </label>
              <input id="cg-rel" name="relationship" className="input" maxLength={80} placeholder="Partner, daughter, friend" />
            </div>
          </div>
          <ScopeCheckboxes idPrefix="new" selected={new Set(["glucose"])} />
          <label className="flex items-center gap-2 text-sm mt-3" htmlFor="cg-comment">
            <input id="cg-comment" type="checkbox" name="canComment" className="w-5 h-5" />
            They can leave a comment for me
          </label>
          <AlertCheckboxes idPrefix="new" selected={new Set(["safety"])} />
          <div className="mt-4">
            <SubmitButton pendingText="Creating…">Create the link</SubmitButton>
          </div>
        </form>
        <div className="mt-4">
          <Notice>
            The link itself is the key. Anyone holding it can see the sections you chose, so treat it like a house key: give
            it to someone you trust, and revoke it the moment you would rather they did not have it. A caregiver never sees
            your Copilot conversations, your journal or your settings.
          </Notice>
        </div>
      </Card>

      <section className="mt-8">
        <h2>Comments left for you</h2>
        {comments.length === 0 ? (
          <p className="muted mt-2">Nothing yet. Anyone you allowed to comment can leave you a short note on their page.</p>
        ) : (
          <div className="grid gap-3 mt-3">
            {comments.map((cm) => (
              <Card key={cm.id} className={cm.readAt ? "card-quiet" : ""}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <strong>{nameOf.get(cm.caregiverId) ?? "Someone you removed"}</strong>
                  <span className="hint">
                    {fmtDay(cm.at)} at {fmtTime(cm.at)}
                    {cm.aboutDate ? ` · about ${cm.aboutDate}` : ""}
                  </span>
                  {cm.readAt ? null : <span className="pill">New</span>}
                </div>
                <p className="mt-2 prose-measure whitespace-pre-wrap">{cm.body}</p>
                {cm.readAt ? null : (
                  <form action={markCommentRead} className="mt-2">
                    <input type="hidden" name="id" value={cm.id} />
                    <SubmitButton className="btn btn-ghost btn-sm" pendingText="Marking…">
                      Mark read
                    </SubmitButton>
                  </form>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
  });
}
