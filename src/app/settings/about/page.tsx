/**
 * What this is and is not.
 *
 * Everything on this page is rendered from the modules it describes, so it cannot drift away from
 * the code: the knowledge list, its version, and each item's source and review status come from
 * src/lib/knowledge/*.
 */
import Link from "next/link";
import { CLINICAL_KNOWLEDGE, KNOWLEDGE_VERSION, knowledgeById } from "@/lib/knowledge/clinical";
import { MEDICATION_KNOWLEDGE } from "@/lib/knowledge/medications";
import { LAB_TESTS } from "@/lib/engines/labs";
import { VERY_LOW_MGDL, LOW_MGDL, HIGH_MGDL, VERY_HIGH_MGDL } from "@/lib/units";
import { PageHeader, Card, Notice } from "@/components/ui";
import { PrintButton } from "../../toolkit/_shared/client";

const DRAFT = "draft_needs_clinician_review";

const DEFINITIONS: { title: string; body: string; knowledgeId: string }[] = [
  {
    title: "Time in range, and the bands",
    body: `Every reading is put in one of five bands: under ${VERY_LOW_MGDL} mg/dL is very low, ${VERY_LOW_MGDL} to ${LOW_MGDL - 1} is low, ${LOW_MGDL} to ${HIGH_MGDL} is in range, ${HIGH_MGDL + 1} to ${VERY_HIGH_MGDL} is high, and above ${VERY_HIGH_MGDL} is very high. The in-range band uses your own target when you have set one, because that is a personal decision. The outer bands never move, because they are clinical thresholds rather than preferences. Time in range is the share of your readings that landed in the in-range band, counted by readings, not by minutes.`,
    knowledgeId: "tir_targets",
  },
  {
    title: "GMI, the glucose management indicator",
    body: "GMI = 3.31 + 0.02392 × mean glucose in mg/dL. Steady marks it unreliable with fewer than 14 days of dense readings, and it is never presented as an A1C result.",
    knowledgeId: "gmi",
  },
  {
    title: "CV, the variability number",
    body: "CV = the sample standard deviation of your readings divided by their mean, times 100. The sample standard deviation uses n minus 1, so it needs at least two readings. The widely used target is 36% or less.",
    knowledgeId: "variability_cv",
  },
  {
    title: "The post-meal rise",
    body: "For a logged meal, the rise is the highest reading between 1 and 3 hours after the meal, minus the reading nearest the meal in the window from 60 minutes before to 10 minutes after. A meal without both of those readings is called uncovered and is shown as uncovered, never estimated.",
    knowledgeId: "post_meal",
  },
  {
    title: "Estimated average glucose from A1C",
    body: "eAG = 28.7 × A1C − 46.7, from the ADAG study, with the IFCC conversion (A1C − 2.15) × 10.929. Both are arithmetic conversions of one A1C number. Neither is a measurement of your glucose, and Steady labels them as conversions wherever they appear.",
    knowledgeId: "lab_a1c",
  },
];

