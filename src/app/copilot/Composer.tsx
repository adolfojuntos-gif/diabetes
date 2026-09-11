"use client";
import { useActionState, useRef, useEffect } from "react";
import type { ActionResult } from "@/lib/actions";
import { SubmitButton } from "@/components/Form";

type Action = (fd: FormData) => Promise<ActionResult>;

export function Composer({
  action,
  mode,
  conversationId,
  placeholder = "Tell me what's going on.",
  suggestions = [],
  autoFocus = false,
}: {
  action: Action;
  mode: string;
  conversationId?: string;
  placeholder?: string;
  suggestions?: string[];
  autoFocus?: boolean;
}) {
  const [state, formAction] = useActionState(
    async (_prev: ActionResult | null, fd: FormData) => {
      const r = await action(fd);
      return r;
    },
    null,
  );
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (state?.ok && ref.current) ref.current.value = "";
  }, [state]);

  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="mode" value={mode} />
      {conversationId ? <input type="hidden" name="conversationId" value={conversationId} /> : null}
      <div className="field">
        <label className="sr-only" htmlFor="body">
          Your message
        </label>
        <textarea
          ref={ref}
          id="body"
          name="body"
          className="textarea"
          rows={3}
          placeholder={placeholder}
          required
          maxLength={4000}
          autoFocus={autoFocus}
        />
      </div>
      {suggestions.length ? (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="pill"
              onClick={() => {
                if (ref.current) {
                  ref.current.value = s;
                  ref.current.focus();
                }
              }}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
      {state && !state.ok ? <p className="error">{state.error}</p> : null}
      <div className="flex items-center gap-3">
        <SubmitButton className="btn btn-slate" pendingText="Thinking…">
          Send
        </SubmitButton>
        <span className="hint">The safety check runs before every reply.</span>
      </div>
    </form>
  );
}
