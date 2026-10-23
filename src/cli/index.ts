#!/usr/bin/env bun
/**
 * Corral CLI — Clean entry point
 * 
 * Original was 1189 lines doing everything. Now thin wrapper that delegates
 * to focused modules: env.ts, workspace.ts, args.ts, runner.ts
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, printHelp, getFlagString, hasFlag } from "./args";
import { dumpCheckEnv, loadSecrets, parseFinite } from "./env";
import { ensureWorkspace, resolveWorkspaceRoot } from "./workspace";

import { getClarificationQuestions } from "./clarifications";
import { banner, ok, err, kv, summaryBox } from "../ui/cli-style";
import { writeRunReport } from "../report/renderReport";
import { CorralTimer } from "../timing";
import { detectExactReply, normalizeReply } from "../exactReply";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

async function main() {
  loadSecrets();

  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);

  if (hasFlag(parsed.flags, "help") || (parsed.positional.length === 0 && Object.keys(parsed.flags).length === 0)) {
    printHelp();
    return;
  }

  if (hasFlag(parsed.flags, "check-env")) {
    dumpCheckEnv();
    return;
  }

  // Delend subcommands: `corral delend <subcommand> [args...]`
  // Every agentic delend-* primitive is a first-class @delendai/* plugin
  // (see ranch/barn/corral/delendai/plugins/*); `corral delend` is the unified CLI
  // dispatcher. init/guard/checkpoint/land come from ./delend (guardian +
  // merge queue integration); quick|dirty|stash|race|experimental|iterate|
  // oracle|model-race|audit|route|gh|branch-audit|rig come from the plugins.
  if (parsed.positional[0] === "delend") {
    const subarg = parsed.subcommand ?? parsed.positional[1];
    const restArgs = parsed.subargs.length ? parsed.subargs : parsed.positional.slice(2);

    const D = await import("../delendai");
    switch (subarg) {
      case "init":
      case "guard":
      case "checkpoint":
      case "land": {
        const { cmdInit, cmdGuard, cmdCheckpoint, cmdLand } = await import("./delend");
        switch (subarg) {
          case "init":
            await cmdInit(requestedCwd);
            return;
          case "guard": {
            const guardFile = restArgs[0] ?? join(requestedCwd, "delendai", "proposals.json");
            if (!existsSync(guardFile)) {
              console.error(`No proposals file at ${guardFile}`);
              process.exit(1);
            }
            const raw = await Bun.file(guardFile).text();
            const proposals = JSON.parse(raw);
            cmdGuard(proposals);
            return;
          }
          case "checkpoint": {
            const { selectAllTickets } = await import("../selectors");
            const { Database } = await import("bun:sqlite");
            const dbPath = join(requestedCwd, ".smithers", "workflow.db");
            const db = new Database(dbPath, { readonly: true });
            const tickets = db.query("SELECT * FROM tickets ORDER BY priority DESC, created_at ASC").all();
            cmdCheckpoint(tickets);
            db.close();
            return;
          }
          case "land": {
            const maxDepth = parseInt(getFlagString(parsed.flags, "max-speculative-depth") ?? "3", 10);
            console.log("DelendAI Land — merge queue ready");
            console.log(`  Max speculative depth: ${maxDepth}`);
            console.log("  Invoke the AgenticMergeQueue component to execute.");
            return;
          }
        }
        return;
      }
      // Agentic primitives — unified `delend` dispatcher
      case "quick": {
        const rc = await D.workRefs.quickMain(restArgs);
        process.exit(rc);
        return;
      }
      case "dirty": {
        process.exit(D.workRefs.workingDirtyMain(restArgs));
        return;
      }
      case "stash": {
        process.exit(D.workRefs.stashOptimizeMain(restArgs));
        return;
      }
      case "race": {
        process.exit(await D.codeRace.main(restArgs));
        return;
      }
      case "experimental": {
        process.exit(D.experimental.main(restArgs));
        return;
      }
      case "iterate": {
        process.exit(D.iterate.main(restArgs));
        return;
      }
      case "oracle": {
        process.exit(D.oracleMarket.main(restArgs));
        return;
      }
      case "model-race": {
        process.exit(D.modelRace.main(restArgs));
        return;
      }
      case "audit": {
        process.exit(D.forgeAudit.main(restArgs));
        return;
      }
      case "route": {
        process.exit(D.intentRouter.main(restArgs));
        return;
      }
      case "gh": {
        process.exit(D.globalGh.main(restArgs));
        return;
      }
      case "branch-audit": {
        process.exit(D.globalGh.branchAuditMain(restArgs));
        return;
      }
      case "rig": {
        process.exit(D.rigC2.main(restArgs));
        return;
      }
      default:
        console.error(`Unknown delend subcommand: ${subarg}`);
        console.log(
          "Available: init | guard | checkpoint | land | quick | dirty | stash | race | experimental | iterate | oracle | model-race | audit | route | gh | branch-audit | rig",
        );
        process.exit(1);
    }
  }

  const explicitCwd = getFlagString(parsed.flags, "cwd");
  const requestedCwd = explicitCwd
    ? resolve(explicitCwd)
    : resolveWorkspaceRoot(process.cwd());

  const promptArg = parsed.positional[0];
  if (!promptArg) {
    err("No prompt provided");
    printHelp();
    process.exit(1);
  }

  // Resolve prompt file vs inline text
  let promptText: string;
  let promptSourcePath: string | null = null;

  if (existsSync(promptArg) && !promptArg.startsWith("http")) {
    const { readFile } = await import("node:fs/promises");
    promptText = await readFile(promptArg, "utf8");
    promptSourcePath = resolve(promptArg);
  } else {
    promptText = promptArg;
  }

  // Ensure workspace (jj colocated)
  const repoRoot = await ensureWorkspace(requestedCwd, promptSourcePath);

  const runId = getFlagString(parsed.flags, "run-id") ?? `corral-${Date.now()}`;
  const maxConcurrency = parseFinite(getFlagString(parsed.flags, "max-concurrency"), 8);
  const maxIterations = parseFinite(getFlagString(parsed.flags, "max-iterations"), 25);
  const headless = false; // Could be flag later

  // Handle report regeneration
  if (hasFlag(parsed.flags, "report")) {
    const { writeRunReport } = await import("../report/renderReport");
    const reportPath = await writeRunReport({ runId, root: repoRoot, prompt: promptText });
    console.log(reportPath);
    return;
  }

  if (hasFlag(parsed.flags, "dry-run")) {
    const { renderWorkflowFile } = await import("./generator");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const superRalphDir = join(repoRoot, ".super-ralph", "generated");
    const corralDir = join(repoRoot, ".corral", "generated");
    await mkdir(superRalphDir, { recursive: true });
    await mkdir(corralDir, { recursive: true });

    const source = renderWorkflowFile({
      promptText,
      promptSpecPath: promptSourcePath,
      repoRoot,
      dbPath: join(repoRoot, ".smithers", "workflow.db"),
      packageScripts: {},
      detectedAgents: { claude: true, codex: true },
      // 2026-10-19 (osprey): focuses: [] keeps the generated
      // workflow's SuperRalph spread total on the first render.
      fallbackConfig: { maxConcurrency, maxIterations, focuses: [] },
      maxIterations,
      superRalphSourceRoot: resolve(__dirname, "..", ".."),
      runningFromSource: true,
    });

    await writeFile(join(superRalphDir, "workflow.tsx"), source, "utf8");
    await writeFile(join(corralDir, "workflow.tsx"), source, "utf8");

    console.log(`Dry run complete. Workflow generated at ${join(superRalphDir, "workflow.tsx")}`);
    return;
  }
  // --- Smithers workflow execution ---
  // This part preserves original logic but delegates to runner module
  const { runWorkflow } = await import("./runner");
  await runWorkflow({
    repoRoot,
    promptText,
    promptSourcePath,
    runId,
    maxConcurrency,
    maxIterations,
    skipQuestions: hasFlag(parsed.flags, "skip-questions"),
    headless,
  });
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
