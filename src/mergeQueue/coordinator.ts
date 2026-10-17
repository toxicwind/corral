
import { workspaceAdd } from "smthrs";
import type { AgentLike } from "smthrs";
import type {
  MergeQueueTicket,
  MergeQueueLandResult,
  MergeQueueOrderingStrategy,
  QueueEntry,
  CommandResult,
  MergeQueueOps,
  MergeQueueRequest,
  EvictReason,
} from "./types";
import { createDefaultOps } from "./ops";
import { REQUEST_MARKER, buildSpeculativeMergeQueuePrompt, extractRequestFromPrompt } from "./prompt";
import { runJj } from "smthrs";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Re-export for public API
export { REQUEST_MARKER, buildSpeculativeMergeQueuePrompt, extractRequestFromPrompt };
export type { MergeQueueTicket, MergeQueueLandResult, MergeQueueOrderingStrategy, MergeQueueRequest, MergeQueueOps };

function bookmarkRev(ticketId: string): string {
  return `bookmark("ticket/${ticketId}")`;
}

function truncate(text: string, maxChars = 12000): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

async function runJjCommand(repoRoot: string, args: string[]): Promise<CommandResult> {
  const res: any = await (runJj as any)(args, { cwd: repoRoot });
  return { code: res?.code ?? 0, stdout: res?.stdout ?? "", stderr: res?.stderr ?? "" };
}

function createDefaultMergeQueueOps(): MergeQueueOps {
  return createDefaultOps();
}

async function collectDefaultEvictionContext(repoRoot: string, ticketId: string) {
  return {
    attemptedLog: null,
    attemptedDiffSummary: null,
    landedOnMainSinceBranch: null,
  };
}

async function cleanupDefaultTicketResources(repoRoot: string, ticket: MergeQueueTicket) {
  // no-op
}

  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

type EvictReason =
  | "rebase_conflict"
  | "ci_failed"
  | "review_failed"
  | "push_failed"
  | "fast_forward_failed"
  | "fetch_failed";

export class SpeculativeMergeQueueCoordinator {
  private entries = new Map<string, QueueEntry>();
  private enqueueCounter = 0;
  private processing: Promise<void> | null = null;
  private orderingStrategy: MergeQueueOrderingStrategy = "report-complete-fifo";
  private maxSpeculativeDepth = 1;
  private postLandChecks: string[] = [];
  private postRebaseReviewAgent?: AgentLike;

  constructor(
    private repoRoot: string,
    private readonly ops: MergeQueueOps = createDefaultMergeQueueOps(),
  ) {}

  async enqueue(request: MergeQueueRequest): Promise<MergeQueueLandResult> {
    this.repoRoot = request.repoRoot;
    this.orderingStrategy = request.orderingStrategy;
    this.maxSpeculativeDepth = Math.max(1, Math.floor(request.maxSpeculativeDepth || 1));
    this.postLandChecks = request.postLandChecks ?? [];
    if (request.postRebaseReviewAgent) {
      this.postRebaseReviewAgent = request.postRebaseReviewAgent;
    }

    this.ingestSnapshot(request.queueSnapshot);
    const requestIndex = request.queueSnapshot.findIndex(
      (t) => t.ticketId === request.ticket.ticketId,
    );
    const entry = this.upsertEntry(
      request.ticket,
      requestIndex >= 0 ? requestIndex : Number.MAX_SAFE_INTEGER,
      request.readyForQueue,
    );

    if (!request.readyForQueue) {
      return this.notReadyResult(request.ticket.ticketId);
    }

    if (
      entry.status === "resolved" &&
      entry.result &&
      request.ticket.reportIteration <= entry.ticket.reportIteration
    ) {
      return entry.result;
    }

    if (request.ticket.reportIteration > entry.ticket.reportIteration) {
      entry.ticket = request.ticket;
      entry.status = "pending";
      entry.readyForQueue = true;
      entry.invalidatedCount = 0;
      entry.result = undefined;
    }

    const resultPromise = new Promise<MergeQueueLandResult>((resolve) => {
      entry.waiters.push(resolve);
    });

    this.ensureProcessing();
    return await resultPromise;
  }

