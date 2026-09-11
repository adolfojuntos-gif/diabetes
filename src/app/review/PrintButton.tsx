"use client";
/** The one piece of this page that needs the browser: printing it. */
export function PrintButton() {
  return (
    <button type="button" className="btn btn-secondary no-print" onClick={() => window.print()}>
      Print this review
    </button>
  );
}
