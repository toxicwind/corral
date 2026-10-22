// DelendAI integration — development profiles, proposal guardian, optimizer
export * as delendai from "./delendai";
export type {
  DelendAIDevProfile,
  ProposalGuard,
  GuardianVerdict,
  Candidate,
  RankResult,
  BudgetPool,
} from "./delendai";

// Corral workflow re-exports — the workflow generator imports these from
// `.../corral/src` (see the generated workflow.tsx: `import { SuperRalph } from
// "corral/src"`, `import { ralphOutputSchemas } from "corral/src"`). They were
// dropped when this barrel was reduced to delendai-only, which made every
// generated workflow fail at load (`SuperRalph not found`).
export { ralphOutputSchemas } from "./schemas";
export { SuperRalph } from "./components/SuperRalph";
export type { SuperRalphProps } from "./components/SuperRalph";
