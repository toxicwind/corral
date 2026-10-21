/**
 * DelendAI integration module
 *
 * Merges DelendAI's shared-checkout-merge development profile, proposal
 * guardian, and adaptive optimizer into Corral's merge queue and ticket
 * scheduler pipelines.
 */

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
  GuardianVerdict,
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
