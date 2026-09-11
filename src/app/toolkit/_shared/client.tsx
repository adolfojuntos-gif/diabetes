"use client";
/**
 * The only client code in the toolkit, settings and share screens: a print button and a copy
 * button. Everything else is a Server Component with server actions.
 */
import { useState } from "react";

export function PrintButton({ label = "Print", className = "btn btn-secondary btn-sm" }: { label?: string; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      {label}
    </button>
  );
}

export function CopyButton({ text, label = "Copy", className = "btn btn-secondary btn-sm" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("failed");
    }
  }
  return (
    <button type="button" className={className} onClick={copy}>
      <span aria-live="polite">{state === "done" ? "Copied" : state === "failed" ? "Select the text and copy it" : label}</span>
    </button>
  );
}
