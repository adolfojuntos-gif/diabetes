import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const AI_MODEL = process.env.AI_MODEL ?? "claude-opus-5";

export function aiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let cached: Anthropic | null = null;
export function aiClient(): Anthropic {
  if (!cached) cached = new Anthropic({ timeout: 90_000, maxRetries: 1 });
  return cached;
}

/** Pull the first text block out of a response. */
export function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** Tolerant JSON extraction: the whole reply, or the first {...} block. */
export function extractJson<T>(text: string): T | null {
  const t = text.trim();
  try {
    return JSON.parse(t) as T;
  } catch {
    /* fall through */
  }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]) as T;
    } catch {
      /* fall through */
    }
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
  return null;
}
