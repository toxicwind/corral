import React from "react";
import { createSmithers, ClaudeCodeAgent, CodexAgent, Sequence, Ralph } from "smthrs";
import { SuperRalph } from "../src";
import { InterpretConfig, FinalReport, CompletionValidator } from "../src/components";
import { ralphOutputSchemas } from "../src";

const REPO_ROOT = "/home/toxic/pens/ranch/products/corral";
const DB_PATH = "/home/toxic/pens/ranch/products/corral/.smithers/workflow.db";
const HAS_CLAUDE = true;
const HAS_CODEX = false;
const PROMPT_TEXT = "0s 󰉋 → .../corral 󰜥 󰘬 main\n    bun install\nbun install v1.4.4-canary.1 (3bf1a0646)\n38 |     bun-types: ^1.3.9,\n         ^\nwarn: Duplicate key bun-types in object literal\n   at /home/toxic/pens/ranch/products/corral/package.json:38:5\n\n38 |     bun-types: ^1.3.9,\n         ^\nwarn: Duplicate dependency: bun-types specified in package.json\n   at /home/toxic/pens/ranch/products/corral/package.json:38:5\n\n35 |     bun-types: ^1.4.4,\n                      ^\nnote: bun-types originally specified here\n   at /home/toxic/pens/ranch/products/corral/package.json:35:18\n\n+ @types/better-sqlite3@7.6.13\n+ @types/bun@1.4.4\n+ @types/node@22.20.5 (v26.6.6 available)\n+ @types/react@18.3.31\n+ bun-types@1.4.4\n+ typescript@5.9.3\n+ @opentui/core@0.1.107\n+ better-sqlite3@11.10.0\n+ effect@4.0.0-beta.102\n+ react@19.3.0\n+ smthrs@0.35.0\n+ zod@4.6.5\n\n782 packages installed [40.67s]\n󰪢 40s 󰉋 → .../corral 󰜥 󰘬 main\n   ";
const PROMPT_SPEC_PATH = null;
const PACKAGE_SCRIPTS = {};
const FALLBACK_CONFIG = {
  "maxConcurrency": 8,
  "maxIterations": 25,
  "focuses": []
};
const CLARIFICATION_SESSION = null;
// Finite-by-default: Ralph loops exit on a real done predicate; this ceiling
// is the backstop (onMaxReached="fail" makes exhaustion loud, exit non-zero).
const MAX_ITERATIONS = 25;
const { smithers, outputs, Workflow } = createSmithers(
  ralphOutputSchemas,
  { dbPath: DB_PATH }
);

function createClaude(systemPrompt: string) {
  return new ClaudeCodeAgent({
    model: "freeinference/qwen3.6-35b",
    systemPrompt,
    cwd: REPO_ROOT,
    dangerouslySkipPermissions: true,
    timeoutMs: 60 * 60 * 1000,
  });
}

function createCodex(systemPrompt: string) {
  return new CodexAgent({
    model: "gpt-5.3-codex",
    systemPrompt,
    cwd: REPO_ROOT,
    yolo: true,
    timeoutMs: 60 * 60 * 1000,
  });
}

function choose(primary: "claude" | "codex", systemPrompt: string) {
  if (primary === "claude" && HAS_CLAUDE) return createClaude(systemPrompt);
  if (primary === "codex" && HAS_CODEX) return createCodex(systemPrompt);
  if (HAS_CLAUDE) return createClaude(systemPrompt);
  return createCodex(systemPrompt);
}

const planningAgent = choose("claude", "Plan and research next tickets.");
const implementationAgent = choose("claude", "Implement with test-driven development and jj workflows.");
const testingAgent = choose("claude", "Run tests and validate behavior changes.");
const reviewingAgent = choose("codex", "Review for regressions, spec drift, and correctness.");
const reportingAgent = choose("claude", "Write concise, accurate ticket status reports.");
const finalAgent = choose("claude", "Write the final reply for a completed autonomous workflow run. Follow the task instructions exactly; when asked for an exact reply, output only that.");
const validatorAgent = choose("claude", "Validate that a completed autonomous workflow run actually satisfied the original goal. Be strict, literal, and evidence-driven.");

export default smithers((ctx) => (
  <Workflow name="super-ralph-full">
    <Sequence>
      {/* Step 1: Interpret Config (clarification session already collected by CLI) */}
      <InterpretConfig
        prompt={PROMPT_TEXT}
        clarificationSession={CLARIFICATION_SESSION}
        repoRoot={REPO_ROOT}
        fallbackConfig={FALLBACK_CONFIG}
        packageScripts={PACKAGE_SCRIPTS}
        detectedAgents={{
          claude: HAS_CLAUDE,
          codex: HAS_CODEX,
          gh: false,
        }}
        agent={planningAgent}
      />

      {/* Step 2: Run the finite SuperRalph work loops (skipped for simple replies) */}
      {(ctx.latest("interpret_config", "interpret-config") as any)?.isSimpleReply !== true && (
      <SuperRalph
        ctx={ctx}
        outputs={outputs}
        {...((ctx.latest("interpret_config", "interpret-config") as any) || FALLBACK_CONFIG)}
        maxIterations={MAX_ITERATIONS}
        agents={{
          planning: { agent: planningAgent, description: "Plan and research next tickets.", isScheduler: true },
          implementation: { agent: implementationAgent, description: "Implement with test-driven development and jj workflows." },
          testing: { agent: testingAgent, description: "Run tests and validate behavior changes." },
          reviewing: { agent: reviewingAgent, description: "Review for regressions, spec drift, and correctness." },
          reporting: { agent: reportingAgent, description: "Write concise, accurate ticket status reports." },
        }}
      />
      )}

      {/* Step 3: Final report - produces the reply the CLI prints */}
      <FinalReport
        prompt={PROMPT_TEXT}
        agent={finalAgent}
        output={outputs.final_report}
      />

      {/* Step 4: Completion validation - quiescence is not completion.
          A run that stops without satisfying the original goal must never
          exit 0. valid=false fails loudly: non-zero exit, failed workflow row. */}
      <Ralph
        until={(ctx.latest("completion_validator", "completion-validator") as any)?.valid === true}
        maxIterations={1}
        onMaxReached="fail"
      >
        <CompletionValidator
          prompt={PROMPT_TEXT}
          agent={validatorAgent}
          ctx={ctx}
          output={outputs.completion_validator}
        />
      </Ralph>
    </Sequence>
  </Workflow>
));
