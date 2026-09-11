"use client";
/**
 * The tags field. Free text, comma separated; the chips are only a shortcut for words people type
 * over and over, and tapping one appends it rather than replacing anything.
 */
import { useState } from "react";

const SUGGESTIONS = ["pasta", "rice", "bread", "restaurant", "takeout", "homemade", "late", "large portion", "high fibre"];

export function TagChips() {
  const [value, setValue] = useState("");

  const present = new Set(
    value
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  function append(tag: string) {
    setValue((prev) => {
      const parts = prev
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.some((p) => p.toLowerCase() === tag)) return parts.filter((p) => p.toLowerCase() !== tag).join(", ");
      return [...parts, tag].join(", ");
    });
  }

  return (
    <div className="field">
      <label className="label" htmlFor="meal-tags">
        Tags
      </label>
      <input
        id="meal-tags"
        name="tags"
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="pasta, restaurant, late"
        maxLength={200}
      />
      <p className="hint">Your own words, separated by commas. Trends groups meals by tag, so whatever you call things is what you will see.</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className={present.has(s) ? "btn btn-sm" : "btn btn-secondary btn-sm"}
            aria-pressed={present.has(s)}
            onClick={() => append(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