  private ensureProcessing() {
    if (this.processing) return;
    this.processing = this.processLoop().finally(() => {
      this.processing = null;
      if (this.getOrderedPendingEntries().length > 0) {
        this.ensureProcessing();
      }
    });
  }

  private ingestSnapshot(snapshot: MergeQueueTicket[]) {
    snapshot.forEach((ticket, idx) => {
      this.upsertEntry(ticket, idx, true);
    });
  }

  private upsertEntry(
    ticket: MergeQueueTicket,
    snapshotIndex: number,
    readyForQueue: boolean,
  ): QueueEntry {
    const existing = this.entries.get(ticket.ticketId);
    if (!existing) {
      const next: QueueEntry = {
        ticket,
        status: "pending",
        readyForQueue,
        enqueueSeq: this.enqueueCounter++,
        snapshotIndex,
        invalidatedCount: 0,
        waiters: [],
      };
      this.entries.set(ticket.ticketId, next);
      return next;
    }

    if (ticket.reportIteration > existing.ticket.reportIteration) {
      existing.status = "pending";
      existing.result = undefined;
      existing.invalidatedCount = 0;
      existing.waiters = [];
      existing.enqueueSeq = this.enqueueCounter++;
    }

    existing.ticket = {
      ...existing.ticket,
      ...ticket,
    };
    existing.readyForQueue = existing.readyForQueue || readyForQueue;
    existing.snapshotIndex = snapshotIndex;
    return existing;
  }

  private getOrderedPendingEntries(): QueueEntry[] {
    const pending = [...this.entries.values()].filter(
      (entry) => entry.status === "pending" && entry.readyForQueue,
    );

    switch (this.orderingStrategy) {
      case "priority":
        pending.sort((a, b) => {
          const rankA = priorityRank[a.ticket.priority] ?? 99;
          const rankB = priorityRank[b.ticket.priority] ?? 99;
          if (rankA !== rankB) return rankA - rankB;
          if (a.ticket.reportIteration !== b.ticket.reportIteration) {
            return a.ticket.reportIteration - b.ticket.reportIteration;
          }
          return a.enqueueSeq - b.enqueueSeq;
        });
        return pending;
      case "ticket-order":
        pending.sort((a, b) => {
          if (a.snapshotIndex !== b.snapshotIndex) {
            return a.snapshotIndex - b.snapshotIndex;
          }
          return a.enqueueSeq - b.enqueueSeq;
        });
        return pending;
      case "report-complete-fifo":
      default:
        pending.sort((a, b) => {
          if (a.ticket.reportIteration !== b.ticket.reportIteration) {
            return a.ticket.reportIteration - b.ticket.reportIteration;
          }
          return a.enqueueSeq - b.enqueueSeq;
        });
        return pending;
    }
  }

