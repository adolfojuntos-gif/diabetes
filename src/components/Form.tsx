"use client";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  className = "btn",
  pendingText = "Saving…",
  /** For a form that is not ready to send yet, such as a recipe with nothing in it. */
  disabled = false,
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
