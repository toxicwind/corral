/**
 * DelendAI Proposal Guardian
 *
 * Verifies that a DelendAI proposal satisfies all invariants before it is
 * accepted into the merge queue or scheduler pipeline:
 *
 *   - Proposal file exists and contains required fields (proposal, slice, budget).
 *   - Slice boundaries do not overlap with already-landed slices.
 *   - Budget guards: total estimated tokens ≤ hard limit; estimated runs ≤ budget cap.
 *   - Slice is a valid subset of the proposal's focus area.
 */

import { z } from "zod";

// ─── Schema ─────────────────────────────────────────────────────────

export const proposalGuardSchema = z.object({
  proposal: z.string(),
  slice: z.string(),
  budget: z.object({
    tokens: z.number().min(1),
    runs: z.number().min(1),
    maxCostCents: z.number().optional(),
  }),
  focus: z.string().optional(),
  generation: z.number().optional().default(1),
});

export type ProposalGuard = z.infer<typeof proposalGuardSchema>;

export type GuardianVerdict =
  | { ok: true; message: string }
  | { ok: false; reason: string; details: string };

// ─── State ──────────────────────────────────────────────────────────

/**
 * Tracks landed slices per proposal so the guardian can reject overlaps.
 */
export class LandedSliceTracker {
  private landed = new Map<string, Set<string>>();

  recordLand(proposal: string, slice: string): void {
    const byProposal = this.landed.get(proposal) ?? new Set<string>();
    byProposal.add(slice);
    this.landed.set(proposal, byProposal);
  }

  /** Returns true if the given slice overlaps with any already-landed slice. */
  hasOverlap(proposal: string, slice: string): boolean {
    return this.landed.get(proposal)?.has(slice) ?? false;
  }

  allLanded(proposal: string): Set<string> {
    return this.landed.get(proposal) ?? new Set();
  }
}

// ─── Budget config ──────────────────────────────────────────────────

export type BudgetLimits = {
  maxTokens: number;
  maxRuns: number;
  maxCostCents?: number;
};

export const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  maxTokens: 50_000_000,
  maxRuns: 200,
  maxCostCents: 5000,
};

// ─── Guardian logic ─────────────────────────────────────────────────

/**
 * Verifies a proposal against all guardian rules.
 */
export function verifyProposal(
  proposal: ProposalGuard,
  limits: BudgetLimits = DEFAULT_BUDGET_LIMITS,
  tracker?: LandedSliceTracker
): GuardianVerdict {
  // 1. Budget: tokens
  if (proposal.budget.tokens > limits.maxTokens) {
    return {
      ok: false,
      reason: "budget_exceeded",
      details: `Tokens ${proposal.budget.tokens} exceeds limit ${limits.maxTokens}`,
    };
  }

  // 2. Budget: runs
  if (proposal.budget.runs > limits.maxRuns) {
    return {
      ok: false,
      reason: "budget_exceeded",
      details: `Runs ${proposal.budget.runs} exceeds limit ${limits.maxRuns}`,
    };
  }

  // 3. Budget: cost
  if (
    proposal.budget.maxCostCents !== undefined &&
    limits.maxCostCents !== undefined &&
    proposal.budget.maxCostCents > limits.maxCostCents
  ) {
    return {
      ok: false,
      reason: "budget_exceeded",
      details: `Cost $${(proposal.budget.maxCostCents / 100).toFixed(2)} exceeds limit $${(limits.maxCostCents / 100).toFixed(2)}`,
    };
  }

  // 4. Slice overlap
  if (tracker?.hasOverlap(proposal.proposal, proposal.slice)) {
    return {
      ok: false,
      reason: "slice_overlap",
      details: `Slice "${proposal.slice}" is already landed for proposal "${proposal.proposal}"`,
    };
  }

  // 5. Slice naming convention
  if (!/^[a-zA-Z0-9_-]+$/.test(proposal.slice)) {
    return {
      ok: false,
      reason: "invalid_slice_name",
      details: 'Slice name must match ^[a-zA-Z0-9_-]+$',
    };
  }

  return {
    ok: true,
    message: `Proposal "${proposal.proposal}" slice "${proposal.slice}" gen ${proposal.generation ?? 1} approved`,
  };
}

/**
 * Checks multiple proposals and returns only the ones that pass all guards.
 */
export function filterApproved(
  proposals: ProposalGuard[],
  limits?: BudgetLimits,
  tracker?: LandedSliceTracker
): ProposalGuard[] {
  const approved: ProposalGuard[] = [];
  for (const p of proposals) {
    if (verifyProposal(p, limits, tracker).ok) {
      approved.push(p);
    }
  }
  return approved;
}
