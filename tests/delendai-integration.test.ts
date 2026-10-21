/**
 * Integration tests for DelendAI module in Corral
 *
 * Tests: getWorktreeRef, parseWorktreeRef, verifyProposal,
 * rankCandidates, ticketsToCandidates, pickNextTicket,
 * LandedSliceTracker, filterApproved.
 *
 * Run: bun test tests/delendai-integration.test.ts
 */

import { describe, test, expect } from "bun:test";
import {
  getWorktreeRef,
  parseWorktreeRef,
  DEFAULT_MERGE_POLICY,
  getMergePolicy,
  type MergePolicy,
} from "../src/delendai/profile.ts";
import {
  verifyProposal,
  LandedSliceTracker,
  DEFAULT_BUDGET_LIMITS,
  filterApproved,
  type ProposalGuard,
} from "../src/delendai/guardian.ts";
import {
  rankCandidates,
  ticketsToCandidates,
  pickNextTicket,
  DEFAULT_BUDGET_POOL,
} from "../src/delendai/optimizer.ts";
import type { Ticket } from "../src/selectors.ts";

// ─── Profile tests ──────────────────────────────────────────────────

describe("profile", () => {
  test("getWorktreeRef generates correct pattern", () => {
    const ref = getWorktreeRef({
      agent: "worker-1",
      kind: "merge",
      proposal: "12",
      slice: "sliceA",
      generation: 1,
      topic: "upgrade-session-queue",
    });
    expect(ref).toBe("wip/worker-1/merge/12-sliceA-g1/upgrade-session-queue");
  });

  test("getWorktreeRef defaults generation to 1", () => {
    const ref = getWorktreeRef({
      agent: "x",
      kind: "research",
      proposal: "42",
      slice: "b",
      topic: "test",
    });
    expect(ref).toBe("wip/x/research/42-b-g1/test");
  });

  test("parseWorktreeRef round-trips", () => {
    const input = {
      agent: "falcon",
      kind: "spec-review",
      proposal: "7",
      slice: "alpha",
      generation: 2,
      topic: "add-auth",
    };
    const ref = getWorktreeRef(input);
    const parsed = parseWorktreeRef(ref);
    expect(parsed).toEqual(input);
  });

  test("parseWorktreeRef returns null for non-matching ref", () => {
    expect(parseWorktreeRef("not-a-ref")).toBeNull();
    expect(parseWorktreeRef("wip/broken")).toBeNull();
  });

  test("default merge policy is squash", () => {
    const policy = getMergePolicy({ priority: "medium", kind: "feature" });
    expect(policy.type).toBe("squash");
  });

  test("critical priority → fast-forward", () => {
    const policy = getMergePolicy({ priority: "critical", kind: "hotfix" });
    expect(policy.type).toBe("fast-forward");
  });

  test("kind 'merge' → rebase with preserveCommits", () => {
    const policy = getMergePolicy({ priority: "high", kind: "merge" });
    expect(policy.type).toBe("rebase");
    expect(policy.type === "rebase" ? policy.preserveCommits : false).toBe(true);
  });
});

// ─── Guardian tests ─────────────────────────────────────────────────

describe("guardian", () => {
  test("valid proposal passes", () => {
    const proposal: ProposalGuard = {
      proposal: "test-proposal",
      slice: "feature-a",
      budget: { tokens: 1_000_000, runs: 10, maxCostCents: 500 },
    };
    const result = verifyProposal(proposal);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain("approved");
  });

  test("excess tokens rejected", () => {
    const proposal: ProposalGuard = {
      proposal: "big-proposal",
      slice: "x",
      budget: { tokens: 999_000_000, runs: 1 },
    };
    const result = verifyProposal(proposal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("budget_exceeded");
  });

  test("excess runs rejected", () => {
    const proposal: ProposalGuard = {
      proposal: "chatty",
      slice: "y",
      budget: { tokens: 100, runs: 999 },
    };
    const result = verifyProposal(proposal);
    expect(result.ok).toBe(false);
  });

  test("slice overlap detected", () => {
    const tracker = new LandedSliceTracker();
    tracker.recordLand("P-1", "alpha");

    const result = verifyProposal(
      { proposal: "P-1", slice: "alpha", budget: { tokens: 100, runs: 1 } },
      DEFAULT_BUDGET_LIMITS,
      tracker
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("slice_overlap");
  });

  test("invalid slice name rejected", () => {
    const proposal: ProposalGuard = {
      proposal: "bad",
      slice: "slice with spaces",
      budget: { tokens: 100, runs: 1 },
    };
    const result = verifyProposal(proposal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_slice_name");
  });

  test("filterApproved only returns valid", () => {
    const proposals: ProposalGuard[] = [
      { proposal: "ok", slice: "a", budget: { tokens: 100, runs: 1 } },
      { proposal: "big", slice: "b", budget: { tokens: 999_000_000, runs: 1 } },
      { proposal: "ok2", slice: "c", budget: { tokens: 200, runs: 2 } },
    ];
    const approved = filterApproved(proposals);
    expect(approved.length).toBe(2);
    expect(approved.map((p) => p.proposal)).toEqual(["ok", "ok2"]);
  });
});

// ─── Optimizer tests ────────────────────────────────────────────────

describe("optimizer", () => {
  test("rankCandidates orders by expected utility", () => {
    const candidates = [
      {
        id: "low",
        title: "Low priority",
        priority: "low",
        estimatedTokens: 100,
        estimatedRuns: 1,
        estimatedCostCents: 1,
        confidence: 0.9,
        relatedTicketId: null,
      },
      {
        id: "critical",
        title: "Critical fix",
        priority: "critical",
        estimatedTokens: 5_000_000,
        estimatedRuns: 10,
        estimatedCostCents: 1000,
        confidence: 0.5,
        relatedTicketId: null,
      },
      {
        id: "high",
        title: "High priority",
        priority: "high",
        estimatedTokens: 500_000,
        estimatedRuns: 5,
        estimatedCostCents: 100,
        confidence: 0.8,
        relatedTicketId: null,
      },
    ];

    const result = rankCandidates(candidates);
    expect(result.ranked.length).toBe(3);
    // high should rank above low (higher priority weight)
    expect(result.ranked[0].id).toBe("high");
    expect(result.ranked[1].id).toBe("critical");
    expect(result.ranked[2].id).toBe("low");
  });

  test("budget exhaustion rejects candidates", () => {
    const candidates = [
      {
        id: "big",
        title: "Expensive",
        priority: "high",
        estimatedTokens: 50_000_000,
        estimatedRuns: 200,
        estimatedCostCents: 5000,
        confidence: 0.5,
        relatedTicketId: null,
      },
    ];

    const result = rankCandidates(candidates, {
      tokens: 1_000,
      runs: 1,
      costCents: 1,
    });

    expect(result.ranked.length).toBe(0);
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0].id).toBe("big");
  });

  test("ticketsToCandidates bridges Corral tickets", () => {
    const tickets: Ticket[] = [
      {
        id: "T-1",
        title: "Add login",
        priority: "high",
        status: "in_progress",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const candidates = ticketsToCandidates(tickets);
    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe("T-1");
    expect(candidates[0].estimatedTokens).toBe(100_000);
    expect(candidates[0].confidence).toBe(0.5);
  });

  test("pickNextTicket picks highest-scoring ticket", () => {
    const tickets: Ticket[] = [
      {
        id: "T-1",
        title: "Low",
        priority: "low",
        status: "new",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "T-2",
        title: "Critical",
        priority: "critical",
        status: "ready",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const picked = pickNextTicket(tickets, 0);
    expect(picked?.id).toBe("T-2");
  });
});
