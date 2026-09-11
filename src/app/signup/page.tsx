import Link from "next/link";
import { redirect } from "next/navigation";
import { APP_NAME } from "@/lib/brand";
import { SubmitButton } from "@/components/Form";
import { optionalAccount, createSession } from "@/lib/auth/session";
import { signUp } from "@/lib/auth/provision";

export const dynamic = "force-dynamic";

async function create(fd: FormData) {
  "use server";
  const email = String(fd.get("email") ?? "").slice(0, 200);
  const password = String(fd.get("password") ?? "").slice(0, 200);
  const confirm = String(fd.get("confirm") ?? "").slice(0, 200);

  if (password !== confirm) {
    redirect(`/signup?e=${encodeURIComponent("The two passwords do not match.")}&email=${encodeURIComponent(email)}`);
  }

  const result = await signUp(email, password);
  if (!result.ok) {
    redirect(`/signup?e=${encodeURIComponent(result.error)}&email=${encodeURIComponent(email)}`);
  }

  await createSession(result.account.id);
  redirect("/welcome");
}

export default async function SignUp({ searchParams }: { searchParams: Promise<{ e?: string; email?: string }> }) {
  if (await optionalAccount()) redirect("/");
  const sp = await searchParams;

  return (
    <main id="main" className="min-h-dvh grid place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="eyebrow mb-2">{APP_NAME}</div>
        <h1>Start your own records.</h1>
        <p className="lede mt-3">
          Your data goes into a database of its own. No other account can read it, because it is not
          in the same place as anybody else&rsquo;s.
        </p>

        <form action={create} className="grid gap-3 mt-6">
          <div className="field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input id="email" name="email" type="email" className="input" autoComplete="username" defaultValue={sp.email ?? ""} autoFocus required />
          </div>
          <div className="field">
            <label className="label" htmlFor="password">
              Password
            </label>
            <input id="password" name="password" type="password" className="input" autoComplete="new-password" minLength={10} required />
            <span className="hint">At least 10 characters. Three unrelated words beat one clever word.</span>
          </div>
          <div className="field">
            <label className="label" htmlFor="confirm">
              Again
            </label>
            <input id="confirm" name="confirm" type="password" className="input" autoComplete="new-password" minLength={10} required />
          </div>
          {sp.e ? <p className="error">{sp.e}</p> : null}
          <SubmitButton className="btn btn-lg" pendingText="Setting up your records…">
            Create my account
          </SubmitButton>
          <span className="hint">
            Setting up takes a few seconds: your database is created and the recipe, exercise and food
            reference is copied into it.
          </span>
        </form>

        <p className="hint mt-6">
          Already have an account?{" "}
          <Link href="/signin" className="underline">
            Sign in
          </Link>
          .
        </p>
        <p className="hint mt-4">
          There is no password reset by email yet, so choose something you will not lose. Steady is not
          a medical device, does not diagnose, and never suggests or changes a medication or insulin
          dose.
        </p>
      </div>
    </main>
  );
}
