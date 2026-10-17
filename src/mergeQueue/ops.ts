/**
 * Merge Queue Ops — jj/git and shell operations
 * Extracted from coordinator.ts for testability
 */

import { workspaceAdd, runJj } from "smthrs";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CommandResult,
  OperationResult,
  CiRunResult,
  EvictionContext,
  MergeQueueTicket,
  MergeQueueOps,
} from "./types";

function truncate(text: string, maxChars = 12000): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

function stringifyFailure(prefix: string, code: number, stderr: string): string {
  const detail = stderr.trim();
  if (detail) return `${prefix}: ${detail}`;
  return `${prefix}: exit ${code}`;
}

async function runJjCommand(repoRoot: string, args: string[]): Promise<CommandResult> {
  const res: any = await (runJj as any)(args, { cwd: repoRoot });
  return { code: res?.code ?? 0, stdout: res?.stdout ?? "", stderr: res?.stderr ?? "" };
}

function normalizeOpResult(prefix: string, res: CommandResult): OperationResult {
  if (res.code === 0) {
    return { ok: true, details: res.stdout.trim() };
  }
  return {
    ok: false,
    details: stringifyFailure(prefix, res.code, res.stderr),
  };
}

async function runShellCommand(command: string, cwd: string): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    }) as ChildProcess;
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      resolve({ code: 127, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function bookmarkRev(ticketId: string): string {
  return `bookmark("ticket/${ticketId}")`;
}

async function runCiInSpeculativeWorkspace(
  repoRoot: string,
  ticket: MergeQueueTicket,
  commands: string[]
): Promise<CiRunResult> {
  if (!commands.length) {
    return { passed: true, details: "No post-land checks configured." };
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "super-ralph-mq-"));
  const workspacePath = join(tempRoot, "workspace");
  const suffix = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const workspaceName = `srq-${ticket.ticketId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${suffix}`.slice(0, 96);
  const commandLogs: string[] = [];

  try {
    const added: any = await (workspaceAdd as any)(workspaceName, workspacePath, {
      cwd: repoRoot,
      atRev: bookmarkRev(ticket.ticketId),
    });
    if (!added.success) {
      return {
        passed: false,
        details: `Failed to create speculative workspace for ${ticket.ticketId}: ${added.error ?? "unknown error"}`,
      };
    }

    for (const command of commands) {
      const res = await runShellCommand(command, workspacePath);
      const output = [`$ ${command}`, res.stdout.trim(), res.stderr.trim()]
        .filter(Boolean)
        .join("\n");
      commandLogs.push(output);
      if (res.code !== 0) {
        return {
          passed: false,
          details: commandLogs.join("\n\n"),
        };
      }
    }

    return { passed: true, details: commandLogs.join("\n\n") };
  } finally {
    // Cleanup via jj workspace forget
    try {
      await runJjCommand(repoRoot, ["workspace", "forget", workspaceName]);
    } catch {
      // ignore
    }
  }
}

export function createDefaultOps(): MergeQueueOps {
  return {
    async fetchMain(repoRoot: string): Promise<OperationResult> {
      const res = await runJjCommand(repoRoot, ["git", "fetch"]);
      return normalizeOpResult("git fetch failed", res);
    },

    async rebase(repoRoot: string, ticketId: string, destinationRev: string): Promise<OperationResult> {
      const res = await runJjCommand(repoRoot, [
        "rebase",
        "-s",
        bookmarkRev(ticketId),
        "-d",
        destinationRev,
      ]);
      return normalizeOpResult(`rebase ${ticketId} onto ${destinationRev} failed`, res);
    },

    async runCi(repoRoot: string, ticket: MergeQueueTicket, commands: string[]): Promise<CiRunResult> {
      return runCiInSpeculativeWorkspace(repoRoot, ticket, commands);
    },

    async fastForwardMain(repoRoot: string, ticketId: string): Promise<OperationResult> {
      const res = await runJjCommand(repoRoot, [
        "bookmark",
        "set",
        "main",
        "-r",
        bookmarkRev(ticketId),
      ]);
      return normalizeOpResult(`fast-forward main to ${ticketId} failed`, res);
    },

    async pushMain(repoRoot: string): Promise<OperationResult> {
      const res = await runJjCommand(repoRoot, ["git", "push", "--bookmark", "main"]);
      return normalizeOpResult("git push main failed", res);
    },

    async readCommitId(repoRoot: string, revset: string): Promise<string | null> {
      try {
        const res = await runJjCommand(repoRoot, ["log", "-r", revset, "--no-graph", "-T", "commit_id"]);
        const id = res.stdout.trim();
        return id || null;
      } catch {
        return null;
      }
    },

    async collectEvictionContext(repoRoot: string, ticketId: string): Promise<EvictionContext> {
      return {
        attemptedLog: null,
        attemptedDiffSummary: null,
        landedOnMainSinceBranch: null,
      };
    },

    async cleanupTicket(repoRoot: string, ticket: MergeQueueTicket): Promise<void> {
      // No-op for now, bookmark cleanup handled elsewhere
    },
  };
}
