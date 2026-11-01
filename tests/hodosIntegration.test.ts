import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PROXY_BASE_URL,
  DEFAULT_PROXY_MODEL,
  resolveProxyApiKey,
  NimProxyKeyPool,
  proxyEnvOverrides,
} from "../src/nimProxy";

describe("Corral nimProxy & Hodos Integration", () => {
  test("DEFAULT_PROXY_BASE_URL anchors to Hodos (port 25193)", () => {
    expect(DEFAULT_PROXY_BASE_URL).toContain("25193");
  });

  test("DEFAULT_PROXY_MODEL specifies default inference model", () => {
    expect(DEFAULT_PROXY_MODEL).toBeTruthy();
    expect(typeof DEFAULT_PROXY_MODEL).toBe("string");
  });

  test("resolveProxyApiKey resolves environment key or falls back cleanly", () => {
    try {
      const key = resolveProxyApiKey();
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    } catch (e: any) {
      expect(e.name).toBe("NimProxyConfigError");
    }
  });

  test("NimProxyKeyPool tracks per-key rate limits and round-robin rotation", () => {
    const pool = new NimProxyKeyPool(["key-a", "key-b"]);
    expect(pool.size).toBe(2);

    const first = pool.nextAvailable();
    expect(first).toBe("key-a");

    const second = pool.nextAvailable();
    expect(second).toBe("key-b");

    // Record rate limit on key-a
    pool.recordRateLimit("key-a", 10000);
    const afterLimit = pool.nextAvailable();
    expect(afterLimit).toBe("key-b");

    const stats = pool.getStats();
    expect(stats.length).toBe(2);
    expect(stats[0].label).toBe("key#1");
    expect(stats[0].isRateLimited).toBe(true);
  });

  test("proxyEnvOverrides configures environment variables for child processes", () => {
    const overrides = proxyEnvOverrides({
      baseUrl: "http://127.0.0.1:25193",
      apiKeys: ["test-key"],
      model: "test-model",
    });

    expect(overrides.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:25193");
    expect(overrides.NIM_BASE_URL).toBe("http://127.0.0.1:25193/v1");
    expect(overrides.NVIDIA_API_KEY).toBe("test-key");
    expect(overrides.NIM_MODEL).toBe("test-model");
  });
});
