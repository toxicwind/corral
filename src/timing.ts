/**
 * Corral per-stage timing harness (HFT doctrine: measure everything).
 *
 * Usage in the CLI:
 *   const timer = new CorralTimer(runId);
 *   await timer.measure("interpret-config", () => runInterpretConfig());
 *   ...
 *   console.log(timer.summary());
 *
 * Every stage is appended as JSONL to ~/.corral/timings/<run-id>.jsonl so
 * timings survive the process and can be aggregated across runs. Persistence
 * failures are swallowed — timing must never break a run.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type StageRecord = {
  runId: string;
  stage: string;
  ms: number;
  ts: string;
};

function timingDir(): string {
  return join(homedir(), ".corral", "timings");
}

function persist(rec: StageRecord): void {
  try {
    const dir = timingDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${rec.runId}.jsonl`), JSON.stringify(rec) + "\n");
  } catch {
    /* timing is advisory — never fail the run */
  }
}

export class CorralTimer {
  private starts = new Map<string, number>();
  private records: StageRecord[] = [];

  constructor(readonly runId: string) {}

  start(stage: string): void {
    this.starts.set(stage, performance.now());
  }

  /** Ends a stage started with start(); returns elapsed ms (-1 if never started). */
  end(stage: string): number {
    const t0 = this.starts.get(stage);
    this.starts.delete(stage);
    const ms = t0 === undefined ? -1 : performance.now() - t0;
    const rec: StageRecord = {
      runId: this.runId,
      stage,
      ms: Math.round(ms * 100) / 100,
      ts: new Date().toISOString(),
    };
    this.records.push(rec);
    persist(rec);
    return ms;
  }

  /** Time an async stage; records even if fn throws. */
  async measure<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    this.start(stage);
    try {
      return await fn();
    } finally {
      this.end(stage);
    }
  }

  /** Time a sync stage; records even if fn throws. */
  measureSync<T>(stage: string, fn: () => T): T {
    this.start(stage);
    try {
      return fn();
    } finally {
      this.end(stage);
    }
  }

  getRecords(): ReadonlyArray<StageRecord> {
    return this.records;
  }

  totalMs(): number {
    return this.records.reduce((a, r) => a + Math.max(0, r.ms), 0);
  }

  /** Human-readable stage breakdown, slowest first. */
  summary(): string {
    const rows = [...this.records].sort((a, b) => b.ms - a.ms);
    const total = this.totalMs();
    const lines = ["", "⏱️  Corral stage timings (run " + this.runId + "):"];
    for (const r of rows) {
      const pct = total > 0 ? ((Math.max(0, r.ms) / total) * 100).toFixed(1) : "0.0";
      lines.push(`   ${r.stage.padEnd(28)} ${r.ms.toFixed(0).padStart(8)} ms  (${pct}%)`);
    }
    lines.push(`   ${"TOTAL".padEnd(28)} ${total.toFixed(0).padStart(8)} ms`);
    return lines.join("\n");
  }
}