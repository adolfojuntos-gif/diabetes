/**
 * Small server-safe pieces shared by the toolkit, settings and share screens. No hooks here.
 */
import Link from "next/link";
import { filterDoseLanguage, softenCertainty } from "@/lib/ai/filter";

export type SP = Promise<{ [key: string]: string | string[] | undefined }>;

/** Read one query parameter, whatever shape Next hands it over as. */
export async function param(sp: SP | undefined, key: string): Promise<string | undefined> {
  if (!sp) return undefined;
  const v = (await sp)[key];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * These two render text that ARRIVES IN THE URL, so it is untrusted input, not app copy.
 *
 * React escapes HTML, so this was never XSS. It was worse in context: the dose filter guards what
 * the model writes and nothing guarded what a link writes, so
 * `/settings/data?e=URGENT:%20your%20prescriber%20raised%20your%20evening%20insulin%20to%2020%20units`
 * displayed fabricated dosing instructions in the app's own alert styling, on the owner's domain,
 * above the real content. A link like that is the cheapest possible attack on a patient.
 *
 * Three guards, and they are the same ones the model's own output gets:
 *   1. The text is capped, so it cannot become a paragraph of invented clinical narrative.
 *   2. It runs through the dose-language filter, so anything that reads like a dose or a medication
 *      change is replaced with the care-team pointer.
 *   3. It is framed as the app reporting a problem, never as a clinical statement, so a message
 *      that survives the filter still cannot impersonate advice.
 */
const MAX_MESSAGE = 160;

function safeMessage(raw: string): string {
  const trimmed = raw.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE);
  const { text } = filterDoseLanguage(trimmed);
  return softenCertainty(text).text;
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  const safe = safeMessage(message);
  if (!safe) return null;
  return (
    <p className="error mt-3" role="alert">
      <span className="faint">Could not save that. </span>
      {safe}
    </p>
  );
}

export function FormNote({ message }: { message?: string }) {
  if (!message) return null;
  const safe = safeMessage(message);
  if (!safe) return null;
  return (
    <p className="hint mt-3" role="status">
      {safe}
    </p>
  );
}

export function ToolCard({ href, title, body, count }: { href: string; title: string; body: string; count?: string | null }) {
  return (
    <Link href={href} className="card p-4 md:p-5 block hover:shadow-lg transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <h3>{title}</h3>
        {count ? <span className="pill shrink-0">{count}</span> : null}
      </div>
      <p className="muted text-sm mt-1">{body}</p>
    </Link>
  );
}

/** A labelled row of text, used for the read-only lists. */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 divider first:border-t-0">
      <span className="text-sm muted">{label}</span>
      <span className="num">{children}</span>
    </div>
  );
}
