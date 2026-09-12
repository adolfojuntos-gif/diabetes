/**
 * Shared building blocks. Server-safe (no hooks) unless marked.
 */
import Link from "next/link";
import type { Band } from "@/lib/units";
import { bandOf, formatGlucose, unitLabel, BAND_LABEL } from "@/lib/units";
import type { Units } from "@/lib/db/schema";
import type { TriageResult } from "@/lib/engines/triage";
import { ACTION_TEXT } from "@/lib/engines/triage";
import type { Pattern } from "@/lib/engines/patterns";
import { PatternEvidenceChart } from "./PatternChart";

export function PageHeader({ eyebrow, title, lede, action }: { eyebrow?: string; title: string; lede?: string; action?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {lede ? <p className="lede mt-2 prose-measure">{lede}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function Card({ children, className = "", as: As = "section" }: { children: React.ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <As className={`card p-4 md:p-5 ${className}`}>{children}</As>;
}

export function Stat({ label, value, unit, sub, band }: { label: string; value: string | number; unit?: string; sub?: string; band?: Band }) {
  return (
    <div className="card-sunk p-3 md:p-4">
      <div className="eyebrow">{label}</div>
      <div className={`num text-2xl md:text-3xl font-display mt-1 ${band ? `band-${band}` : ""}`}>
        {value}
        {unit ? <span className="text-sm font-body muted ml-1">{unit}</span> : null}
      </div>
      {sub ? <div className="hint mt-1">{sub}</div> : null}
    </div>
  );
}

export function GlucoseChip({ mgdl, units, low, high, showUnit = true }: { mgdl: number; units: Units; low?: number; high?: number; showUnit?: boolean }) {
  const band = bandOf(mgdl, low, high);
  return (
    <span className={`pill chip-${band} num`} title={BAND_LABEL[band]}>
      {formatGlucose(mgdl, units)}
      {showUnit ? <span className="font-normal opacity-80">{unitLabel(units)}</span> : null}
    </span>
  );
}

export function EmptyState({ title, body, cta, href }: { title: string; body: string; cta?: string; href?: string }) {
  return (
    <div className="card-quiet p-6 text-center">
      <h3>{title}</h3>
      <p className="muted mt-1 prose-measure mx-auto">{body}</p>
      {cta && href ? (
        <Link href={href} className="btn mt-4">
          {cta}
        </Link>
      ) : null}
    </div>
  );
}

/** The safety banner. Fixed text from the engine; the model never writes this. */
export function TriageBanner({ t, compact = false }: { t: TriageResult; compact?: boolean }) {
  if (t.level === "general" && compact) return null;
  return (
    <div className={`triage triage-${t.level}`} role={t.level === "emergency" || t.level === "urgent" ? "alert" : "status"}>
      <div className="eyebrow" style={{ color: "inherit", opacity: 0.8 }}>
        {t.level === "emergency" ? "Emergency" : t.level === "urgent" ? "Urgent" : t.level === "clinic" ? "For your care team" : "Safety check"}
      </div>
      <div className="font-display text-xl mt-1">{t.headline}</div>
      <p className="mt-1 text-sm" style={{ opacity: 0.92 }}>{t.body}</p>
      {t.reasons.length ? (
        <ul className="mt-2 text-sm list-disc pl-5" style={{ opacity: 0.92 }}>
          {t.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {t.actions.length ? (
        <div className="mt-3 grid gap-2">
          {t.actions.map((a) => (
            <div
              key={a}
              className="rounded-lg px-3 py-2 text-sm"
              /*
               * A quarter-white wash was tuned for a solid coral banner on a white page. On the darker
               * urgent and clinic banners it lifts the box almost to the banner's own text colour, so
               * it is lighter here and paired with a hairline that does the separating instead.
               */
              style={{ background: "rgb(255 255 255 / 0.12)", boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.16)" }}
            >
              {ACTION_TEXT[a]}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PatternCard({ p, units = "mgdl" }: { p: Pattern; units?: Units }) {
  return (
    <article className={`card p-4 sev-${p.severity}`}>
      <div className="flex items-center justify-between gap-2">
        <h3>{p.title}</h3>
        <span className={`pill ${p.severity === "win" ? "pill-juniper" : p.severity === "attention" ? "pill-coral" : p.severity === "watch" ? "pill-amber" : ""}`}>
          {p.severity === "win" ? "Win" : p.severity === "attention" ? "Attention" : p.severity === "watch" ? "Watch" : "Note"}
        </span>
      </div>
      <p className="mt-1 text-sm">{p.evidence}</p>
      {/**
       * The chart sits between the finding and the suggestion, because that is the order somebody
       * reads in: what happened, what it looks like, what to do about it. It is drawn from the
       * engine's own spec and adds no number the sentence above does not already state.
       */}
      {p.chart ? (
        <div className="mt-3">
          <PatternEvidenceChart chart={p.chart} severity={p.severity} units={units} />
        </div>
      ) : null}
      <p className="mt-2 text-sm muted">{p.suggestion}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={p.href} className="btn btn-secondary btn-sm">See the evidence</Link>
        {p.doctorQuestion ? <Link href="/toolkit/questions" className="btn btn-ghost btn-sm">Question for your doctor</Link> : null}
      </div>
    </article>
  );
}

export function TirBar({ pct }: { pct: Record<Band, number> }) {
  const order: Band[] = ["very_low", "low", "in_range", "high", "very_high"];
  return (
    <div className="tir-bar" role="img" aria-label={order.map((b) => `${BAND_LABEL[b]} ${pct[b].toFixed(0)}%`).join(", ")}>
      {order.map((b) => (pct[b] > 0 ? <div key={b} className={`bg-band-${b}`} style={{ width: `${pct[b]}%` }} /> : null))}
    </div>
  );
}

export function Notice({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "amber" | "juniper" }) {
  const bg = tone === "amber" ? "var(--amber-soft)" : tone === "juniper" ? "var(--juniper-soft)" : "var(--slate-soft)";
  return (
    <div className="rounded-xl px-4 py-3 text-sm" style={{ background: bg }}>
      {children}
    </div>
  );
}
