import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { SubmitButton } from "@/components/Form";
import { createSession, verifyCredentials, optionalAccount, tooManyAttempts, recordAttempt } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

async function signIn(fd: FormData) {
  "use server";
  const email = String(fd.get("email") ?? "").slice(0, 200);
  const password = String(fd.get("password") ?? "").slice(0, 200);
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() ?? null;

  if (!email || !password) redirect(`/signin?e=${encodeURIComponent("Enter your email and password.")}`);

  if (await tooManyAttempts(email, ip)) {
    redirect(
      `/signin?e=${encodeURIComponent("Too many attempts. Wait fifteen minutes and try again. If this was not you, your password is worth changing once you are back in.")}`,
    );
  }

  const account = await verifyCredentials(email, password);
  await recordAttempt(email, ip, Boolean(account));
  if (!account) {
    // One message for a wrong password and an unknown email, so this page cannot be used to find
    // out who has an account.
    redirect(`/signin?e=${encodeURIComponent("That email and password do not match an account.")}`);
  }
  if (!account.provisionedAt) {
    redirect(`/signup?e=${encodeURIComponent("That account was not finished setting up. Sign up again with the same email and it will complete.")}`);
  }

  await createSession(account.id);
  redirect("/");
}

export default async function SignIn({ searchParams }: { searchParams: Promise<{ e?: string; next?: string }> }) {
  if (await optionalAccount()) redirect("/");
  const sp = await searchParams;

  return (
    <main id="main" className="min-h-dvh grid place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="eyebrow mb-2">{APP_NAME}</div>
        <h1>{APP_TAGLINE}</h1>
        <p className="lede mt-3">Sign in to your own records.</p>

        <form action={signIn} className="grid gap-3 mt-6">
          <div className="field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input id="email" name="email" type="email" className="input" autoComplete="username" autoFocus required />
          </div>
          <div className="field">
            <label className="label" htmlFor="password">
              Password
            </label>
            <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
          </div>
          {sp.e ? <p className="error">{sp.e}</p> : null}
          <SubmitButton className="btn btn-lg" pendingText="Signing in…">
            Sign in
          </SubmitButton>
        </form>

        <p className="hint mt-6">
          No account yet?{" "}
          <Link href="/signup" className="underline">
            Create one
          </Link>
          . Forgotten your password? There is no reset by email yet, so get in touch and it can be
          changed for you.
        </p>
        <p className="hint mt-4">
          Your records live in a database of their own, separate from every other account. Steady is
          not a medical device, does not diagnose, and never suggests or changes a medication or
          insulin dose.
        </p>
      </div>
    </main>
  );
}