const INVARIANTS: { title: string; body: string }[] = [
  {
    title: "Glucose is stored in one unit",
    body: "Every reading is stored in mg/dL. mmol/L is a display choice converted when it is shown to you, so switching units never changes a saved number and a reading cannot end up stored in the wrong unit.",
  },
  {
    title: "Insulin and medication are recorded, never recommended",
    body: "No part of this app takes your carbs or your glucose and returns a number of units. There is no function that can. The Copilot is forbidden from dosing language, a filter strips any sentence that slips through, and the filtered reply is marked as filtered in the audit.",
  },
  {
    title: "The numbers come from the app, not from a model",
    body: "Every statistic, pattern and ranking is computed by plain code. The Copilot is handed the results as text and can only put them in sentences. It is also told how many readings each number came from, and told to say when that is too few.",
  },
  {
    title: "The safety check is separate from the model, and it wins",
    body: "A fixed rule table over your recent readings, your symptoms and a few profile facts decides whether something is an emergency, urgent, one for the clinic, or general. That level is shown as a banner in fixed wording above anything a model wrote, and the model cannot raise or lower it.",
  },
  {
    title: "Medical knowledge is a controlled list",
    body: "Clinical statements come from a written list in the code, each with its source, the date it was written and its review status. The model retrieves from that list rather than remembering things, and it is told to say when it cannot trace a claim.",
  },
  {
    title: "Memory is a table you can read and delete",
    body: "The only memory the Copilot has is the memory facts table, which you can read in full, correct and delete on the What Steady knows about you screen. Delete a fact and it stops knowing it.",
  },
  {
    title: "It all works with no key and no network",
    body: "Every screen, every guided flow and the safety engine run on this device. With no API key the Copilot answers from the engine and says that is what it is doing. Nothing is faked and no canned AI text is ever shown.",
  },
  {
    title: "Every clinically relevant AI reply is audited",
    body: "An audit row records the question, which data windows were consulted, which knowledge items were used, which safety rules were evaluated, the level, who answered, which model, and whether the dose filter fired. It does not copy your health data, which already lives in its own tables.",
  },
  {
    title: "A caregiver sees only what you scoped",
    body: "A share link renders strictly the sections you ticked. The link is the credential, there are no accounts, and revoking it takes effect immediately.",
  },
  {
    title: "Photo estimates stay estimates",
    body: "A meal estimated from a photo is marked as photo-estimated and carries a confidence for each item. The photo itself is never stored.",
  },
];

