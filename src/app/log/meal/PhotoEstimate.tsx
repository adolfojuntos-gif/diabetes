"use client";
/**
 * The photo flow. A picture goes to the model as base64, never to disk, and what comes back is an
 * estimate the person edits before it touches the form. Nothing here is presented as a measurement.
 */
import { useActionState, useRef, useState } from "react";
import { Notice } from "@/components/ui";
import type { PhotoAction, PhotoItem, PhotoResult } from "../types";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * A server action request is capped at 1 MB, and a phone photo is usually several times that. So
 * the picture is redrawn smaller in the browser before it is posted: 1280px on the long edge is
 * far more than the model needs to recognise food, and it keeps the request small. The original
 * file is never uploaded and never written anywhere.
 */
const MAX_EDGE = 1280;

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  // White underneath, so a transparent PNG does not come out on black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("no blob");
  return blob;
}

const CONFIDENCE_LABEL: Record<PhotoItem["confidence"], string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

function setField(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (el) el.value = value;
}

export function PhotoEstimate({ action, available }: { action: PhotoAction; available: boolean }) {
  const [state, formAction, pending] = useActionState<PhotoResult | null, FormData>(action, null);
  const [items, setItems] = useState<PhotoItem[] | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [working, setWorking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Which result has already been copied into the editable list below. */
  const [absorbed, setAbsorbed] = useState<PhotoResult | null>(null);

  /**
   * The estimate arrives from the action and then becomes EDITABLE, because the whole point is that
   * a photo estimate is a starting point the person corrects. So it has to be copied into local
   * state once, and only once, per result.
   *
   * Adjusted during render rather than in an effect. An effect that calls setState runs after the
   * browser has already painted the old list, so the screen showed the previous estimate for a
   * frame before swapping. Comparing against the result already absorbed re-renders immediately
   * instead, which is React's documented way to adjust state when an input changes.
   */
  if (state !== absorbed) {
    setAbsorbed(state);
    if (state && state.ok) {
      setItems(state.items);
      setAccepted(false);
    }
  }

  if (!available) {
    return (
      <div className="card-quiet p-4">
        <div className="eyebrow">Photo estimate</div>
        <p className="mt-1 text-sm muted prose-measure">
          Estimating a meal from a photo needs an Anthropic API key, and there is not one set up here. Everything else on this page works as
          normal, so carry on and fill the form in yourself.
        </p>
      </div>
    );
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setLocalError(null);
    const f = e.target.files?.[0];
    if (!f) return;
    if (!TYPES.includes(f.type)) {
      setLocalError("Please choose a JPEG, PNG, WebP or GIF photo.");
      e.target.value = "";
      return;
    }
    if (f.size > MAX_BYTES) {
      setLocalError("That photo is over 5 MB. Most phones can take a smaller one, or you can crop it down.");
      e.target.value = "";
      return;
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError(null);
    const f = fileRef.current?.files?.[0];
    if (!f) {
      setLocalError("Choose a photo first.");
      return;
    }
    if (!TYPES.includes(f.type)) {
      setLocalError("Please choose a JPEG, PNG, WebP or GIF photo.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setLocalError("That photo is over 5 MB. Most phones can take a smaller one, or you can crop it down.");
      return;
    }
    setWorking(true);
    try {
      const small = await shrink(f);
      const fd = new FormData();
      fd.append("photo", small, "meal.jpg");
      formAction(fd);
    } catch {
      setLocalError("Could not read that photo. Try another one, or fill the form in below.");
    } finally {
      setWorking(false);
    }
  }

  const total = items ? items.reduce((a, i) => a + (Number(i.carbsG) || 0), 0) : 0;
  const totalCal = items ? items.reduce((a, i) => a + (Number(i.caloriesKcal) || 0), 0) : 0;

  function edit(idx: number, patch: Partial<PhotoItem>) {
    setItems((prev) => (prev ? prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)) : prev));
    setAccepted(false);
  }

  function accept() {
    if (!items || items.length === 0) return;
    const keep = items.filter((i) => i.name.trim().length > 0);
    setField("meal-name", keep.map((i) => i.name.trim()).join(", ").slice(0, 200));
    setField("meal-carbs", String(Math.round(keep.reduce((a, i) => a + (Number(i.carbsG) || 0), 0))));
    setField("meal-calories", String(Math.round(keep.reduce((a, i) => a + (Number(i.caloriesKcal) || 0), 0))));
    setField("meal-estimate-source", "photo");
    setField("meal-items", JSON.stringify(keep));
    setAccepted(true);
    document.getElementById("meal-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={onSubmit} className="grid gap-3">
        <div className="field">
          <label className="label" htmlFor="photo">
            Photo of the meal
          </label>
          <input
            id="photo"
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="input"
            ref={fileRef}
            onChange={onPick}
          />
          <p className="hint">
            Up to 5 MB. It is made smaller here on your device, sent for the estimate, and then dropped. The photo is never saved, and neither
            is anything that identifies it.
          </p>
        </div>
        <div>
          <button type="submit" className="btn btn-slate" disabled={pending || working}>
            {working ? "Getting the photo ready…" : pending ? "Looking at the photo…" : "Estimate from photo"}
          </button>
        </div>
        {localError ? <p className="error">{localError}</p> : null}
        {state && !state.ok ? <p className="error">{state.error}</p> : null}
      </form>

      {items ? (
        <div className="card-sunk p-4">
          <h3>Estimates, not measurements</h3>
          {state && state.ok && state.note ? <p className="mt-1 text-sm muted prose-measure">{state.note}</p> : null}
          <p className="mt-2 text-sm muted prose-measure">
            A camera cannot know exact nutrition. It cannot see oil in the pan, sugar in the sauce, or how deep the bowl is. Please correct
            anything that looks wrong before you accept it.
          </p>

          {items.length === 0 ? (
            <p className="mt-3 text-sm">No food was recognised in that photo. You can fill the form in below instead.</p>
          ) : (
            <>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="pb-2 pr-2 font-semibold">Food</th>
                      <th className="pb-2 pr-2 font-semibold">Portion</th>
                      <th className="pb-2 pr-2 font-semibold">Carbs g</th>
                      <th className="pb-2 pr-2 font-semibold">Calories</th>
                      <th className="pb-2 font-semibold">How sure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={i}>
                        <td className="py-1 pr-2">
                          <label className="sr-only" htmlFor={`it-name-${i}`}>
                            Food {i + 1}
                          </label>
                          <input
                            id={`it-name-${i}`}
                            className="input"
                            value={it.name}
                            onChange={(e) => edit(i, { name: e.target.value })}
                            maxLength={80}
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <label className="sr-only" htmlFor={`it-portion-${i}`}>
                            Portion for {it.name || `food ${i + 1}`}
                          </label>
                          <input
                            id={`it-portion-${i}`}
                            className="input"
                            value={it.portion}
                            onChange={(e) => edit(i, { portion: e.target.value })}
                            maxLength={60}
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <label className="sr-only" htmlFor={`it-carbs-${i}`}>
                            Carbs in grams for {it.name || `food ${i + 1}`}
                          </label>
                          <input
                            id={`it-carbs-${i}`}
                            className="input num w-24"
                            inputMode="numeric"
                            value={String(it.carbsG)}
                            onChange={(e) => edit(i, { carbsG: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })}
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <label className="sr-only" htmlFor={`it-cal-${i}`}>
                            Calories for {it.name || `food ${i + 1}`}
                          </label>
                          <input
                            id={`it-cal-${i}`}
                            className="input num w-24"
                            inputMode="numeric"
                            value={String(it.caloriesKcal)}
                            onChange={(e) => edit(i, { caloriesKcal: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })}
                          />
                        </td>
                        <td className="py-1">
                          <span className="pill">{CONFIDENCE_LABEL[it.confidence]}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" className="btn" onClick={accept}>
                  Use these numbers
                </button>
                <span className="text-sm muted num">
                  {Math.round(total)} g carbs · {Math.round(totalCal)} kcal
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setItems(null);
                    setAccepted(false);
                  }}
                >
                  Discard the estimate
                </button>
              </div>

              {accepted ? (
                <div className="mt-3">
                  <Notice tone="juniper">
                    The form below is filled in. Check the name, the time and the slot, then save. The meal will be marked as estimated from a
                    photo.
                  </Notice>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
