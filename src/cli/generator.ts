import { existsSync } from "node:fs";
import { join } from "node:path";

export interface RenderWorkflowParams {
  promptText: string;
  promptSpecPath?: string | null;
  repoRoot: string;
  dbPath: string;
  packageScripts?: Record<string, string>;
  detectedAgents: { claude: boolean; codex: boolean };
  fallbackConfig: any;
  clarificationSession?: any | null;
  maxIterations: number;
  superRalphSourceRoot: string;
  runningFromSource: boolean;
}

export function renderWorkflowFile(params: RenderWorkflowParams): string {
  const {
    promptText,
    promptSpecPath = null,
    repoRoot,
    dbPath,
    packageScripts = {},
    detectedAgents,
    fallbackConfig,
    clarificationSession = null,
    maxIterations,
    superRalphSourceRoot,
    runningFromSource,
  } = params;

  const isSuperRalphRepo =
    existsSync(join(repoRoot, "src/components/SuperRalph.tsx")) &&
    existsSync(join(repoRoot, "src/components/ClarifyingQuestions.tsx"));

  let importPrefix: string;
  if (isSuperRalphRepo) {
    importPrefix = "../../src";
  } else if (runningFromSource) {
    importPrefix = superRalphSourceRoot + "/src";
  } else {
    importPrefix = "@estate/corral";
  }

  return `import React from "react";
import { createSmithers, ClaudeCodeAgent, CodexAgent, Sequence, Ralph } from "smthrs";
import { SuperRalph } from "${importPrefix}";
import { InterpretConfig, FinalReport, CompletionValidator } from "${importPrefix}/components";
import { ralphOutputSchemas, resolveProxyConfig, proxyEnvOverrides } from "${importPrefix}";

const REPO_ROOT = ${JSON.stringify(repoRoot)};
const DB_PATH = ${JSON.stringify(dbPath)};
const HAS_CLAUDE = ${detectedAgents.claude};
const HAS_CODEX = ${detectedAgents.codex};
const PROMPT_TEXT = ${JSON.stringify(promptText)};
const PROMPT_SPEC_PATH = ${JSON.stringify(promptSpecPath)};
const PACKAGE_SCRIPTS = ${JSON.stringify(packageScripts, null, 2)};
const FALLBACK_CONFIG = ${JSON.stringify(fallbackConfig, null, 2)};
const CLARIFICATION_SESSION = ${JSON.stringify(clarificationSession)};
// Finite-by-default: Ralph loops exit on a real done predicate; this ceiling
// is the backstop (onMaxReached="fail" makes exhaustion loud, exit non-zero).
const MAX_ITERATIONS = ${maxIterations};
const { smithers, outputs, Workflow } = createSmithers(
  ralphOutputSchemas,
  { dbPath: DB_PATH }
);

// Route every agent through the hodos router. smithers' ClaudeCodeAgent
// blanks ANTHROPIC_API_KEY on spawn; feeding apiKey (key #1) stops that and
// proxyEnvOverrides sets NIM_BASE_URL / ANTHROPIC_BASE_URL / NIM_MODEL so the
// claude shim talks to the router instead of falling back to a keyless
// Anthropic call. Absorb the no-key case: an unconfigured host still fans out
// and fails loudly at the first agent call.
function proxyAgentOverrides(): { apiKey?: string; env?: Record<string, string>; model?: string } {
  try {
    const config = resolveProxyConfig();
    return {
      apiKey: config.apiKeys[0],
      env: proxyEnvOverrides(config),
      model: config.model,
    };
  } catch {
    return {};
  }
}

function createClaude(systemPrompt: string) {
  const proxy = proxyAgentOverrides();
  return new ClaudeCodeAgent({
    ...(proxy.apiKey !== undefined ? { apiKey: proxy.apiKey } : {}),
    ...(proxy.env ? { env: proxy.env } : {}),
    model: proxy.model ?? process.env.NIM_MODEL ?? "claude-sonnet-4-6",
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
`;
}
