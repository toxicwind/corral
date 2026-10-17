/**
 * Environment & secrets handling for Corral
 * 
 * Cleaned from original cli/index.ts which had minified one-liners
 * and hardcoded $HOME/.secrets [was hardcoded] paths.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CHECK_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ESTATE_ROUTER_URL",
  "ESTATE_ROUTER_PORT",
  "NIM_PROXY_BASE_URL",
  "NIM_PROXY_API_KEY",
  "FLOCK_API_KEY",
  "FLOCK_BASE_URL",
  "FLOCK_MODEL",
  "NVIDIA_API_KEY",
  "WORKFLOW_MAX_CONCURRENCY",
] as const;

export function redact(value?: string): string {
  if (!value) return "(unset)";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)} len=${value.length}`;
}

export function loadSecrets(): void {
  // Try multiple locations, no hardcoded user path
  const candidates = [
    process.env.CORRAL_SECRETS_PATH,
    join(homedir(), ".secrets"),
    join(homedir(), ".config", "corral", "secrets"),
    ".env",
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const content = readFileSync(path, "utf8");
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (match && !process.env[match[1]]) {
          process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
        }
      }
      // Only load first found file
      break;
    } catch {
      // ignore
    }
  }
}

export function dumpCheckEnv(): never {
  loadSecrets();
  const env: Record<string, string> = {};
  for (const key of CHECK_ENV_KEYS) {
    const val = process.env[key];
    env[key] = key.includes("KEY") ? redact(val) : (val ?? "(unset)");
  }
  const routerUrl = process.env.CUTTINGGATE_URL ?? process.env.ESTATE_ROUTER_URL ?? "http://127.0.0.1";
  const routerPort = process.env.CUTTINGGATE_PORT ?? process.env.ESTATE_ROUTER_PORT ?? "25200";
  
  console.log(JSON.stringify({
    env,
    resolved: {
      router: `${routerUrl}:${routerPort}`,
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? `${routerUrl}:${routerPort}/v1`,
    },
    cwd: process.cwd(),
  }, null, 2));
  process.exit(0);
}

export function parseFinite(
  value: string | number | undefined,
  fallback: number
): number {
  if (value === undefined) return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
