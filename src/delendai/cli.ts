/**
 * delendai/cli — the one, shared bun library for driving the Dubriendo/DelendAI
 * `delendai` binary. Every delend-* helper and Corral tool must route through
 * here so proposal/slice/agent/topic derivation and the work-ref naming never
 * diverge (they were one-off-duplicated across helpers before this existed).
 *
 * Binary: `delendai` on $PATH (corral's DelendAI shared-checkout-merge implant).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface CheckpointOptions {
  proposal?: string;
  slice?: string;
  kind?: string; // implement | fix | ...
  topic?: string;
  message: string;
  agent?: string;
  paths: string[];
  generation?: number;
  workspace?: string;
}

export interface WorkStatus {
  profile?: string;
  integration?: string;
  dirty: number;
  undurable: string[];
  workRefTemplate?: string;
  publishedAhead?: string[];
  [k: string]: unknown;
}

const DELENDAI = "delendai";

/** Run a process and return {status, stdout, stderr}. */
export function run(cmd: string, args: string[], cwd: string = process.cwd()): ExecResult {
  const p = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return { status: p.status ?? 1, stdout: (p.stdout || "").trim(), stderr: (p.stderr || "").trim() };
}

/** Discover the nearest git repo root (accepted workspace or cwd upward). */
export function findRepoRoot(start: string = process.cwd()): string {
  let cur = resolve(start);
  const home = homedir();
  while (cur !== "/" && cur !== home) {
    if (existsSync(join(cur, ".git"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return resolve(start);
}

/** Collapse a name to delendai's ${proposal|slice|topic} safe grammar. */
export function cleanId(s: string, fallback = "core"): string {
  const out = s.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  return out || fallback;
}

/** The invariant work-ref name for the given identity. */
export function workRef(agent: string, kind: string, proposal: string, slice: string, generation: number, topic: string): string {
  return `heads/wip/${cleanId(agent, "toxic")}/${cleanId(kind, "implement")}/${cleanId(proposal)}-${cleanId(slice)}-g${generation}/${cleanId(topic, "work")}`;
}

/** Default identity, mirroring delend-quick. */
export function identity(repoRoot: string): { agent: string; proposal: string; slice: string; topic: string } {
  return {
    agent: process.env.DELENDAI_AGENT_ID || "toxic",
    proposal: cleanId(resolve(repoRoot).split("/").pop() || "project"),
    slice: "core",
    topic: "work",
  };
}

/** Undurable (not-yet-work-referenced) paths from `delendai work status --json`. Workspace-aware. */
export function undurablePaths(workspace?: string): string[] {
  const repo = workspace || findRepoRoot(process.cwd());
  const st = run(DELENDAI, ["work", "status", "--json", `--workspace=${repo}`], repo);
  try {
    const d = JSON.parse(st.stdout) as WorkStatus;
    return Array.isArray(d.undurable) ? d.undurable : [];
  } catch {
    return [];
  }
}

/**
 * Checkpoint a set of paths into a durable work-ref via the real delendai binary.
 * Never blind-sweeps a shared tree: callers must pass `paths` (or rely on
 * `pathsFromUndurable=true` to checkpoint exactly delendai's reported set).
 */
export function checkpoint(opts: CheckpointOptions): ExecResult & { ref?: string } {
  const repo = opts.workspace || findRepoRoot(process.cwd());
  const id = identity(repo);
  const args = [
    "work", "checkpoint",
    `--workspace=${repo}`,
    `--agent=${opts.agent ?? id.agent}`,
    `--proposal=${opts.proposal ?? id.proposal}`,
    `--slice=${opts.slice ?? id.slice}`,
    `--kind=${opts.kind ?? "implement"}`,
    `--topic=${opts.topic ?? id.topic}`,
    `--message=${opts.message}`,
  ];
  if (opts.generation != null) args.push(`--generation=${opts.generation}`);
  if (opts.paths.length) args.push(`--paths=${opts.paths.slice(0, 1500).join(",")}`);
  const res = run(DELENDAI, args, repo);
  let ref: string | undefined;
  try {
    const parsed = JSON.parse(res.stdout) as { ref?: string; status?: string };
    ref = parsed.ref;
  } catch {
    /* stdout may be non-JSON; ref stays undefined */
  }
  return { ...res, ref };
}

/** Print human status from the real binary. */
export function statusText(workspace?: string): string {
  const repo = workspace || findRepoRoot(process.cwd());
  return run(DELENDAI, ["work", "status", `--workspace=${repo}`], repo).stdout;
}

/** Run `delendai work <sub>` with a workspace and return the raw result. */
export function work(sub: "doctor" | "publish" | "retire" | "swarm", args: string[] = [], workspace?: string): ExecResult {
  const repo = workspace || findRepoRoot(process.cwd());
  return run(DELENDAI, ["work", sub, `--workspace=${repo}`, ...args], repo);
}