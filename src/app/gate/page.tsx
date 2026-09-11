import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { SubmitButton } from "@/components/Form";

export const dynamic = "force-dynamic";

async function enter(fd: FormData) {
  "use server";
  const pass = process.env.DEMO_PASSPHRASE;
  const given = String(fd.get("passphrase") ?? "");
  const next = String(fd.get("next") ?? "/");
  if (!pass || given !== pass) redirect(`/gate?e=1${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`);
  const jar = await cookies();
  jar.set("steady_demo", pass, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  redirect(next.startsWith("/") ? next : "/");
}

export default async function Gate({ searchParams }: { searchParams: Promise<{ e?: string; next?: string }> }) {
  const sp = await searchParams;
  if (!process.env.DEMO_PASSPHRASE) redirect("/");

  return (
    <main id="main" className="min-h-dvh grid place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="eyebrow mb-2">{APP_NAME}</div>
        <h1>{APP_TAGLINE}</h1>
        <p className="lede mt-3">
          This is a private demonstration. Everything in it is fictional data generated to show how
          the app behaves. Enter the passphrase you were given.
        </p>
        <form action={enter} className="grid gap-3 mt-6">
          <input type="hidden" name="next" value={sp.next ?? "/"} />
          <div className="field">
            <label className="label" htmlFor="passphrase">
              Passphrase
            </label>
            <input id="passphrase" name="passphrase" type="password" className="input" autoFocus required autoComplete="current-password" />
          </div>
          {sp.e ? <p className="error">That passphrase did not match. Try again.</p> : null}
          <SubmitButton className="btn btn-lg" pendingText="Checking…">
            Enter
          </SubmitButton>
        </form>
        <p className="hint mt-6">
          One shared passphrase, not a login. There are no accounts in this demonstration and no real
          patient data in it. Steady is not a medical device, does not diagnose, and never suggests or
          changes a medication or insulin dose.
        </p>
      </div>
    </main>
  );
}
