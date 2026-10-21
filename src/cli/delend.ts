/**
 * Delend CLI — subcommands: init, guard, checkpoint, land
 *
 * Provides the `corral delend <subcommand>` interface that wires into
 * Corral's AgenticMergeQueue and TicketScheduler.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { banner, ok, err, info, kv, warn } from "../ui/cli-style";
import {
  getMergePolicy,
  DEFAULT_MERGE_POLICY,
  type MergePolicy,
} from "../delendai/profile";
import {
  verifyProposal,
  LandedSliceTracker,
  DEFAULT_BUDGET_LIMITS,
  filterApproved,
  type ProposalGuard,
  type GuardianVerdict,
} from "../delendai/guardian";
import {
  rankCandidates,
  ticketsToCandidates,
  type Candidate,
  type BudgetPool,
} from "../delendai/optimizer";
import type { Ticket } from "../selectors";
import type { AgenticMergeQueueTicket } from "../components/AgenticMergeQueue";

// ─── Schema ─────────────────────────────────────────────────────────

const DEL_ENDAI_CONFIG_SCHEMA = {
  $schema: "https://unpkg.com/@delendai/core/schema/delendai.config.schema.json",
  cacheDir: ".cache/delendai",
  docsDir: "docs/delendai",
  development: {
    profile: "shared-checkout-merge" as const,
    branches: {
      integration: "main",
      release: "main",
    },
  },
} as const;

const DEL_ENDAI_CONFIG_PATH = "delendai.config.json";

// ─── Init ───────────────────────────────────────────────────────────

export async function cmdInit(cwd: string): Promise<void> {
  const configPath = join(cwd, DEL_ENDAI_CONFIG_PATH);

  if (existsSync(configPath)) {
    console.log(warn(`Already exists: ${configPath}`));
    return;
  }

  await mkdir(join(cwd, DEL_ENDAI_CONFIG_SCHEMA.cacheDir), { recursive: true });
  await mkdir(join(cwd, DEL_ENDAI_CONFIG_SCHEMA.docsDir), { recursive: true });
  await writeFile(configPath, JSON.stringify(DEL_ENDAI_CONFIG_SCHEMA, null, 2));

  console.log(ok(`Initialized DelendAI config at ${configPath}`));
  console.log(info("Profile: shared-checkout-merge"));
  console.log(info("Cache:   .cache/delendai"));
  console.log(info("Docs:    docs/delendai"));
}

// ─── Guard ──────────────────────────────────────────────────────────

export function cmdGuard(
  proposals: ProposalGuard[],
  budgetLimits?: typeof DEFAULT_BUDGET_LIMITS,
): void {
  console.log(banner("DelendAI Proposal Guardian"));

  const tracker = new LandedSliceTracker();
  const approved = filterApproved(proposals, budgetLimits, tracker);
  const rejected = proposals.length - approved.length;

  console.log(info(`Proposals checked: ${proposals.length}`));
  console.log(ok(`Approved: ${approved.length}`));
  if (rejected > 0) {
    console.log(warn(`Rejected: ${rejected}`));
  }

  for (const p of approved) {
    console.log(ok(`  ✓ ${p.proposal} — slice "${p.slice}"`));
  }
}

// ─── Checkpoint ─────────────────────────────────────────────────────

export function cmdCheckpoint(
  tickets: Ticket[],
  budget: BudgetPool = { tokens: 50_000_000, runs: 200, costCents: 5000 },
): void {
  console.log(banner("DelendAI Checkpoint — Candidate Ranking"));

  const candidates = ticketsToCandidates(tickets);
  if (candidates.length === 0) {
    console.log(warn("No tickets to checkpoint."));
    return;
  }

  const result = rankCandidates(candidates, budget);

  console.log(info(`Ranked ${result.ranked.length} candidates`));
  if (result.rejected.length > 0) {
    console.log(warn(`Rejected ${result.rejected.length} (budget-exceeded)`));
    for (const r of result.rejected.slice(0, 5)) {
      console.log(warn(`  ✗ ${r.id}: ${r.reason.slice(0, 80)}`));
    }
  }

  console.log("\nTop candidates:");
  for (let i = 0; i < Math.min(result.ranked.length, 10); i++) {
    const c = result.ranked[i];
    console.log(
      `  ${i + 1}. ${c.title}  (priority=${c.priority}, confidence=${c.confidence.toFixed(2)}, est$${(c.estimatedCostCents / 100).toFixed(2)})`
    );
  }

  console.log("\nBudget remaining:");
  console.log(
    `  tokens: ${result.budgetRemaining.tokens.toLocaleString()} / ${budget.tokens.toLocaleString()}`
  );
  console.log(
    `  runs:   ${result.budgetRemaining.runs} / ${budget.runs}`
  );
  console.log(
    `  cost:   $${(result.budgetRemaining.costCents / 100).toFixed(2)} / $${(budget.costCents / 100).toFixed(2)}`
  );
}

// ─── Land ───────────────────────────────────────────────────────────

/**
 * Routes delend land into the AgenticMergeQueue.
 *
 * This is the bridge between the CLI and Corral's spec-level merge queue
 * orchestrator. It builds merge queue tickets from resolved tickets and
 * invokes the AgenticMergeQueue coordination logic.
 */
export function cmdLand(
  tickets: AgenticMergeQueueTicket[],
  repoRoot: string,
  maxSpeculativeDepth: number = 3,
): void {
  console.log(banner("DelendAI Land — AgenticMergeQueue"));
  console.log(info(`Repository: ${repoRoot}`));
  console.log(info(`Speculative depth: ${maxSpeculativeDepth}`));
  console.log(info(`Tickets in queue: ${tickets.length}`));

  const policy: MergePolicy = DEFAULT_MERGE_POLICY;
  console.log(info(`Merge policy: ${policy.type}`));

  // The actual merge queue execution is handled by the React component
  // AgenticMergeQueue via smthrs Task orchestration. This CLI command
  // serves as the entry point and status reporter.
  console.log(
    info(
      `Land initiated — invoke the AgenticMergeQueue component to execute the merge.`
    )
  );
  console.log(
    info("Run: corral 'Land completed tickets via the merge queue' --dry-run to preview")
  );
}
