/**
 * Workflow runner — executes Smithers workflow
 *
 * Extracted from the bottom 400 lines of original cli/index.ts
 * Handles preload generation, bunfig, spawning smithers, reporting.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { banner, ok, err, warn, info, kv, summaryBox } from "../ui/cli-style";
import { CorralTimer } from "../timing";
import { renderWorkflowFile } from "./generator";
import { writeRunReport } from "../report/renderReport";
import { detectExactReply, normalizeReply } from "../exactReply";
import { resolveProxyConfig, proxyEnvOverrides } from "../nimProxy";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const GENERATED_PRELOAD_SOURCE = `import { mdxPlugin } from "smthrs/mdx-plugin";
mdxPlugin();

// Effect compat shims — see preload.ts for details
import { plugin } from "bun";
import { createRequire } from "node:module";

const UNSTABLE_PREFIX = "effect/unstable/";
const UNSTABLE_SHIMS = [
  "cluster", "cluster/Entity", "cluster/MessageStorage", "cluster/RunnerHealth",
  "cluster/Runners", "cluster/RunnerStorage", "cluster/Sharding", "cluster/ShardingConfig",
  "cluster/SingleRunner", "http/FetchHttpClient", "observability/Otlp",
  "process/ChildProcess", "process/ChildProcessSpawner", "reactivity/Reactivity",
  "rpc/Rpc", "rpc/RpcGroup", "sql/SqlClient", "sql/SqlError", "sql/Statement",
  "workflow", "workflow/Activity", "workflow/DurableDeferred", "workflow/Workflow", "workflow/WorkflowEngine",
];

function unstableResolvesNatively(): boolean {
  try {
    createRequire(import.meta.url).resolve(UNSTABLE_PREFIX + "workflow");
    return true;
  } catch { return false; }
}

if (!unstableResolvesNatively()) {
  plugin({
    name: "effect-unstable-compat",
    setup(build) {
      for (const rest of UNSTABLE_SHIMS) {
        build.module(UNSTABLE_PREFIX + rest, async () => {
          const mod = await import("effect/" + rest);
          return { loader: "object", exports: { ...mod } };
        });
      }
    },
  });
}
`;

export type RunWorkflowOpts = {
  repoRoot: string;
  promptText: string;
  promptSourcePath: string | null;
  runId: string;
  maxConcurrency: number;
  maxIterations: number;
  skipQuestions: boolean;
  headless: boolean;
};

export async function runWorkflow(opts: RunWorkflowOpts): Promise<void> {
  const {
    repoRoot,
    promptText,
    promptSourcePath,
    runId,
    maxConcurrency,
    maxIterations,
    skipQuestions,
    headless,
  } = opts;

  const timer = new CorralTimer(runId);
  const superRalphSourceRoot = resolve(__dirname, "..", "..");
  const superRalphPreload = join(superRalphSourceRoot, "preload.ts");
  const workflowPath = join(
    superRalphSourceRoot,
    "src",
    "components",
    "SuperRalph.tsx",
  ); // Actually smithers workflow file is different
  // For now, use the conventional smithers workflow path resolution
  const smithersDirCandidates = [
    join(superRalphSourceRoot, "node_modules", "smthrs"),
    join(superRalphSourceRoot, "node_modules", "smthrs"),
  ];

  let smithersPackageRoot: string | null = null;
  let smithersCliPath: string | null = null;
  let smithersSubcommand = "up"; // 2026-10-18: smthrs 0.35.0 uses up, not run

  // 2026-10-18: restored src/bin/smithers.js candidate (regression of
  // be6748c; original fix 0917990). smthrs@0.35.0 ships its CLI at
  // src/bin/smithers.js (its declared bin entry) with no dist/ at all.
  const smithersCliRelCandidates = ["dist/cli.js", "cli.js", "src/bin/smithers.js"];
  for (const dir of smithersDirCandidates) {
    const found = smithersCliRelCandidates
      .map((rel) => join(dir, rel))
      .find((abs) => existsSync(abs));
    if (found) {
      smithersPackageRoot = dir;
      smithersCliPath = found;
      break;
    }
  }

  if (!smithersPackageRoot || !smithersCliPath) {
    throw new Error(
      `smithers package not found. Looked in ${smithersDirCandidates.join(", ")}. Run bun install.`,
    );
  }

  // Prepare preload and bunfig in a temp work dir or repo root
  const workDir = join(repoRoot, ".corral");
  await mkdir(workDir, { recursive: true });
  await mkdir(join(repoRoot, ".smithers"), { recursive: true }); // 2026-10-18: smithers needs this for workflow.db

  const preloadPath = join(workDir, "preload.ts");
  const bunfigPath = join(workDir, "bunfig.toml");
  const useSharedPreload = existsSync(superRalphPreload);

  if (!useSharedPreload) {
    await writeFile(preloadPath, GENERATED_PRELOAD_SOURCE, "utf8");
  }
  await writeFile(bunfigPath, `preload = ["./preload.ts"]\n`, "utf8");

  const detectedAgents = { claude: true, codex: false, gh: true };

  if (!headless) {
    console.log(`🚀 Estate Corral — Multi-Agent Ticket Orchestration`);
    console.log(`📁 Repo: ${repoRoot}`);
    console.log(`📝 Prompt: ${promptSourcePath || "inline"}`);
    console.log(`💾 Database: ${join(repoRoot, ".smithers", "db.sqlite")}`);
    console.log(`🆔 Run ID: ${runId}`);
    kv([
      [
        "agents",
        `claude=${detectedAgents.claude} codex=${detectedAgents.codex} gh=${detectedAgents.gh}`,
      ],
      ["concurrency", String(maxConcurrency)],
      ["max iterations", String(maxIterations)],
    ]);
    console.log("");
  }

  info("Starting workflow execution...");

  // Resolve actual smithers workflow file — for this refactor we delegate to original behavior
  // The original cli generated workflow files dynamically; here we assume SuperRalph.tsx is the entry
  // but smithers needs a workflow file. We'll look for .corral/workflow.tsx or fallback to src/components/SuperRalph
  let effectiveWorkflowPath = join(workDir, "workflow.tsx");
  if (!existsSync(effectiveWorkflowPath)) {
    // 2026-10-18: generate the real workflow via generator.ts. The old
    // inline placeholder exported a raw component, which smthrs 0.35.0
    // rejects (RUN_FAILED: must be created with smithers(...)).
    const runningFromSourceWf = existsSync(join(superRalphSourceRoot, "node_modules"));
    const wfContent = renderWorkflowFile({
      promptText,
      promptSpecPath: promptSourcePath,
      repoRoot,
      dbPath: join(repoRoot, ".smithers", "workflow.db"),
      packageScripts: {},
      detectedAgents: { claude: detectedAgents.claude, codex: detectedAgents.codex },
      // 2026-10-19 (osprey): focuses: [] keeps the generated
      // workflow's SuperRalph spread total on the first render.
      fallbackConfig: { maxConcurrency, maxIterations, focuses: [] },
      clarificationSession: null,
      maxIterations,
      superRalphSourceRoot,
      runningFromSource: runningFromSourceWf,
    });
    await writeFile(effectiveWorkflowPath, wfContent, "utf8");
  }

  let execCwd: string;
  const runningFromSource = existsSync(
    join(superRalphSourceRoot, "node_modules"),
  );
  execCwd = runningFromSource ? superRalphSourceRoot : repoRoot;

  const effectivePreload = useSharedPreload ? superRalphPreload : preloadPath;

  const args = [
    "-r",
    effectivePreload,
    smithersCliPath,
    smithersSubcommand,
    effectiveWorkflowPath,
    "--root",
    repoRoot,
    "--run-id",
    runId,
    "--max-concurrency",
    String(maxConcurrency),
  ];

  const env: Record<string, string | undefined> = {
    ...process.env,
    USE_CLI_AGENTS: "1",
    SMITHERS_DEBUG: "1",
    NODE_ENV: "production",
  };
  delete (env as any).CLAUDECODE;

// Route every spawned agent (claude/codex/smithers) through the hodos
  // router: smithers' ClaudeCodeAgent blanked ANTHROPIC_API_KEY on spawn, and
  // without re-injecting the router env the `claude` shim fell back to real
  // Anthropic with no key -> aborted runs. Absorb the no-key case so an
  // unconfigured host still writes a workflow and fails loudly at the first
  // agent call instead of in the runner.
  try {
    const proxy = resolveProxyConfig();
    Object.assign(env, proxyEnvOverrides(proxy));
  } catch {
    // no key configured — leave env as-is; agent spawn will report the gap
  }

  const proc = Bun.spawn(["bun", "--no-install", ...args], {
    cwd: execCwd,
    env: env as any,
    stdout: headless ? "ignore" : "inherit",
    stderr: "inherit",
    stdin: headless ? "ignore" : "inherit",
  });

  const exitCode = await timer.measure("workflow-execute", () => proc.exited);
  const timingSummary = timer.summary();

  if (exitCode === 0) {
    const reportPath = await writeReportQuietly(runId, repoRoot, promptText);
    if (!headless) {
      console.log("");
      summaryBox(
        "Run completed",
        [
          ["run id", runId],
          ["report", reportPath ?? "(report unavailable)"],
        ],
        "success",
      );
      console.log("");
    } else if (reportPath) {
      console.error(`report: ${reportPath}`);
    }
    await printFinalReply(
      join(repoRoot, ".smithers", "db.sqlite"),
      runId,
      headless,
      promptText,
    );
  } else {
    err(`Workflow exited with code ${exitCode}`);
    console.error(timingSummary);
    process.exit(exitCode);
  }
}

async function writeReportQuietly(
  runId: string,
  repoRoot: string,
  promptText: string,
): Promise<string | null> {
  try {
    return await writeRunReport({ runId, root: repoRoot, prompt: promptText });
  } catch {
    return null;
  }
}

async function printFinalReply(
  dbPath: string,
  runId: string,
  headless: boolean,
  promptText: string,
) {
  try {
    const { Database } = await import("bun:sqlite");
    const db = new Database(dbPath, { readonly: true });
    let row: any = null;
    try {
      row = db
        .query(
          `SELECT reply FROM final_report WHERE run_id = ? ORDER BY iteration DESC LIMIT 1`,
        )
        .get(runId) as any;
    } catch {
      // table absent
    }
    db.close();
    if (row?.reply) {
      let reply = normalizeReply(String(row.reply));
      const expected = detectExactReply(promptText);
      if (expected !== null) {
        if (reply !== String(row.reply)) {
          try {
            const dbw = new Database(dbPath);
            dbw
              .query(`UPDATE final_report SET reply = ? WHERE run_id = ?`)
              .run(reply, runId);
            dbw.close();
          } catch {}
        }
        if (reply !== expected) {
          console.error(
            `\n❌ Exact-reply mismatch: expected ${expected.length} bytes ${JSON.stringify(expected)}, got ${reply.length} bytes ${JSON.stringify(reply)}.\n`,
          );
          process.exit(1);
        }
      }
      if (headless) {
        process.stdout.write(reply);
      } else {
        console.log(String(row.reply));
      }
    } else if (headless) {
      console.error("(final report unavailable)");
      process.exit(1);
    } else {
      console.log("(final report unavailable)");
    }
  } catch (e: any) {
    if (headless) {
      console.error(`(could not read final report: ${e?.message ?? e})`);
      process.exit(1);
    }
    console.log(`(could not read final report: ${e?.message ?? e})`);
  }
}
