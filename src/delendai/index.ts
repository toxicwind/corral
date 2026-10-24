/**
 * DelendAI integration module — merged with Corral.
 *
 * Merges DelendAI's shared-checkout-merge development profile, proposal
 * guardian, adaptive optimizer, AND every agentic delend-* primitive now
 * shipped as first-class @delendai/* plugins (work-refs, code-race,
 * experimental, iterate, oracle-market, model-race, forge-audit,
 * intent-router, global-gh, rig-c2) into one importable surface.
 *
 * Consumers:
 *   import { checkpoint, quickMain, raceCore, main as oracleMain } from "@estate/corral/delendai";
 *   import workRefsPlugin from "@estate/corral/delendai/work-refs";
 */

// ─── DelendAI shared-checkout-merge profile, guardian, optimizer ────
export {
  DEL_ENDAI_DEV_PROFILE_SCHEMA,
  type DelendAIDevProfile,
  getWorktreeRef,
  parseWorktreeRef,
  DEFAULT_MERGE_POLICY,
  getMergePolicy,
  type MergePolicy,
} from "./profile";

export {
  proposalGuardSchema,
  type ProposalGuard,
  type GuardianVerdict,
  LandedSliceTracker,
  DEFAULT_BUDGET_LIMITS,
  type BudgetLimits,
  verifyProposal,
  filterApproved,
} from "./guardian";

export {
  candidateSchema,
  rankResultSchema,
  type Candidate,
  type RankResult,
  DEFAULT_BUDGET_POOL,
  type BudgetPool,
  rankCandidates,
  ticketsToCandidates,
  pickNextTicket,
} from "./optimizer";

// ─── Agentic delend-* primitives (first-class @delendai/* plugins) ──
export * as workRefs from "/home/toxic/pens/barn/corral/delendai/plugins/work-refs/src/index.ts";
export * as codeRace from "/home/toxic/pens/barn/corral/delendai/plugins/code-race/src/index.ts";
export * as experimental from "/home/toxic/pens/barn/corral/delendai/plugins/experimental/src/index.ts";
export * as iterate from "/home/toxic/pens/barn/corral/delendai/plugins/iterate/src/index.ts";
export * as oracleMarket from "/home/toxic/pens/barn/corral/delendai/plugins/oracle-market/src/index.ts";
export * as modelRace from "/home/toxic/pens/barn/corral/delendai/plugins/model-race/src/index.ts";
export * as forgeAudit from "/home/toxic/pens/barn/corral/delendai/plugins/forge-audit/src/index.ts";
export * as intentRouter from "/home/toxic/pens/barn/corral/delendai/plugins/intent-router/src/index.ts";
export * as globalGh from "/home/toxic/pens/barn/corral/delendai/plugins/global-gh/src/index.ts";
export * as rigC2 from "/home/toxic/pens/barn/corral/delendai/plugins/rig-c2/src/index.ts";

// Re-export plugin default exports for delendai.config.json plugin registration.
export { default as workRefsPlugin } from "/home/toxic/pens/barn/corral/delendai/plugins/work-refs/src/index.ts";
export { default as codeRacePlugin } from "/home/toxic/pens/barn/corral/delendai/plugins/code-race/src/index.ts";
export { default as experimentalPlugin } from "/home/toxic/pens/barn/corral/delendai/plugins/experimental/src/index.ts";
export { default as iteratePlugin } from "/home/toxic/pens/barn/corral/delendai/plugins/iterate/src/index.ts";
export { default as oracleMarketPlugin } from "/home/toxic/pens/barn/corral/delendai/plugins/oracle-market/src/index.ts";
export { default as modelRacePlugin } from "/home/toxic/pens/barn/corral/delendai/plugins/model-race/src/index.ts";
export { default as forgeAuditPlugin } from "/home/toxic/pens/barn/corral/delendai/plugins/forge-audit/src/index.ts";
export { default as intentRouterPlugin } from "/home/toxic/pens/barn/corral/delendai/plugins/intent-router/src/index.ts";
export { default as globalGhPlugin } from "/home/toxic/pens/barn/corral/delendai/plugins/global-gh/src/index.ts";
export { default as rigC2Plugin } from "/home/toxic/pens/barn/corral/delendai/plugins/rig-c2/src/index.ts";