  private async processLoop() {
    while (true) {
      const pending = this.getOrderedPendingEntries();
      if (pending.length === 0) return;

      const window = pending.slice(0, this.maxSpeculativeDepth);
      const fetch = await this.ops.fetchMain(this.repoRoot);
      if (!fetch.ok) {
        await this.evictEntry(window[0]!, "fetch_failed", fetch.details);
        continue;
      }

      let destination = "main";
      let rebaseFailure: { entry: QueueEntry; details: string } | null = null;

      for (const entry of window) {
        const rebase = await this.ops.rebase(
          this.repoRoot,
          entry.ticket.ticketId,
          destination,
        );
        if (!rebase.ok) {
          rebaseFailure = { entry, details: rebase.details };
          break;
        }
        destination = bookmarkRev(entry.ticket.ticketId);
      }

      if (rebaseFailure) {
        await this.evictEntry(
          rebaseFailure.entry,
          "rebase_conflict",
          rebaseFailure.details,
        );
        continue;
      }

      // Post-rebase review gate: LLM inspects rebased state for semantic issues
      if (this.postRebaseReviewAgent) {
        const reviewResults = await Promise.all(
          window.map(async (entry) => {
            try {
              const [logResult, diffResult, mainChangesResult] = await Promise.all([
                runJjCommand(this.repoRoot, [
                  "log", "-r", `main..${bookmarkRev(entry.ticket.ticketId)}`, "--reversed",
                ]),
                runJjCommand(this.repoRoot, [
                  "diff", "-r", `roots(main..${bookmarkRev(entry.ticket.ticketId)})`, "--stat",
                ]),
                runJjCommand(this.repoRoot, [
                  "log", "-r", `${bookmarkRev(entry.ticket.ticketId)}..main`, "--reversed",
                ]),
              ]);

              const prompt = [
                "POST-REBASE REVIEW",
                "",
                `Ticket: ${entry.ticket.ticketId}`,
                `Title: ${entry.ticket.ticketTitle}`,
                `Category: ${entry.ticket.ticketCategory}`,
                "",
                "This ticket's branch was just rebased onto the latest main. Review the rebased state for semantic issues",
                "that a clean file-level merge might miss (e.g. conflicting logic, broken imports, duplicated functionality,",
                "incompatible API changes).",
                "",
                "## Rebased commits",
                "```",
                logResult.code === 0 ? logResult.stdout.trim() : "(could not retrieve log)",
                "```",
                "",
                "## Diff summary",
                "```",
                diffResult.code === 0 ? diffResult.stdout.trim() : "(could not retrieve diff)",
                "```",
                "",
                "## Changes landed on main since branch point",
                "```",
                mainChangesResult.code === 0 ? mainChangesResult.stdout.trim() : "(none or could not retrieve)",
                "```",
                "",
                'Respond with JSON: { "approved": true } or { "approved": false, "reason": "..." }',
              ].join("\n");

              const result: any = await this.postRebaseReviewAgent!.generate({ prompt } as any);
              const output = typeof result?.output === "string" ? result.output : JSON.stringify(result?.output ?? "");

              // Try to parse structured output
              const jsonMatch = output.match(/\{[^}]*"approved"\s*:\s*(true|false)[^}]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.approved === false) {
                  return { approved: false as const, reason: parsed.reason ?? "Review agent rejected post-rebase state" };
                }
              } else if (/\brejected?\b|\bnot\s+approved?\b|\bfailed?\b/i.test(output) && !/\bapproved\b/i.test(output)) {
                return { approved: false as const, reason: `Review agent indicated rejection: ${truncate(output, 500)}` };
              }

              return { approved: true as const };
            } catch {
              // Default to approved on error — don't block the queue on agent failures
              return { approved: true as const };
            }
          }),
        );

        const reviewFailIdx = reviewResults.findIndex((r) => !r.approved);
        if (reviewFailIdx !== -1) {
          const failedEntry = window[reviewFailIdx]!;
          const failedReview = reviewResults[reviewFailIdx]!;
          if (reviewFailIdx > 0) {
            // Land entries before the failure
            await this.landPrefix(window.slice(0, reviewFailIdx));
          }
          for (const follower of window.slice(reviewFailIdx + 1)) {
            follower.invalidatedCount += 1;
          }
          await this.evictEntry(
            failedEntry,
            "review_failed",
            !failedReview.approved ? failedReview.reason : "Post-rebase review failed",
          );
          continue;
        }
      }

      const ciResults = await Promise.all(
        window.map((entry) =>
          this.ops.runCi(this.repoRoot, entry.ticket, this.postLandChecks),
        ),
      );
      const failIdx = ciResults.findIndex((res) => !res.passed);

      if (failIdx === -1) {
        await this.landPrefix(window);
        continue;
      }

      if (failIdx > 0) {
        await this.landPrefix(window.slice(0, failIdx));
      }

