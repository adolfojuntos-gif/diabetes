"use client";
/**
 * The choose-a-file-or-paste box, and the report that comes back.
 *
 * A ninety day Dexcom export is about 26,000 rows and over a megabyte, which is more than one
 * server action can carry. Rather than cut the file and ask the person to come back with a shorter
 * date range, this slices it on line boundaries and sends the slices in order, repeating the
 * preamble and header on each one. The whole thing stays a single import with a single Undo.
 *
 * A big file is deliberately NOT put in the textarea: 26,000 lines of text in a DOM node makes the
 * page crawl, and nobody proof-reads a CSV anyway. The textarea stays for small pastes.
 */
import { useRef, useState } from "react";
import { Notice } from "@/components/ui";
import { findHeaderIndex } from "@/lib/engines/cgmImport";
import type { ChunkAction, ChunkOk } from "../../types";

const FORMAT_LABEL: Record<string, string> = {
  dexcom: "Dexcom Clarity export",
  libreview: "LibreView export",
  generic: "A spreadsheet with a time column and a glucose column",
  unknown: "Not recognised",
};

/** Rows per slice. At roughly 60 characters a row this is ~250 KB, comfortably inside the 1 MB cap. */
const ROWS_PER_SLICE = 4000;
/** Anything larger than this is not a glucose export. */
const MAX_FILE_BYTES = 60 * 1024 * 1024;
/** Above this many lines the file is summarised instead of being dropped into the textarea. */
const TEXTAREA_LIMIT = 2000;

type Progress = { done: number; total: number } | null;

type Summary = {
  format: string;
  found: number;
  inserted: number;
  already: number;
  skipped: number;
  skippedReasons: Record<string, number>;
  firstAtMs: number | null;
  lastAtMs: number | null;
  batch: string | null;
};

