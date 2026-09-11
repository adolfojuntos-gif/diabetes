import "server-only";
/**
 * Server-action plumbing shared by these screens. A failed action sends the person back to the
 * screen they were on with the message in the query string, so the error is rendered where the
 * form is rather than swallowed.
 */
import { redirect } from "next/navigation";

export function failTo(path: string, error: string): never {
  redirect(`${path}?e=${encodeURIComponent(error)}`);
}

export function noteTo(path: string, message: string): never {
  redirect(`${path}?m=${encodeURIComponent(message)}`);
}
