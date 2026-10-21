/**
 * DelendAI Optimizer — adaptive candidate ranking and budget estimation
 *
 * Integrates with Corral's TicketScheduler to score and rank candidate
 * proposals before they enter the merge queue. Uses expected utility (cost
 * vs. priority) to produce an ordered candidate list.
 */

import { z } from "zod";
import type { Ticket } from "../selectors";

// ─── Candidate model ────────────────────────────────────────────────

export const candidateSchema = z.object({
  id: z.string(),
  title: z.string(),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  estimatedTokens: z.number(),
  estimatedRuns: z.number(),
  estimatedCostCents: z.number(),
  confidence: z.number().min(0).max(1).default(0.5),
  relatedTicketId: z.string().nullable().default(null),
});

export type Candidate = z.infer<typeof candidateSchema>;

export const rankResultSchema = z.object({
  ranked: z.array(candidateSchema),
  budgetRemaining: z.object({
    tokens: z.number(),
    runs: z.number(),
    costCents: z.number(),
  }),
  rejected: z.array(
    z.object({
      id: z.string(),
      reason: z.string(),
    })
  ),
});

export type RankResult = z.infer<typeof rankResultSchema>;

// ─── Budget pool ────────────────────────────────────────────────────

export type BudgetPool = {
  tokens: number;
  runs: number;
  costCents: number;
};

export const DEFAULT_BUDGET_POOL: BudgetPool = {
  tokens: 50_000_000,
  runs: 200,
  costCents: 5000,
};

/** Consumes budget by deducting candidate's estimates. */
function consumeBudget(pool: BudgetPool, c: Candidate): void {
  pool.tokens -= c.estimatedTokens;
  pool.runs -= c.estimatedRuns;
  pool.costCents -= c.estimatedCostCents;
}

/** Returns whether the candidate fits within the remaining budget. */
function fitsBudget(pool: BudgetPool, c: Candidate): boolean {
  return (
    c.estimatedTokens <= pool.tokens &&
    c.estimatedRuns <= pool.runs &&
    c.estimatedCostCents <= pool.costCents
  );
}

// ─── Scoring ────────────────────────────────────────────────────────

/**
 * Priority weight: critical=4, high=3, medium=2, low=1.
 */
const PRIORITY_WEIGHT: Record<Candidate["priority"], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Computes an expected-utility score for ranking.
 * Higher = better candidate (prioritizes low cost per priority).
 */
function expectedUtilityScore(c: Candidate): number {
  const priorityW = PRIORITY_WEIGHT[c.priority];
  const costPenalty = 1 + c.estimatedCostCents / 1000;
  return (priorityW * c.confidence) / costPenalty;
}

// ─── Ranking ─────────────────────────────────────────────────────────

/**
 * Ranks candidates adaptively: priority first, then expected utility,
 * while respecting the global budget pool.
 */
export function rankCandidates(
  candidates: Candidate[],
  budget: BudgetPool = DEFAULT_BUDGET_POOL
): RankResult {
  const ranked: Candidate[] = [];
  const rejected: { id: string; reason: string }[] = [];
  const remaining = { ...budget };

  // Sort by score descending
  const sorted = [...candidates].sort(
    (a, b) => expectedUtilityScore(b) - expectedUtilityScore(a)
  );

  for (const c of sorted) {
    if (fitsBudget(remaining, c)) {
      consumeBudget(remaining, c);
      ranked.push(c);
    } else {
      rejected.push({
        id: c.id,
        reason: `Exceeds remaining budget (tokens: ${c.estimatedTokens}/${remaining.tokens}, runs: ${c.estimatedRuns}/${remaining.runs}, cost: $${(c.estimatedCostCents / 100).toFixed(2)}/$${(remaining.costCents / 100).toFixed(2)})`,
      });
    }
  }

  return {
    ranked,
    budgetRemaining: remaining,
    rejected,
  };
}

// ─── Integration helpers ────────────────────────────────────────────

/**
 * Derives candidates from existing Corral tickets — used by the optimizer
 * to bridge the TicketScheduler pipeline with the DelendAI merge queue.
 */
export function ticketsToCandidates(tickets: Ticket[]): Candidate[] {
  return tickets.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority ?? "medium",
    estimatedTokens: t.estimatedTokens ?? 100_000,
    estimatedRuns: t.estimatedRuns ?? 5,
    estimatedCostCents: t.estimatedCostCents ?? 100,
    confidence: t.confidence ?? 0.5,
    relatedTicketId: t.parentId ?? null,
  }));
}

/**
 * Picks the next ticket from a ticket list for the scheduler using
 * the DelendAI optimizer score (priority × confidence / cost).
 */
export function pickNextTicket(
  tickets: Ticket[],
  idx: number = 0
): Ticket | undefined {
  if (idx < 0 || idx >= tickets.length) return undefined;
  const sorted = [...tickets].sort(
    (a, b) =>
      expectedUtilityScore({
        ...b,
        estimatedTokens: b.estimatedTokens ?? 100_000,
        estimatedRuns: b.estimatedRuns ?? 5,
        estimatedCostCents: b.estimatedCostCents ?? 100,
        confidence: b.confidence ?? 0.5,
        priority: b.priority ?? "medium",
      } as Candidate) -
      expectedUtilityScore({
        ...a,
        estimatedTokens: a.estimatedTokens ?? 100_000,
        estimatedRuns: a.estimatedRuns ?? 5,
        estimatedCostCents: a.estimatedCostCents ?? 100,
        confidence: a.confidence ?? 0.5,
        priority: a.priority ?? "medium",
      } as Candidate)
  );
  return sorted[idx] ?? sorted[0];
}
