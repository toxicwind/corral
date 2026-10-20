
/**
 * Regression tests for the 2026-10-01 routing outage.
 *
 * Root cause chain:
 *  1. BASH_ENV=/home/toxic/.bashrc.env did `set -a; source ~/.secrets`,
 *     clobbering the corral CLI's per-run routing (NIM_BASE_URL=:25193 hodos)
 *     back to the stale .secrets value (:25104 broken estate router) in
 *     every bash subprocess of the agent spawn chain.
 *  2. The claude shim wrapper mapped the deprecated NIM_PROXY_API_KEY alias
 *     over the caller-provided NVIDIA_API_KEY unconditionally, so agents
 *     that did reach hodos :25193 presented the wrong (55-char alias) key.
 *
 * These tests lock the TS side: hodos config resolves to the live :25193
 * endpoint and proxyEnvOverrides emits the exact known-good triple
 * (base URL :25193/v1, hodos key, nemotron model).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  resolveProxyConfig,
  proxyEnvOverrides,
} from "../src/nimProxy.ts";

const ROUTING_KEYS = [
  "HODOS_API_KEY",
  "HODOS_BASE_URL",
  "HODOS_MODEL",
  "NIM_PROXY_API_KEY",
  "NIM_PROXY_BASE_URL",
  "NIM_PROXY_MODEL",
  "ESTATE_ROUTER_URL",
  "ESTATE_ROUTER_PORT",
  "NVIDIA_API_KEY",
  "ANTHROPIC_API_KEY",
];

let savedRouting: Record<string, string | undefined>;

beforeEach(() => {
  savedRouting = {};
  for (const k of ROUTING_KEYS) {
    savedRouting[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ROUTING_KEYS) {
    if (savedRouting[k] === undefined) delete process.env[k];
    else process.env[k] = savedRouting[k];
  }
});

describe("2026-10-01 routing regression", () => {
  test("hodos base URL wins over the stale :25104 default", () => {
    process.env.HODOS_BASE_URL = "http://127.0.0.1:25193";
    process.env.HODOS_API_KEY = "hodos-test-key-36chars-padded-000000";
    process.env.HODOS_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
    const cfg = resolveProxyConfig();
    expect(cfg.baseUrl).toBe("http://127.0.0.1:25193");
    expect(cfg.baseUrl).not.toContain("25104");
  });

  test("proxyEnvOverrides emits the known-good hodos triple", () => {
    process.env.HODOS_BASE_URL = "http://127.0.0.1:25193";
    process.env.HODOS_API_KEY = "hodos-test-key-36chars-padded-000000";
    process.env.HODOS_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
    const cfg = resolveProxyConfig();
    const env = proxyEnvOverrides(cfg);
    expect(env.NIM_BASE_URL).toBe("http://127.0.0.1:25193/v1");
    expect(env.NVIDIA_API_KEY).toBe("hodos-test-key-36chars-padded-000000");
    expect(env.NIM_MODEL).toBe("nvidia/nemotron-3-ultra-550b-a55b");
  });

  test("deprecated NIM_PROXY alias never overrides an explicit hodos key", () => {
    process.env.HODOS_BASE_URL = "http://127.0.0.1:25193";
    process.env.HODOS_API_KEY = "hodos-test-key-36chars-padded-000000";
    process.env.NIM_PROXY_API_KEY = "stale-55-char-deprecated-alias-key-0000000000000000";
    const cfg = resolveProxyConfig();
    // resolveProxyApiKey must prefer the direct hodos key over the alias
    const env = proxyEnvOverrides(cfg);
    expect(env.NVIDIA_API_KEY).toBe("hodos-test-key-36chars-padded-000000");
    expect(env.NVIDIA_API_KEY).not.toBe(process.env.NIM_PROXY_API_KEY);
  });
});