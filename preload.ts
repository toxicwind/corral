/**
 * Preload — Effect compatibility shims
 * 
 * Original had 73 lines with detailed comments about beta vs rc.
 * Cleaned: keeps the essential logic, documents why shims exist.
 */

import { mdxPlugin } from "smthrs/mdx-plugin";

mdxPlugin();

// Compat: smthrs packages built against effect@4.0.0-beta.102 use "effect/unstable/*"
// effect >= rc.115 promoted those to stable paths and removed unstable prefix.
// Only shim when native unstable paths DON'T resolve (i.e., on newer effect).

import { plugin } from "bun";
import { createRequire } from "node:module";

const UNSTABLE_PREFIX = "effect/unstable/";
const UNSTABLE_SHIMS = [
  "cluster",
  "cluster/Entity",
  "cluster/MessageStorage",
  "cluster/RunnerHealth",
  "cluster/Runners",
  "cluster/RunnerStorage",
  "cluster/Sharding",
  "cluster/ShardingConfig",
  "cluster/SingleRunner",
  "http/FetchHttpClient",
  "observability/Otlp",
  "process/ChildProcess",
  "process/ChildProcessSpawner",
  "reactivity/Reactivity",
  "rpc/Rpc",
  "rpc/RpcGroup",
  "sql/SqlClient",
  "sql/SqlError",
  "sql/Statement",
  "workflow",
  "workflow/Activity",
  "workflow/DurableDeferred",
  "workflow/Workflow",
  "workflow/WorkflowEngine",
];

function unstableResolvesNatively(): boolean {
  try {
    createRequire(import.meta.url).resolve(UNSTABLE_PREFIX + "workflow");
    return true;
  } catch {
    return false;
  }
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