      const failed = window[failIdx]!;
      for (const follower of window.slice(failIdx + 1)) {
        follower.invalidatedCount += 1;
      }
      await this.evictEntry(failed, "ci_failed", ciResults[failIdx]!.details);
    }
  }

  private async landPrefix(entries: QueueEntry[]) {
    if (!entries.length) return;
    const tail = entries[entries.length - 1]!;
    const ff = await this.ops.fastForwardMain(this.repoRoot, tail.ticket.ticketId);
    if (!ff.ok) {
      for (const entry of entries) {
        await this.evictEntry(entry, "fast_forward_failed", ff.details);
      }
      return;
    }

    const push = await this.ops.pushMain(this.repoRoot);
    if (!push.ok) {
      for (const entry of entries) {
        await this.evictEntry(entry, "push_failed", push.details);
      }
      return;
    }

    for (const entry of entries) {
      const commit = await this.ops.readCommitId(
        this.repoRoot,
        bookmarkRev(entry.ticket.ticketId),
      );
      const retestNote =
        entry.invalidatedCount > 0
          ? ` Retested ${entry.invalidatedCount} time(s) after queue evictions.`
          : "";
      await this.ops.cleanupTicket(this.repoRoot, entry.ticket).catch(() => undefined);
      this.resolveEntry(entry, {
        merged: true,
        mergeCommit: commit,
        ciPassed: true,
        summary: `Landed ${entry.ticket.ticketId} via speculative merge queue.${retestNote}`,
        evicted: false,
        evictionReason: null,
        evictionDetails: null,
        attemptedLog: null,
        attemptedDiffSummary: null,
        landedOnMainSinceBranch: null,
      });
    }
  }

  private async evictEntry(entry: QueueEntry, reason: EvictReason, details: string) {
    const context = await this.ops.collectEvictionContext(
      this.repoRoot,
      entry.ticket.ticketId,
    );
    await this.ops.cleanupTicket(this.repoRoot, entry.ticket).catch(() => undefined);

    const retestNote =
      entry.invalidatedCount > 0
        ? ` This ticket had already been invalidated ${entry.invalidatedCount} time(s).`
        : "";

    this.resolveEntry(entry, {
      merged: false,
      mergeCommit: null,
      ciPassed: false,
      summary: `Evicted ${entry.ticket.ticketId} from merge queue (${reason}).${retestNote}`,
      evicted: true,
      evictionReason: reason,
      evictionDetails: truncate(details || "No additional details."),
      attemptedLog: context.attemptedLog,
      attemptedDiffSummary: context.attemptedDiffSummary,
      landedOnMainSinceBranch: context.landedOnMainSinceBranch,
    });
  }

  private resolveEntry(entry: QueueEntry, result: MergeQueueLandResult) {
    entry.status = "resolved";
    entry.readyForQueue = false;
    entry.result = result;
    const waiters = entry.waiters.splice(0);
    for (const waiter of waiters) waiter(result);
  }

  private notReadyResult(ticketId: string): MergeQueueLandResult {
    return {
      merged: false,
      mergeCommit: null,
      ciPassed: false,
      summary: `Ticket ${ticketId} is not ready for landing because report status is not complete.`,
      evicted: false,
      evictionReason: null,
      evictionDetails: null,
      attemptedLog: null,
      attemptedDiffSummary: null,
      landedOnMainSinceBranch: null,
    };
  }
}

const coordinatorRegistry = new Map<string, SpeculativeMergeQueueCoordinator>();

export async function runTicketThroughSpeculativeMergeQueue(
  request: MergeQueueRequest,
): Promise<MergeQueueLandResult> {
  const key = `${request.runId}::${request.queueId}`;
  let coordinator = coordinatorRegistry.get(key);
  if (!coordinator) {
    coordinator = new SpeculativeMergeQueueCoordinator(request.repoRoot);
    coordinatorRegistry.set(key, coordinator);
  }
  return await coordinator.enqueue(request);
}

export function resetSpeculativeMergeQueueRegistry() {
  coordinatorRegistry.clear();
}

function extractRequestFromPrompt(prompt: string): MergeQueueRequest {
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
      `Failed to parse merge queue request JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function buildSpeculativeMergeQueuePrompt(
  request: MergeQueueRequest,
): string {
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

export function createSpeculativeMergeQueueAgent(
  id = "super-ralph-speculative-merge-queue",
): AgentLike {
  return {
    id,
    async generate(args: any) {
      try {
        const request = extractRequestFromPrompt(String(args?.prompt ?? ""));
        const output = await runTicketThroughSpeculativeMergeQueue(request);
        return { output };
      } catch (err) {
        return {
          output: {
            merged: false,
            mergeCommit: null,
            ciPassed: false,
            summary: `Merge queue coordinator error: ${err instanceof Error ? err.message : String(err)}`,
            evicted: false,
            evictionReason: null,
            evictionDetails: null,
            attemptedLog: null,
            attemptedDiffSummary: null,
            landedOnMainSinceBranch: null,
          },
        };
      }
    },
  };
}