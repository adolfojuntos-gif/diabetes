import Link from "next/link";
import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, glucoseReadings } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { fmtDay, fmtTime } from "@/lib/time";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui";
import { ImportForm } from "./Paste";
import { importChunk, finishImport, undoImport } from "./actions";
import { DeleteButton } from "../../ActionForm";

export default async function ImportGlucosePage() {
  return requireAccount(async () => {
  const [batches, latest] = await Promise.all([
    db
      .select({
        batch: glucoseReadings.importBatch,
        n: sql<number>`count(*)`,
        firstAt: sql<number>`min(${glucoseReadings.at})`,
        lastAt: sql<number>`max(${glucoseReadings.at})`,
        addedAt: sql<number>`max(${glucoseReadings.createdAt})`,
      })
      .from(glucoseReadings)
      .where(isNotNull(glucoseReadings.importBatch))
      .groupBy(glucoseReadings.importBatch)
      .orderBy(desc(sql`max(${glucoseReadings.createdAt})`))
      .limit(5),
    db
      .select({ at: glucoseReadings.at })
      .from(glucoseReadings)
      .where(eq(glucoseReadings.source, "cgm_import"))
      .orderBy(desc(glucoseReadings.at))
      .limit(1),
  ]);

  const lastReading = latest[0]?.at ?? null;
  const daysSince = lastReading ? Math.floor((Date.now() - lastReading.getTime()) / 86_400_000) : null;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Log · Glucose"
        title="Import from your CGM or meter"
        lede="Dexcom Clarity and LibreView exports both work exactly as they download, however long they are. So does any spreadsheet with a time column and a glucose column."
        action={
          <Link href="/log/glucose" className="btn btn-secondary">
            Type one in instead
          </Link>
        }
      />

      {/*
        The single most useful thing this screen can say to someone who already imported once: the
        exact date to ask Clarity for. Without it people re-export everything and wonder why the
        app says most of it was already here.
      */}
      {lastReading ? (
        <div className="mb-6">
          <Notice tone={daysSince !== null && daysSince >= 7 ? "amber" : "slate"}>
            Your imported readings run to <strong>{fmtDay(lastReading)}</strong>, {fmtTime(lastReading)}
            {daysSince !== null && daysSince > 0 ? `, which was ${daysSince} day${daysSince === 1 ? "" : "s"} ago` : ""}. Export from{" "}
            <strong>{fmtDay(lastReading)}</strong> onwards and this will pick up exactly where it left off. Overlapping it is harmless: the same
            minute from the same source is the same reading, so Steady keeps one and tells you how many it already had.
          </Notice>
        </div>
      ) : (
        <div className="mb-6">
          <Notice>
            Bring over as much history as you have. There is no length limit: a long export is sent to the app in parts, and importing the same
            file twice is safe because a reading at the same minute from the same source is the same reading.
          </Notice>
        </div>
      )}

      <Card>
        <ImportForm action={importChunk} finish={finishImport} />
      </Card>

      <section className="mt-8">
        <h2 className="mb-3">Recent imports</h2>
        {batches.length === 0 ? (
          <EmptyState title="Nothing imported yet" body="Once you import a file it shows up here, and you can undo the whole thing in one go." />
        ) : (
          <ul className="card divide-y">
            {batches.map((b) => (
              <li key={b.batch ?? "none"} className="flex flex-wrap items-center gap-3 p-3 md:p-4">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    <span className="num">{Number(b.n).toLocaleString()}</span> {Number(b.n) === 1 ? "reading" : "readings"}
                  </div>
                  <div className="hint">
                    Imported {b.addedAt ? fmtDay(new Date(Number(b.addedAt) * 1000)) : "recently"}
                    {b.firstAt && b.lastAt
                      ? ` · covering ${fmtDay(new Date(Number(b.firstAt) * 1000))} to ${fmtDay(new Date(Number(b.lastAt) * 1000))}`
                      : ""}
                  </div>
                </div>
                {b.batch ? (
                  <DeleteButton action={undoImport} id={b.batch} what="import" label="Undo this import" ariaLabel="Undo this import" />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
  });
}
