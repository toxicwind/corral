/**
 * Workspace provisioning for Corral
 * 
 * Original had everything in one 85-line function with nested callbacks.
 * This version separates concerns and removes hardcoded paths.
 */

import { execSync, type ExecSyncOptions } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
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
export async function ensureWorkspace(
  requestedCwd: string,
  promptSourcePath: string | null
): Promise<string> {
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
