/**
 * DelendAI Development Profile — shared-checkout-merge
 *
 * Implements the shared-checkout-merge development profile used by the
 * DelendAI proposal guardian, worktree naming conventions, and branch
 * merge policies. This module is the profile configuration layer; the
 * guardian (guardian.ts) verifies proposals against it, and the optimizer
 * (optimizer.ts) uses it for budget estimation.
 */

import { z } from "zod";

// ─── Development profile schema ─────────────────────────────────────

export const DEL_ENDAI_DEV_PROFILE_SCHEMA = z.object({
  profile: z.literal("shared-checkout-merge"),
  worktreeNaming: z
    .object({
      pattern: z
        .literal("wip/${agent}/${kind}/${proposal}-${slice}-g${generation}/${topic}"),
    })
    .optional(),
  branches: z
    .object({
      integration: z.string().default("main"),
      release: z.string().default("main"),
    })
    .optional(),
});

export type DelendAIDevProfile = z.infer<typeof DEL_ENDAI_DEV_PROFILE_SCHEMA>;

// ─── Worktree ref helpers ───────────────────────────────────────────

/**
 * Constructs the worktree ref from the naming convention.
 *
 * @example `wip/worker-1/merge/12-sliceA-g1/upgrade-session-queue`
 */
export function getWorktreeRef(
  opts: {
    agent: string;
    kind: string;
    proposal: string;
    slice: string;
    generation?: number;
    topic: string;
  }
): string {
  const generation = opts.generation ?? 1;
  return `wip/${opts.agent}/${opts.kind}/${opts.proposal}-${opts.slice}-g${generation}/${opts.topic}`;
}

/**
 * Parses a worktree ref back into its components.
 * Returns `null` if the ref does not match the expected pattern.
 */
export function parseWorktreeRef(
  ref: string
): {
  agent: string;
  kind: string;
  proposal: string;
  slice: string;
  generation: number;
  topic: string;
} | null {
  const match = ref.match(
    /^wip\/([^/]+)\/([^/]+)\/([^/]+?)-([^/-]+)(-g(\d+))?\/(.+)$/
  );
  if (!match) return null;
  return {
    agent: match[1],
    kind: match[2],
    proposal: match[3],
    slice: match[4],
    generation: parseInt(match[6], 10) || 1,
    topic: match[7],
  };
}

// ─── Branch merge policies ─────────────────────────────────────────

export type MergePolicy =
  | { type: "fast-forward"; squash: false }
  | { type: "squash"; commitMessage?: string }
  | { type: "rebase"; preserveCommits: boolean };

/** Default merge policy for shared-checkout-merge: squash with agent attribution. */
export const DEFAULT_MERGE_POLICY: MergePolicy = {
  type: "squash",
  commitMessage: "delendai: ${topic} (proposal ${proposal}, slice ${slice}, gen ${generation})",
};

/**
 * Returns the merge policy for a given proposal / slice.
 * Override points can be added here for tiered policies.
 */
export function getMergePolicy(
  opts: { priority?: "critical" | "high" | "medium" | "low"; kind: string }
): MergePolicy {
  if (opts.priority === "critical") {
    return { type: "fast-forward", squash: false };
  }
  if (opts.kind === "merge") {
    return { type: "rebase", preserveCommits: true };
  }
  return DEFAULT_MERGE_POLICY;
}
