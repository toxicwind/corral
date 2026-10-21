/**
 * CLI Argument parsing — extracted from 1189-line index.ts
 */

import { banner, kv } from "../ui/cli-style";

export type ParsedArgs = {
  positional: string[];
  flags: Record<string, string | boolean>;
  subcommand: string;
  subargs: string[];
};

const BOOLEAN_FLAGS = new Set([
  "help",
  "dry-run",
  "skip-questions",
  "check-env",
  "report",
]);

export function printHelp(): void {
  banner("Multi-Agent Engineering & Ticket Orchestration");
  console.log("Usage:");
  console.log('  corral "prompt text"');
  console.log("  corral ./specs/feature.md --max-concurrency 8");
  console.log("");
  console.log("Options:");
  kv([
    ["--cwd <path>", "Repo root (default: current directory)"],
    ["--max-concurrency <n>", "Workflow max concurrency override"],
    ["--max-iterations <n>", "Ralph loop iteration ceiling (default: 25)"],
    ["--run-id <id>", "Explicit Smithers run id"],
    ["--dry-run", "Generate workflow files but do not execute"],
    ["--skip-questions", "Skip the clarifying questions phase"],
    ["--report --run-id <id>", "Regenerate the HTML run report, print its path, exit"],
    ["--help", "Show this help"],
  ]);
  console.log("\nSubcommands:");
  kv([
    ["delend init", "Initialize DelendAI config in the repo"],
    ["delend guard", "Validate pending proposals against guardian rules"],
    ["delend checkpoint", "Checkpoint work to the merge queue (shared-checkout-merge)"],
    ["delend land", "Run the AgenticMergeQueue to land resolved tickets"],
  ]);
  console.log("\nExamples:");
  console.log('  corral "Build a React todo app"');
  console.log('  corral ./specs/feature.md --max-concurrency 8');
  console.log('  corral "Add authentication" --skip-questions');
  console.log('  corral delend land --max-speculative-depth 3');
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let subcommand = "";
  let subargs: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    // Detect subcommand boundary: positional "delend" followed by another positional
    if (subcommand === "" && !token.startsWith("--") && positional.length > 0 && positional.length <= 1) {
      const last = positional[positional.length - 1];
      if (last === "delend") {
        subcommand = token;
        continue;
      }
    }

    if (subcommand) {
      subargs.push(token);
      continue;
    }

    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];

    // Boolean flags never consume the following token
    if (BOOLEAN_FLAGS.has(key) || !next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    i += 1;
  }

  return { positional, flags, subcommand, subargs };
}

export function getFlagString(
  flags: Record<string, string | boolean>,
  name: string
): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

export function hasFlag(
  flags: Record<string, string | boolean>,
  name: string
): boolean {
  return flags[name] === true || typeof flags[name] === "string";
}
