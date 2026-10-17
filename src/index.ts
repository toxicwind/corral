/**
 * Corral public API — cleaned
 * 
 * Original index.ts had 195 lines of re-exports. Kept same but organized.
 */

export {
  selectAllTickets,
  selectReviewTickets,
  selectDiscoverTickets,
  selectCompletedTicketIds,
  selectProgressSummary,
  selectTicketReport,
  selectResearch,
  selectPlan,
  selectImplement,
  selectTestResults,
  selectSpecReview,
  selectCodeReviews,
  selectClarifyingQuestions,
  selectInterpretConfig,
  selectMonitor,
  selectTicketPipelineStage,
} from "./selectors";

export type { Ticket, RalphOutputs } from "./selectors";

export {
  SuperRalph,
  Job,
  ClarifyingQuestions,
  InterpretConfig,
  Monitor,
  TicketResume,
  TicketScheduler,
  ticketScheduleSchema,
  scheduledJobSchema,
  computePipelineStage,
  isJobComplete,
  JOB_TYPE_TO_OUTPUT_KEY,
  AgenticMergeQueue,
  mergeQueueResultSchema,
  clarifyingQuestionsOutputSchema,
  interpretConfigOutputSchema,
  monitorOutputSchema,
} from "./components";

export { AgentRegistry, getAgentRegistry, resetAgentRegistry } from "./agentRegistry";
export type { AgentMetadata, AgentStats, AgentRegistrySnapshot } from "./agentRegistry";

export { loadCrossRunTicketState, getResumableTickets, pipelineStageIndex } from "./durability";
export type { CrossRunTicketState } from "./durability";

export type { SuperRalphProps } from "./components/SuperRalph";
export type { JobProps } from "./components/Job";
export type { ClarifyingQuestionsOutput, ClarifyingQuestionsProps } from "./components/ClarifyingQuestions";
export type { InterpretConfigOutput, InterpretConfigProps } from "./components/InterpretConfig";
export type { MonitorOutput, MonitorProps } from "./components/Monitor";
export type { TicketResumeProps } from "./components/TicketResume";
export type { TicketSchedule, TicketScheduleJob, TicketSchedulerProps, TicketState } from "./components/TicketScheduler";
export type { AgenticMergeQueueProps, AgenticMergeQueueTicket, MergeQueueResult } from "./components/AgenticMergeQueue";

export { useSuperRalph } from "./hooks/useSuperRalph";
export type { SuperRalphContext, UseSuperRalphConfig } from "./hooks/useSuperRalph";

export { ralphOutputSchemas } from "./schemas";
export { detectExactReply, normalizeReply } from "./exactReply";

export {
  NimProxyKeyPool,
  resolveProxyConfig,
  resolveProxyApiKey,
  proxyEnvOverrides,
  proxyChatCompletions,
  parseRetryAfterMs,
  NimProxyConfigError,
  DEFAULT_PROXY_BASE_URL,
  DEFAULT_PROXY_MODEL,
} from "./nimProxy";

export type { ProxyConfig, ProxyKeyStats } from "./nimProxy";

export { TelemetricOracle } from "./telemetricOracle";
export type { TelemetryVector, NonInvasiveVerdict, WorkflowDbState } from "./telemetricOracle";

// New clean exports
export { ensureWorkspace, ensureJjAvailable } from "./cli/workspace";
export { dumpCheckEnv, loadSecrets, parseFinite, CHECK_ENV_KEYS } from "./cli/env";
export { parseArgs, printHelp } from "./cli/args";
export type { ParsedArgs } from "./cli/args";
export { runWorkflow } from "./cli/runner";
export type { RunWorkflowOpts } from "./cli/runner";

// Merge queue clean exports
export * from "./mergeQueue";