function fmt(ms: number | null) {
  if (ms === null) return null;
  const d = new Date(ms);
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function ImportForm({ action, finish }: { action: ChunkAction; finish: () => Promise<void> }) {
  const raw = useRef<string>("");
  const [text, setText] = useState("");
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [lineCount, setLineCount] = useState(0);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<Progress>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  function reset() {
    setError(null);
    setSummary(null);
    setProgress(null);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    reset();
    if (f.size > MAX_FILE_BYTES) {
      setFileNote("That file is larger than any glucose export should be. Check you picked the right one.");
      return;
    }
    try {
      const t = await f.text();
      raw.current = t;
      const lines = t.split(/\r?\n/).filter((l) => l.trim().length > 0);
      setLineCount(lines.length);
      if (lines.length <= TEXTAREA_LIMIT) {
        setText(t);
        setFileNote(`Loaded ${f.name}. Have a look, then import.`);
      } else {
        setText("");
        setFileNote(
          `Loaded ${f.name}: ${lines.length.toLocaleString()} rows. It is too long to show here, so it will be sent in ${Math.ceil(lines.length / ROWS_PER_SLICE)} parts when you press Import.`,
        );
      }
    } catch {
      setFileNote("Could not read that file. You can open it and paste the text instead.");
    }
  }

  function onPaste(v: string) {
    reset();
    setText(v);
    raw.current = v;
    setLineCount(v.split(/\r?\n/).filter((l) => l.trim().length > 0).length);
    setFileNote(null);
  }

  async function run() {
    const source = raw.current.trim().length > 0 ? raw.current : text;
    if (!source.trim()) return;
    reset();
    setPending(true);

    const lines = source.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const headerIdx = findHeaderIndex(lines);
    if (headerIdx === -1) {
      setPending(false);
      setError(
        "Steady could not find a time column and a glucose column in that file. Dexcom Clarity and LibreView exports work exactly as they download, headers included.",
      );
      return;
    }

    // Everything up to and including the header is repeated on every slice.
    const preamble = lines.slice(0, headerIdx + 1);
    const body = lines.slice(headerIdx + 1);
    const slices: string[] = [];
    for (let i = 0; i < body.length; i += ROWS_PER_SLICE) {
      slices.push([...preamble, ...body.slice(i, i + ROWS_PER_SLICE)].join("\n"));
    }
    if (slices.length === 0) slices.push(preamble.join("\n"));

    const acc: Summary = {
      format: "unknown",
      found: 0,
      inserted: 0,
      already: 0,
      skipped: 0,
      skippedReasons: {},
      firstAtMs: null,
      lastAtMs: null,
      batch: null,
    };

    setProgress({ done: 0, total: slices.length });
    let batch: string | null = null;

    for (let i = 0; i < slices.length; i++) {
      let res;
      try {
        res = await action({ text: slices[i], batch });
      } catch {
        setPending(false);
        setError(
          acc.inserted > 0
            ? `The connection dropped after ${acc.inserted.toLocaleString()} readings. Those are saved. Press Import again to bring over the rest, duplicates will be left alone.`
            : "Could not reach the app to save that file. Press Import to try again.",
        );
        setSummary(acc.inserted > 0 ? acc : null);
        return;
      }
      if (!res.ok) {
        setPending(false);
        setError(res.error);
        setSummary(acc.inserted > 0 ? acc : null);
        return;
      }
      const ok = res as ChunkOk;
      batch = ok.batch;
      acc.batch = ok.batch;
      acc.format = ok.format;
      acc.found += ok.found;
      acc.inserted += ok.inserted;
      acc.already += ok.found - ok.inserted;
      acc.skipped += ok.skipped;
      for (const [why, n] of Object.entries(ok.skippedReasons)) acc.skippedReasons[why] = (acc.skippedReasons[why] ?? 0) + n;
      if (ok.firstAtMs !== null) acc.firstAtMs = acc.firstAtMs === null ? ok.firstAtMs : Math.min(acc.firstAtMs, ok.firstAtMs);
      if (ok.lastAtMs !== null) acc.lastAtMs = acc.lastAtMs === null ? ok.lastAtMs : Math.max(acc.lastAtMs, ok.lastAtMs);

      setProgress({ done: i + 1, total: slices.length });
      setSummary({ ...acc, skippedReasons: { ...acc.skippedReasons } });
    }

    await finish();
    setPending(false);
    setProgress(null);
  }

  const ready = raw.current.trim().length > 0 || text.trim().length > 0;
  const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="grid gap-4">
      <div className="field">
        <label className="label" htmlFor="csvfile">
          Choose the file you downloaded
        </label>
        <input id="csvfile" type="file" accept=".csv,.txt,text/csv,text/plain" className="input" onChange={onFile} disabled={pending} />
        <p className="hint">
          The file is read here in your browser. Nothing leaves this device, nothing is uploaded to anyone, and the file itself is never saved.
          Long exports are sent to the app in parts so nothing has to be trimmed first.
        </p>
        {fileNote ? <p className="hint">{fileNote}</p> : null}
      </div>

      <div className="field">
        <label className="label" htmlFor="text">
          Or paste the CSV
        </label>
        <textarea
          id="text"
          name="text"
          className="textarea num"
          rows={8}
          spellCheck={false}
          value={text}
          disabled={pending}
          onChange={(e) => onPaste(e.target.value)}
          placeholder={"Timestamp (YYYY-MM-DDThh:mm:ss),Event Type,Glucose Value (mg/dL)\n2026-09-10T07:15:00,EGV,112"}
        />
        <p className="hint">
          {lineCount > 0 ? `${lineCount.toLocaleString()} rows ready.` : "Paste everything, headers included."}
        </p>
      </div>

      <div>
        <button type="button" className="btn btn-lg" disabled={pending || !ready} onClick={run}>
          {pending ? "Importing…" : "Import readings"}
        </button>
      </div>

      {progress ? (
        <div>
          <div className="card-sunk" style={{ height: 8, borderRadius: 999, overflow: "hidden" }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Import progress">
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--juniper)", transition: "width 160ms linear" }} />
          </div>
          <p className="hint mt-2">
            Part {progress.done.toLocaleString()} of {progress.total.toLocaleString()}
            {summary && summary.inserted > 0 ? ` · ${summary.inserted.toLocaleString()} readings added so far` : ""}
          </p>
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      {!pending && !error && summary ? (
        <Notice tone="juniper">
          <span className="font-semibold">
            {summary.inserted === 0
              ? "Every reading in that file was already here, so nothing changed."
              : `Added ${summary.inserted.toLocaleString()} reading${summary.inserted === 1 ? "" : "s"}${summary.already > 0 ? `, and left ${summary.already.toLocaleString()} that were already here` : ""}.`}
          </span>
        </Notice>
      ) : null}

      {summary ? (
        <div className="card-sunk p-4">
          <div className="eyebrow">What was in the file</div>
          <dl className="mt-2 grid gap-2 text-sm md:grid-cols-2">
            <div>
              <dt className="hint">Format detected</dt>
              <dd>{FORMAT_LABEL[summary.format] ?? summary.format}</dd>
            </div>
            <div>
              <dt className="hint">Readings found</dt>
              <dd className="num">{summary.found.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="hint">Covering</dt>
              <dd>{summary.firstAtMs && summary.lastAtMs ? `${fmt(summary.firstAtMs)} to ${fmt(summary.lastAtMs)}` : "No dated rows"}</dd>
            </div>
            <div>
              <dt className="hint">Added</dt>
              <dd className="num">
                {summary.inserted.toLocaleString()} new, {summary.already.toLocaleString()} already here
              </dd>
            </div>
          </dl>

          {summary.skipped > 0 ? (
            <div className="mt-4">
              <div className="eyebrow">
                Skipped {summary.skipped.toLocaleString()} {summary.skipped === 1 ? "row" : "rows"}
              </div>
              <ul className="mt-1 list-disc pl-5 text-sm muted">
                {Object.entries(summary.skippedReasons).map(([why, n]) => (
                  <li key={why}>
                    <span className="num">{n.toLocaleString()}</span> {why}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-sm muted">Nothing was skipped.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
