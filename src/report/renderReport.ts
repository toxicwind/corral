/**
 * Corral run-report renderer — generates the HTML report for a completed
 * Smithers run. Single self-contained file: embedded CSS (design tokens),
 * zero external assets, zero render-blocking JS (one tiny theme toggle).
 *
 * Data sources (first valid wins):
 *   1. the smithers run SQLite DB (report / land tables — same as Monitor)
 *   2. the NDJSON event stream at .smithers/executions/<run>/logs/stream.ndjson
 *
 * Responsive: mobile-first single column → two-column at 640px →
 * full dashboard grid at 1024px+, capped at 72rem. Dark-first with a working
 * light mode (prefers-color-scheme + manual toggle persisted in localStorage).
 */

import { cssVariables, statusMeta, toRunStatus, type RunStatus } from "../ui/tokens";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface ReportStep {
  name: string;
  status: RunStatus;
  startedAt?: string;
  durationMs?: number;
  summary?: string;
  detail?: string;      // longer text / JSON, shown in <details>
}

export interface RunReportData {
  runId: string;
  projectName: string;
  prompt: string;
  status: RunStatus;
  startedAt?: string;
  durationMs?: number;
  steps: ReportStep[];
  finalReply?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDuration(ms?: number): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Stylesheet — complete, no placeholders
// ---------------------------------------------------------------------------

function stylesheet(): string {
  return `
:root{${cssVariables("dark")}}
[data-theme="light"]{${cssVariables("light")}}
@media (prefers-color-scheme:light){:root:not([data-theme]){${cssVariables("light")}}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-sans);
  font-size:1rem;line-height:1.6;min-height:100vh}
::selection{background:var(--brand);color:#fff}
a{color:var(--info);text-decoration:none}
a:hover{text-decoration:underline}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--brand);outline-offset:2px;border-radius:4px}

/* Sticky summary header */
.run-header{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 88%,transparent);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border)}
.run-header-inner{max-width:72rem;margin:0 auto;padding:1rem 1.25rem;display:flex;gap:1rem;align-items:center;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:.6rem;font-weight:700;font-size:1.1rem;letter-spacing:.02em}
.brand-mark{width:1.75rem;height:1.75rem;border-radius:.5rem;background:linear-gradient(135deg,var(--brand),var(--brand-dim));
  display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:.95rem}
.run-id{font-family:var(--font-mono);font-size:.8rem;color:var(--text-faint)}
.header-spacer{flex:1}

/* Status pill */
.pill{display:inline-flex;align-items:center;gap:.4rem;padding:.3rem .8rem;border-radius:var(--radius,999px);
  border-radius:999px;font-size:.8rem;font-weight:600;letter-spacing:.03em;text-transform:uppercase;
  border:1px solid currentColor;background:color-mix(in srgb,currentColor 12%,transparent)}
.pill .dot{font-size:.7rem}

/* Theme toggle */
.theme-toggle{background:var(--bg-card);border:1px solid var(--border);color:var(--text-dim);
  border-radius:999px;padding:.4rem .9rem;font-size:.8rem;cursor:pointer;font-family:var(--font-sans)}
.theme-toggle:hover{color:var(--text);border-color:var(--brand)}

/* Layout */
.page{max-width:72rem;margin:0 auto;padding:1.5rem 1.25rem 4rem}
.hero{margin:1rem 0 2rem}
.hero h1{font-size:2rem;line-height:1.25;margin:0 0 .5rem;font-weight:700;letter-spacing:-.01em}
.hero .prompt{color:var(--text-dim);font-size:1rem;max-width:60ch}
.meta-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem;margin:1.5rem 0}
.meta-card{background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:.9rem 1.1rem}
.meta-card .k{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-faint);margin-bottom:.25rem}
.meta-card .v{font-size:1.05rem;font-weight:600;font-family:var(--font-mono)}
@media(min-width:640px){.meta-grid{grid-template-columns:repeat(4,1fr)}}

/* Progress */
.progress-wrap{margin:1.5rem 0}
.progress-label{display:flex;justify-content:space-between;font-size:.85rem;color:var(--text-dim);margin-bottom:.4rem}
.progress{height:.6rem;border-radius:999px;background:var(--bg-raised);overflow:hidden;border:1px solid var(--border)}
.progress>div{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--brand),var(--info));
  transition:width .5s ease;min-width:2%}

/* Steps */
.steps-head{display:flex;align-items:baseline;justify-content:space-between;margin:2rem 0 1rem}
.steps-head h2{font-size:1.25rem;margin:0}
.step-list{display:grid;gap:.75rem;grid-template-columns:1fr}
@media(min-width:1024px){.step-list{grid-template-columns:1fr 1fr}}
.step{background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden}
.step-top{display:flex;gap:.75rem;align-items:flex-start;padding:1rem 1.1rem}
.step-icon{font-size:1rem;line-height:1.5;flex:none}
.step-name{font-weight:600;flex:1;min-width:0;overflow-wrap:anywhere}
.step-dur{font-family:var(--font-mono);font-size:.78rem;color:var(--text-faint);white-space:nowrap}
.step-summary{padding:0 1.1rem .6rem;color:var(--text-dim);font-size:.9rem}
.step details{border-top:1px solid var(--border-soft)}
.step summary{padding:.6rem 1.1rem;cursor:pointer;font-size:.82rem;color:var(--text-faint);list-style:none;display:flex;gap:.5rem;align-items:center}
.step summary::-webkit-details-marker{display:none}
.step summary::before{content:"▸";transition:transform .15s}
.step details[open] summary::before{transform:rotate(90deg)}
.step summary:hover{color:var(--text)}
.step pre{margin:0;padding:1rem 1.1rem;background:var(--bg-raised);border-top:1px solid var(--border-soft);
  font-family:var(--font-mono);font-size:.78rem;line-height:1.55;overflow-x:auto;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text-dim)}
.step-status{border-left:3px solid}

/* Final reply / error */
.final{margin-top:2rem;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:1.25rem}
.final h2{font-size:1.1rem;margin:0 0 .75rem}
.final .reply{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.95rem}
.error-box{margin-top:2rem;border:1px solid var(--error);border-radius:10px;padding:1.25rem;
  background:color-mix(in srgb,var(--error) 8%,transparent)}
.error-box h2{color:var(--error);font-size:1.1rem;margin:0 0 .5rem}
.error-box pre{font-family:var(--font-mono);font-size:.8rem;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text-dim);margin:0}

/* Empty state */
.empty{border:1px dashed var(--border);border-radius:10px;padding:2.5rem 1.5rem;text-align:center;color:var(--text-faint)}

/* Footer */
.footer{margin-top:3rem;padding-top:1.25rem;border-top:1px solid var(--border);color:var(--text-faint);
  font-size:.8rem;display:flex;justify-content:space-between;flex-wrap:wrap;gap:.5rem}

@media print{
  .run-header{position:static}
  .theme-toggle{display:none}
  body{background:#fff}
  .step-list{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){.progress>div{transition:none}.step summary::before{transition:none}}
`;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function pill(status: RunStatus): string {
  const m = statusMeta[status];
  return `<span class="pill" style="color:${m.color.hex}"><span class="dot" aria-hidden="true">${m.icon}</span>${m.label}</span>`;
}

function stepCard(s: ReportStep): string {
  const m = statusMeta[s.status];
  const detail = s.detail
    ? `<details><summary>Step output</summary><pre>${esc(s.detail)}</pre></details>`
    : "";
  return `<article class="step">
  <div class="step-status" style="border-color:${m.color.hex};padding-left:1.1rem">
    <div class="step-top">
      <span class="step-icon" style="color:${m.color.hex}" aria-hidden="true">${m.icon}</span>
      <span class="step-name">${esc(s.name)}</span>
      <span class="step-dur">${fmtDuration(s.durationMs)}</span>
    </div>
    ${s.summary ? `<p class="step-summary">${esc(s.summary)}</p>` : ""}
  </div>${detail}
</article>`;
}

export function renderRunReport(d: RunReportData): string {
  const done = d.steps.filter((s) => s.status === "success").length;
  const total = d.steps.length;
  const pct = total === 0 ? (d.status === "success" ? 100 : 0) : Math.round((done / total) * 100);

  const stepsHtml =
    total === 0
      ? `<div class="empty">No steps recorded for this run.</div>`
      : `<div class="step-list">${d.steps.map(stepCard).join("")}</div>`;

  const finalHtml = d.finalReply
    ? `<section class="final" aria-label="Final reply"><h2>Final reply</h2><div class="reply">${esc(d.finalReply)}</div></section>`
    : "";
  const errorHtml = d.error
    ? `<section class="error-box" role="alert" aria-label="Run error"><h2>Run failed</h2><pre>${esc(d.error)}</pre></section>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${esc(d.projectName)} run ${esc(d.runId)} — ${statusMeta[d.status].label}</title>
<style>${stylesheet()}</style>
</head>
<body>
<header class="run-header">
  <div class="run-header-inner">
    <span class="brand"><span class="brand-mark" aria-hidden="true">◈</span>corral</span>
    ${pill(d.status)}
    <code class="run-id">${esc(d.runId)}</code>
    <span class="header-spacer"></span>
    <button class="theme-toggle" id="themeToggle" type="button" aria-label="Toggle color theme">◐ theme</button>
  </div>
</header>
<main class="page">
  <section class="hero">
    <h1>${esc(d.projectName)}</h1>
    <p class="prompt">${esc(d.prompt)}</p>
  </section>

  <div class="meta-grid">
    <div class="meta-card"><div class="k">Started</div><div class="v">${fmtTime(d.startedAt)}</div></div>
    <div class="meta-card"><div class="k">Duration</div><div class="v">${fmtDuration(d.durationMs)}</div></div>
    <div class="meta-card"><div class="k">Steps</div><div class="v">${done}/${total}</div></div>
    <div class="meta-card"><div class="k">Status</div><div class="v">${statusMeta[d.status].label}</div></div>
  </div>

  <div class="progress-wrap" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Steps completed">
    <div class="progress-label"><span>Steps completed</span><span>${pct}%</span></div>
    <div class="progress"><div style="width:${pct}%"></div></div>
  </div>

  <div class="steps-head"><h2>Steps</h2><span class="run-id">${total} recorded</span></div>
  ${stepsHtml}
  ${finalHtml}
  ${errorHtml}

  <footer class="footer">
    <span>Generated by corral</span>
    <span>${fmtTime(d.startedAt)}${d.durationMs != null ? ` · ran ${fmtDuration(d.durationMs)}` : ""}</span>
  </footer>
</main>
<script>
(function(){
  var root=document.documentElement, btn=document.getElementById('themeToggle');
  function apply(t){root.setAttribute('data-theme',t);try{localStorage.setItem('corral-theme',t)}catch(e){}}
  var saved=null;
  try{saved=localStorage.getItem('corral-theme')}catch(e){}
  if(saved==='light'||saved==='dark')apply(saved);
  else if(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)apply('light');
  btn.addEventListener('click',function(){
    apply(root.getAttribute('data-theme')==='light'?'dark':'light');
  });
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Collection — build RunReportData from the run's own artifacts
// ---------------------------------------------------------------------------

export interface CollectOptions {
  runId: string;
  /** repo root (contains .smithers/) */
  root: string;
  projectName?: string;
  prompt?: string;
}

interface DbRow { [k: string]: any }

/**
 * Collect run data. Tries the smithers SQLite DB first (report/land tables,
 * same source as Monitor), then falls back to the NDJSON event stream.
 * Never throws — returns the best data available.
 */
export async function collectRunReport(opts: CollectOptions): Promise<RunReportData> {
  const { runId, root } = opts;
  const projectName = opts.projectName ?? root.split("/").filter(Boolean).pop() ?? "corral";
  const data: RunReportData = {
    runId,
    projectName,
    prompt: opts.prompt ?? "",
    status: "unknown",
    steps: [],
  };

  // Path 1: SQLite DB (bun:sqlite, same as Monitor.tsx)
  try {
    const { Database } = await import("bun:sqlite");
    const dbPath = `${root}/.smithers/smithers.db`;
    const f = Bun.file(dbPath);
    if (await f.exists()) {
      const db = new Database(dbPath, { readonly: true });
      try {
        const tables = db.query(
          `SELECT name FROM sqlite_master WHERE type='table'`
        ).all() as DbRow[];
        const names = new Set(tables.map((t) => String(t.name)));
        if (names.has("report")) {
          const rows = db.query(
            `SELECT * FROM report WHERE run_id = ? ORDER BY rowid`
          ).all(runId) as DbRow[];
          for (const r of rows) {
            const status = toRunStatus(r.status ?? r.state);
            data.steps.push({
              name: String(r.name ?? r.step ?? r.title ?? `step ${data.steps.length + 1}`),
              status,
              startedAt: r.started_at ?? r.created_at ?? undefined,
              durationMs: r.duration_ms ?? r.elapsed_ms ?? undefined,
              summary: r.summary ?? r.description ?? undefined,
              detail: r.output ?? r.detail ?? r.data ? safeJson(r.output ?? r.detail ?? r.data) : undefined,
            });
          }
        }
        if (names.has("land")) {
          const rows = db.query(
            `SELECT * FROM land WHERE run_id = ? ORDER BY rowid DESC LIMIT 1`
          ).all(runId) as DbRow[];
          const last = rows[0];
          if (last) {
            data.status = toRunStatus(last.status ?? last.state ?? data.status);
            data.startedAt = last.started_at ?? last.created_at ?? data.startedAt;
            data.durationMs = last.duration_ms ?? last.elapsed_ms ?? data.durationMs;
            data.prompt = String(last.prompt ?? last.input ?? data.prompt ?? "");
            data.finalReply = last.final_reply ?? last.reply ?? undefined;
            data.error = last.error ?? last.error_message ?? undefined;
          }
        }
        if (names.has("final_report")) {
          const rows = db.query(
            `SELECT reply FROM final_report WHERE run_id = ? ORDER BY iteration DESC LIMIT 1`
          ).all(runId) as DbRow[];
          if (rows[0]?.reply && !data.finalReply) data.finalReply = String(rows[0].reply);
        }
      } finally {
        db.close();
      }
    }
  } catch {
    // bun:sqlite unavailable or DB unreadable — fall through to NDJSON
  }

  // Path 2: NDJSON event stream
  if (data.steps.length === 0) {
    try {
      const streamPath = `${root}/.smithers/executions/${runId}/logs/stream.ndjson`;
      const f = Bun.file(streamPath);
      if (await f.exists()) {
        const text = await f.text();
        for (const line of text.split("\n")) {
          const t = line.trim();
          if (!t) continue;
          let ev: any;
          try { ev = JSON.parse(t); } catch { continue; }
          const type = String(ev.type ?? "");
          if (type === "RunStarted") {
            data.startedAt = new Date(ev.timestampMs).toISOString();
          } else if (type === "RunCompleted" || type === "RunSucceeded") {
            data.status = "success";
            data.durationMs = ev.timestampMs && data.startedAt
              ? ev.timestampMs - new Date(data.startedAt).getTime() : undefined;
          } else if (type === "RunFailed") {
            data.status = "failed";
            const e = ev.error ?? {};
            data.error = [e.name, e.message].filter(Boolean).join(": ") || "unknown error";
            if (e.stack) data.steps.push({ name: "run", status: "failed", detail: String(e.stack) });
          } else if (/step/i.test(type)) {
            data.steps.push({
              name: String(ev.stepName ?? ev.name ?? type),
              status: toRunStatus(ev.status ?? (type.includes("Fail") ? "failed" : "running")),
              detail: ev.output ?? ev.data ? safeJson(ev.output ?? ev.data) : undefined,
            });
          }
        }
      }
    } catch {
      // no stream — keep best-effort data
    }
  }

  if (data.status === "unknown" && data.steps.length > 0) {
    data.status = data.steps.every((s) => s.status === "success")
      ? "success"
      : data.steps.some((s) => s.status === "failed") ? "failed" : "running";
  }
  return data;
}

function safeJson(v: unknown): string {
  if (typeof v === "string") return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

/**
 * Render + write the report to .smithers/reports/<runId>.html.
 * Returns the written path.
 */
export async function writeRunReport(opts: CollectOptions): Promise<string> {
  const data = await collectRunReport(opts);
  const html = renderRunReport(data);
  const path = `${opts.root}/.smithers/reports/${opts.runId}.html`;
  await Bun.write(path, html);
  return path;
}