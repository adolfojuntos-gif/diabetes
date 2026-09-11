"use client";
/**
 * When a pattern card links here as /trends?block=morning, put that block on screen. A ref callback
 * rather than an effect, so this stays one line of behaviour and nothing re-runs on re-render.
 */
export function ScrollToBlock({ id }: { id: string }) {
  return (
    <span
      hidden
      ref={(el) => {
        if (!el) return;
        document.getElementById(id)?.scrollIntoView({ block: "center" });
      }}
    />
  );
}
