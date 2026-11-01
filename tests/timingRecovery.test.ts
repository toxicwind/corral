import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { CorralTimer } from "../src/timing.ts";
import { extractJson, parseWithRecovery } from "../src/structuredRecovery.ts";

describe("CorralTimer", () => {
  test("measures sync and async stages, summary lists slowest first", async () => {
    const t = new CorralTimer("test-run");
    t.measureSync("fast", () => 1);
    await t.measure("slow", async () => {
      await new Promise(r => setTimeout(r, 25));
      return 2;
    });
    const recs = t.getRecords();
    expect(recs.length).toBe(2);
    expect(recs.every(r => r.runId === "test-run")).toBe(true);
    expect(recs.every(r => r.ms >= 0)).toBe(true);
    const slow = recs.find(r => r.stage === "slow")!;
    expect(slow.ms).toBeGreaterThanOrEqual(15);
    const summary = t.summary();
    expect(summary).toContain("slow");
    expect(summary).toContain("TOTAL");
    // slowest-first ordering: "slow" line appears before "fast" line
    expect(summary.indexOf("slow")).toBeLessThan(summary.indexOf("fast"));
  });

  test("records stage even when fn throws", () => {
    const t = new CorralTimer("test-run-2");
    expect(() => t.measureSync("boom", () => { throw new Error("x"); })).toThrow();
    expect(t.getRecords().length).toBe(1);
  });
});

describe("extractJson", () => {
  test("strips fences and trailing prose", () => {
    const raw = 'Here you go:\n```json\n{"a": 1}\n```\nHope that helps.';
    expect(extractJson(raw)).toBe('{"a": 1}');
  });
  test("handles bare JSON with leading prose", () => {
    expect(extractJson('Sure. {"a": [1, 2]} done')).toBe('{"a": [1, 2]}');
  });
  test("handles braces inside strings", () => {
    expect(extractJson('{"a": "}{"} trailing')).toBe('{"a": "}{"}');
  });
});

describe("parseWithRecovery", () => {
  const schema = z.object({ questions: z.array(z.object({ question: z.string() })).min(1) });

  test("parses valid output without repair", async () => {
    let repairs = 0;
    const out = await parseWithRecovery(
      schema,
      '```json\n{"questions": [{"question": "q?"}]}\n```',
      async () => { repairs++; return ""; },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.questions.length).toBe(1);
      expect(out.repaired).toBe(false);
    }
    expect(repairs).toBe(0);
  });

  test("repairs invalid output once via repair callback", async () => {
    let repairs = 0;
    const out = await parseWithRecovery(
      schema,
      '{"questions": []}',
      async (feedback: string) => {
        repairs++;
        expect(feedback).toContain("Validation errors");
        return '{"questions": [{"question": "fixed?"}]}';
      },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.repaired).toBe(true);
      expect(out.attempts).toBe(2);
    }
    expect(repairs).toBe(1);
  });

  test("gives up after maxAttempts and reports the error", async () => {
    const out = await parseWithRecovery(
      schema,
      "not json at all",
      async () => "still not json",
      { maxAttempts: 2 },
    );
    expect(out.ok).toBe(false);
    if (out.ok === false) {
      expect(out.attempts).toBe(2);
      expect(out.error.length).toBeGreaterThan(0);
    }
  });
});