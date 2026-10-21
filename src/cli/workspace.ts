/**
 * Workspace provisioning for Corral
 * 
 * Original had everything in one 85-line function with nested callbacks.
 * This version separates concerns and removes hardcoded paths.
 */

import { execSync, type ExecSyncOptions } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

function hasCommand(cmd: string): boolean {
  try {
    execSync(`${cmd} --version`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function initColocated(dir: string): void {
  try {
    execSync("jj git init --colocate", { cwd: dir, stdio: "pipe" } as ExecSyncOptions);
  } catch (e: any) {
    throw new Error(`jj git init --colocate failed in ${dir}: ${e?.message ?? e}`);
  }
}

/**
 * Directories where in-place `jj git init` must never run — an isolated
 * workspace is provisioned instead. Turning $HOME (or /) into a repo is
 * never what a task launch wants.
 */
function isProtectedCwd(dir: string): boolean {
  const normalized = resolve(dir);
  return normalized === "/" || (homedir() !== "" && normalized === homedir());
}

function seedInitialCommit(workspace: string): void {
  try {
    writeFileSync(join(workspace, ".corral-workspace"), "corral isolated workspace\n");
    execSync("jj commit -m 'corral: initial workspace commit'", {
      cwd: workspace,
      stdio: "pipe",
    } as ExecSyncOptions);
    execSync("jj bookmark create main -r @-", {
      cwd: workspace,
      stdio: "pipe",
    } as ExecSyncOptions);
  } catch (e: any) {
    console.error(
      `corral: warning: failed to seed initial commit in ${workspace}: ${e?.message ?? e}`
    );
  }
}

/**
 * Ensure we're in a colocated jj+git repo, or provision an isolated workspace.
 * 
 * Smithers engine uses `git worktree add` against this repo trying main/origin/main/HEAD.
 * A fresh `jj git init --colocate` has no commits and no refs, which fails at discover
 * step with WORKTREE_CREATE_FAILED — so we seed an initial commit + main bookmark.
 */

/**
 * Orphaned smithers worktree sweep (2026-10-19, scout T1).
 * Smithers <Worktree> adopts deterministic /tmp/workflow-wt-<ticket-id> dirs.
 * When the parent run dir is cleaned first, the worktree's .git file points
 * at a gitdir that no longer exists and every later run reusing that ticket
 * id fails permanently (oracle research-1792445323109, both lanes). A
 * worktree whose gitdir target is gone is orphaned by definition; remove
 * only those, and only when untouched for >120s (creation-race guard).
 */
function sweepOrphanedWorkflowWorktrees(): void {
  let names: string[] = [];
  try {
    names = readdirSync("/tmp").filter((n) => n.startsWith("workflow-wt-"));
  } catch {
    return;
  }
  let removed = 0;
  for (const name of names) {
    const dir = join("/tmp", name);
    try {
      const gitPath = join(dir, ".git");
      if (!statSync(gitPath).isFile()) continue;
      const first = readFileSync(gitPath, "utf8").split("\n")[0] ?? "";
      if (!first.startsWith("gitdir: ")) continue;
      const target = first.slice("gitdir: ".length).trim();
      if (existsSync(target)) continue;
      if (Date.now() - statSync(dir).mtimeMs < 120_000) continue;
      rmSync(dir, { recursive: true, force: true });
      removed++;
    } catch {
      continue;
    }
  }
  if (removed > 0) {
    console.error(`corral: swept ${removed} orphaned workflow worktree(s) from /tmp.`);
  }
}
export async function ensureWorkspace(
  requestedCwd: string,
  promptSourcePath: string | null
): Promise<string> {
  sweepOrphanedWorkflowWorktrees();
  if (!hasCommand("jj")) {
    throw new Error("jj binary not found — install https://github.com/martinvonz/jj");
  }

  const hasJj = existsSync(join(requestedCwd, ".jj"));
  const hasGit = existsSync(join(requestedCwd, ".git"));

  if (hasJj && hasGit) return requestedCwd;

  if (hasGit && !hasJj) {
    // Adopt existing git repo non-destructively
    initColocated(requestedCwd);
    console.error(`corral: adopted ${requestedCwd} as a colocated jj repo (jj git init --colocate).`);
    return requestedCwd;
  }

  // 2026-10-18 (cwd launch): when launched with a task cwd that is a plain
  // directory (not a protected location), initialize the colocated jj repo
  // IN PLACE instead of abandoning the launch cwd for an isolated workspace
  // elsewhere. The bidder launches corral with the task workdir as cwd and
  // expects the agent to work there.
  if (!isProtectedCwd(requestedCwd)) {
    initColocated(requestedCwd);
    seedInitialCommit(requestedCwd);
    console.error(`corral: initialized ${requestedCwd} as a colocated jj repo in place (jj git init --colocate).`);
    return requestedCwd;
  }

  // Provision isolated workspace under ~/.corral/runs instead of turning $HOME into repo
  const base = promptSourcePath
    ? basename(promptSourcePath).replace(/\.[^.]+$/, "")
    : "prompt";
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "run";
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").slice(0, 15);
  const uniq = randomUUID().slice(0, 8);
  const workspace = join(homedir() || "/tmp", ".corral", "runs", `${stamp}-${slug}-${uniq}`);

  mkdirSync(workspace, { recursive: true });
  initColocated(workspace);
  seedInitialCommit(workspace);

  console.error(
    `corral: ${requestedCwd} is not a colocated jj repo — provisioned isolated workspace ${workspace}`
  );
  return workspace;
}

// Back-compat alias for previous hard-error gate (now auto-provisions)
export async function ensureJjAvailable(cwd: string = process.cwd()): Promise<void> {
  await ensureWorkspace(cwd, null);
}
