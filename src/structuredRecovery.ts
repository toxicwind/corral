/**
 * Structured-output enforcement with bounded recovery (beyond super-ralph).
 *
 * Super-ralph's failure mode, observed live: a stage returns empty or
 * malformed output, the parse throws, and the run either retries blindly or
 * falls back to hardcoded data with zero repair attempt. This module closes
 * that gap:
 *
 *   1. extractJson — strip markdown fences, then balanced-brace scan for the
 *      first top-level JSON value (models love trailing commentary).
 *   2. parseWithRecovery — zod safeParse; on failure, ONE bounded repair
 *      attempt: re-prompt the model with the exact zod issues and retry.
 *      No retry-spin: maxAttempts defaults to 2 (initial + 1 repair).
 *
 * The repair callback is supplied by the caller (usually a second
 * proxyChatCompletions call with the validation feedback appended).
 */
import { z } from "zod";

export type ParseOutcome<T> =
  | { ok: true; data: T; repaired: boolean; attempts: number }
  | { ok: false; error: string; attempts: number };

/**
 * Extract the most plausible JSON payload from raw model text.
 * Handles: bare JSON, ```json fenced blocks, leading/trailing prose.
 */
export function extractJson(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  // Prefer fenced block content when present.
  const fence = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence) s = fence[1].trim();
  // Balanced scan for the first top-level object/array.
  const startIdx = s.search(/[{[]/);
  if (startIdx === -1) return s;
  const open = s[startIdx];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = startIdx; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(startIdx, i + 1);
    }
  }
  return s.slice(startIdx);
}

function zodIssuesText(err: z.ZodError): string {
  return err.issues
    .map(i => `path=${i.path.join(".") || "(root)"} code=${i.code} message=${i.message}`)
    .join("; ")
    .slice(0, 1200);
}

/**
 * Parse raw model output against a zod schema with one bounded repair round.
 *
 * @param schema   zod schema for the expected shape
 * @param rawText  raw model output
 * @param repair   called once with human-readable validation feedback;
 *                 must return the model's corrected raw output
 * @param opts.maxAttempts total parse attempts (default 2)
 */
export async function parseWithRecovery<T>(
  schema: z.ZodType<T>,
  rawText: string,
  repair: (feedback: string) => Promise<string>,
  opts: { maxAttempts?: number } = {},
): Promise<ParseOutcome<T>> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
  let current = rawText;
  let lastError = "empty output";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = extractJson(current);
    if (candidate.trim()) {
      try {
        const parsed: unknown = JSON.parse(candidate);
        const res = schema.safeParse(parsed);
        if (res.success) {
          return { ok: true, data: res.data, repaired: attempt > 1, attempts: attempt };
        }
        lastError = zodIssuesText(res.error);
      } catch (e: any) {
        lastError = `JSON.parse failed: ${String(e?.message ?? e).slice(0, 300)}`;
      }
    } else {
      lastError = "empty output after extraction";
    }
    if (attempt < maxAttempts) {
      const feedback =
        `Your previous output failed validation. Fix ONLY the validation errors and ` +
        `return the corrected JSON with no commentary, no markdown fences.\n` +
        `Validation errors: ${lastError}`;
      try {
        current = await repair(feedback);
      } catch (e: any) {
        return {
          ok: false,
          error: `repair call failed: ${String(e?.message ?? e).slice(0, 300)}`,
          attempts: attempt,
        };
      }
    }
  }
  return { ok: false, error: lastError, attempts: maxAttempts };
}