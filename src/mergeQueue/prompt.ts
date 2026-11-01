/**
 * Merge Queue Prompts — extracted from coordinator.ts
 */

import type { MergeQueueRequest } from "./types";

export const REQUEST_MARKER = "SUPER_RALPH_SPECULATIVE_MERGE_QUEUE_REQUEST";

export function buildSpeculativeMergeQueuePrompt(request: MergeQueueRequest): string {
  const ciCommands = request.postLandChecks.length
    ? request.postLandChecks.map((cmd) => `- ${cmd}`).join("\n")
    : "- (none)";

  return [
    "MERGE QUEUE COORDINATOR TASK",
    "",
    "Coordinate speculative merge-queue landing for this ticket using jj.",
    "Requirements:",
    "- Respect queue order and speculative stack semantics.",
    "- Rebase each speculative ticket onto main + tickets ahead.",
    "- Run post-land checks in parallel for the speculative window.",
    "- Evict failed/conflicting tickets and re-test downstream tickets.",
    "- Fast-forward main to the furthest passing speculative ticket.",
    "",
    `Post-land checks:`,
    ciCommands,
    "",
    `${REQUEST_MARKER}`,
    JSON.stringify(request),
  ].join("\n");
}

export function extractRequestFromPrompt(prompt: string): MergeQueueRequest {
  const markerIndex = prompt.indexOf(REQUEST_MARKER);
  if (markerIndex === -1) {
    throw new Error("Merge queue request marker not found in prompt.");
  }
  const jsonStart = prompt.indexOf("{", markerIndex);
  if (jsonStart === -1) {
    throw new Error("Merge queue request JSON start not found in prompt.");
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = jsonStart; i < prompt.length; i++) {
    const ch = prompt[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end === -1) {
    throw new Error("Merge queue request JSON block is not balanced.");
  }

  const jsonText = prompt.slice(jsonStart, end);
  try {
    return JSON.parse(jsonText) as MergeQueueRequest;
  } catch (err) {
    throw new Error(
      `Failed to parse merge queue request JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