export default async function AboutPage() {
  const drafts = CLINICAL_KNOWLEDGE.filter((k) => k.reviewStatus === DRAFT).length;
  const medDrafts = MEDICATION_KNOWLEDGE.filter((m) => m.reviewStatus === DRAFT).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Settings"
        title="What this is and is not"
        lede="Read this once. It is the honest description of what Steady does, where its medical statements come from, and what it refuses to do."
        action={<PrintButton className="btn btn-secondary" />}
      />

      <Card>
        <h2>What Steady is not</h2>
        <ul className="mt-3 grid gap-2 prose-measure list-disc pl-5">
          <li>
            <strong>Not a medical device.</strong> It has not been assessed or approved by any regulator, and it is not
            intended to diagnose, treat, cure or prevent anything.
          </li>
          <li>
            <strong>Not a dosing calculator.</strong> There is no code in it that turns carbohydrate or glucose into units of
            insulin, and no screen that will ever suggest one. Dose decisions belong to you and the person who prescribes for
            you.
          </li>
          <li>
            <strong>Not a diagnostic tool.</strong> It will not tell you what a symptom means or what a lab value says about
            you. It shows the laboratory&rsquo;s own range, explains what a test generally measures, and turns the rest into a
            question for your care team.
          </li>
        </ul>
        <p className="mt-3 prose-measure">
          What it is: a place to write down what happens, a set of plain calculations over what you wrote, and a companion
          that can only narrate those calculations.
        </p>
      </Card>

      <Card className="mt-4">
        <h2>The knowledge layer has not been reviewed by a clinician</h2>
        <p className="mt-2 prose-measure">
          Every clinical statement in Steady carries a review status. Right now {drafts} of {CLINICAL_KNOWLEDGE.length}{" "}
          clinical items and {medDrafts} of {MEDICATION_KNOWLEDGE.length} medication items are marked{" "}
          <span className="num">{DRAFT.replace(/_/g, " ")}</span>.
        </p>
        <p className="mt-2 prose-measure">
          That status means exactly what it says: the text was written from named guidelines and consensus documents, and no
          qualified clinician has sat down and checked it. The field is honest by construction, so it will keep saying that
          until a real review happens and the status is changed in the code. Treat everything in the knowledge layer as
          background reading, not as instruction for your case.
        </p>
        <p className="hint mt-2">Knowledge list version {KNOWLEDGE_VERSION}.</p>
      </Card>

      <Card className="mt-4">
        <h2>The definitions Steady uses</h2>
        <div className="mt-3 grid gap-4">
          {DEFINITIONS.map((d) => {
            const k = knowledgeById(d.knowledgeId);
            return (
              <div key={d.title}>
                <h3>{d.title}</h3>
                <p className="text-sm mt-1 prose-measure">{d.body}</p>
                {k ? (
                  <p className="hint mt-1">
                    Source: {k.source}. Written {k.updated}. Review status: {k.reviewStatus.replace(/_/g, " ")}. Due for
                    review by {k.reviewBy}.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mt-4">
        <h2>Every knowledge item in the app</h2>
        <p className="text-sm muted mt-1 prose-measure">
          This table is rendered from the module itself, so it cannot fall out of step with what the Copilot is actually
          allowed to say.
        </p>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm" style={{ minWidth: 640 }}>
            <thead>
              <tr className="text-left">
                <th className="p-2 eyebrow">Topic</th>
                <th className="p-2 eyebrow">Source</th>
                <th className="p-2 eyebrow">Written</th>
                <th className="p-2 eyebrow">Review status</th>
              </tr>
            </thead>
            <tbody>
              {CLINICAL_KNOWLEDGE.map((k) => (
                <tr key={k.id} className="divider align-top">
                  <td className="p-2">
                    {k.topic}
                    <span className="hint block">{k.id}</span>
                  </td>
                  <td className="p-2">
                    {k.source}
                    <span className="hint block">
                      {k.sourceType}, {k.region}
                    </span>
                  </td>
                  <td className="p-2 num">{k.updated}</td>
                  <td className="p-2">
                    {k.reviewStatus.replace(/_/g, " ")}
                    <span className="hint block">review by {k.reviewBy}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="mt-5">Medication items</h3>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-sm" style={{ minWidth: 640 }}>
            <thead>
              <tr className="text-left">
                <th className="p-2 eyebrow">Medicine or class</th>
                <th className="p-2 eyebrow">Source</th>
                <th className="p-2 eyebrow">Version</th>
                <th className="p-2 eyebrow">Review status</th>
              </tr>
            </thead>
            <tbody>
              {MEDICATION_KNOWLEDGE.map((m) => (
                <tr key={m.id} className="divider align-top">
                  <td className="p-2">
                    {m.displayName}
                    <span className="hint block">{m.drugClass}</span>
                  </td>
                  <td className="p-2">{m.source}</td>
                  <td className="p-2 num">
                    {m.version}
                    <span className="hint block">{m.reviewDate}</span>
                  </td>
                  <td className="p-2">{m.reviewStatus.replace(/_/g, " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint mt-3">
          Medication items carry no doses at all. They describe what a class of medicine generally does and list questions
          worth asking the prescriber. Lab explanations cover {LAB_TESTS.length} recognised tests and never interpret an
          individual value.
        </p>
      </Card>

      <Card className="mt-4">
        <h2>The ten rules this app is built on</h2>
        <p className="text-sm muted mt-1 prose-measure">
          These are enforced in the code, not in a policy document. A change that breaks one of them is a bug even if
          everything still runs.
        </p>
        <ol className="mt-3 grid gap-3 list-decimal pl-5">
          {INVARIANTS.map((inv) => (
            <li key={inv.title}>
              <strong>{inv.title}.</strong> <span className="text-sm">{inv.body}</span>
            </li>
          ))}
        </ol>
      </Card>

      <div className="mt-6">
        <Notice>
          If you are worried about a symptom or a number right now, this page is not the right thing to be reading. Contact
          your care team, or emergency services if it is urgent.
        </Notice>
      </div>

      <div className="mt-6 flex flex-wrap gap-3 no-print">
        <Link href="/settings" className="btn btn-secondary">
          Back to settings
        </Link>
        <Link href="/settings/data" className="btn btn-ghost">
          Data and privacy
        </Link>
      </div>
    </div>
  );
}
