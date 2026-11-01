/**
 * Merge Queue Types — extracted from 851-line coordinator.ts
 */

export type MergeQueueOrderingStrategy =
  | "report-complete-fifo"
  | "priority"
  | "ticket-order";

export type MergeQueueTicket = {
  ticketId: string;
  ticketTitle: string;
  ticketCategory: string;
  priority: "critical" | "high" | "medium" | "low";
  reportIteration: number;
  worktreePath: string;
};

export type MergeQueueLandResult = {
  merged: boolean;
  mergeCommit: string | null;
  ciPassed: boolean;
  summary: string;
  evicted: boolean;
  evictionReason: string | null;
  evictionDetails: string | null;
  attemptedLog: string | null;
  attemptedDiffSummary: string | null;
  landedOnMainSinceBranch: string | null;
};

export type QueueEntry = {
  ticket: MergeQueueTicket;
  status: "pending" | "resolved";
  readyForQueue: boolean;
  enqueueSeq: number;
  snapshotIndex: number;
  invalidatedCount: number;
  result?: MergeQueueLandResult;
  waiters: Array<(result: MergeQueueLandResult) => void>;
};

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type OperationResult = {
  ok: boolean;
  details: string;
};

export type CiRunResult = {
  passed: boolean;
  details: string;
};

export type EvictionContext = {
  attemptedLog: string | null;
  attemptedDiffSummary: string | null;
  landedOnMainSinceBranch: string | null;
};

export type MergeQueueOps = {
  fetchMain: (repoRoot: string) => Promise<OperationResult>;
  rebase: (
    repoRoot: string,
    ticketId: string,
    destinationRev: string,
  ) => Promise<OperationResult>;
  runCi: (
    repoRoot: string,
    ticket: MergeQueueTicket,
    commands: string[],
  ) => Promise<CiRunResult>;
  fastForwardMain: (repoRoot: string, ticketId: string) => Promise<OperationResult>;
  pushMain: (repoRoot: string) => Promise<OperationResult>;
  readCommitId: (repoRoot: string, revset: string) => Promise<string | null>;
  collectEvictionContext: (
    repoRoot: string,
    ticketId: string,
  ) => Promise<EvictionContext>;
  cleanupTicket: (repoRoot: string, ticket: MergeQueueTicket) => Promise<void>;
};

export type MergeQueueRequest = {
  runId: string;
  queueId: string;
  repoRoot: string;
  postLandChecks: string[];
  orderingStrategy: MergeQueueOrderingStrategy;
  maxSpeculativeDepth: number;
  ticket: MergeQueueTicket;
  queueSnapshot: MergeQueueTicket[];
  readyForQueue: boolean;
  postRebaseReviewAgent?: any;
};

export type EvictReason = "rebase-conflict" | "ci-failure" | "evicted-by-predecessor";
