"use client";
/**
 * The form shell every logging screen uses. It holds the action state so the person always sees
 * what happened: the error in a `.error` paragraph, or the confirmation, right where they typed.
 */
import Link from "next/link";
import { useActionState } from "react";
import { Notice } from "@/components/ui";
import type { LogAction, LogResult } from "./types";

export function ActionForm({
  action,
  children,
  className = "grid gap-4",
  pendingText = "Saving…",
  id,
}: {
  action: LogAction;
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
  id?: string;
}) {
  const [state, formAction, pending] = useActionState<LogResult | null, FormData>(action, null);
  return (
    <form action={formAction} className={className} id={id}>
      {children}
      {pending ? <p className="hint">{pendingText}</p> : null}
      {state && !state.ok ? <p className="error">{state.error}</p> : null}
      {state && state.ok ? (
        <div className="grid gap-2">
          {state.message ? (
            <Notice tone="juniper">
              <span className="font-semibold">{state.message}</span>
              {state.detail ? <span> {state.detail}</span> : null}
            </Notice>
          ) : null}
          {state.copilot ? (
            <Notice tone="slate">
              {state.copilot.text}{" "}
              <Link href={`/copilot?mode=${state.copilot.mode}`} className="font-semibold underline">
                {state.copilot.cta}
              </Link>
            </Notice>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

/** A one-button form for deleting a single row. Shows its own failure inline. */
export function DeleteButton({
  action,
  id,
  what,
  label = "Delete",
  ariaLabel,
}: {
  action: LogAction;
  id: string;
  /** Named in the accessible label: "Delete this reading". */
  what: string;
  label?: string;
  ariaLabel?: string;
}) {
  const [state, formAction, pending] = useActionState<LogResult | null, FormData>(action, null);
  return (
    <form action={formAction} className="shrink-0 text-right">
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="btn btn-ghost btn-sm" disabled={pending} aria-label={ariaLabel ?? `Delete this ${what}`}>
        {pending ? "Deleting…" : label}
      </button>
      {state && !state.ok ? <p className="error">{state.error}</p> : null}
    </form>
  );
}
