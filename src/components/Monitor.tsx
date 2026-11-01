import React from "react";
import { Task } from "smthrs";
import { z } from "zod";
import type { ClarificationSession } from "../cli/clarifications";
import { colors, statusMeta, toRunStatus, type RunStatus } from "../ui/tokens";

export const monitorOutputSchema = z.object({
  started: z.boolean(),
  status: z.string(),
});

export type MonitorOutput = z.infer<typeof monitorOutputSchema>;

export type MonitorProps = {
  dbPath: string;
  runId: string;
  config: any;
  clarificationSession: ClarificationSession | null;
  prompt: string;
  repoRoot: string;
};

type TaskStatus = "pending" | "running" | "completed" | "failed" | "blocked";

interface TaskInfo {
  id: string;
  nodeId: string;
  status: TaskStatus;
  iteration: number;
  output?: string;
}

/** Map engine task status → semantic RunStatus for token colors. */
function toSemantic(s: TaskStatus): RunStatus {
  switch (s) {
    case "completed": return "success";
    case "failed": return "failed";
    case "running": return "running";
    case "blocked": return "blocked";
    default: return "pending";
  }
}

/**
 * Monitor — OpenTUI live dashboard for a Smithers run.
 *
 * Design-token driven: brand header with progress bar, colored status chips,
 * per-status task icons, selected-row highlight, responsive layout (stacks
 * the detail pane below the task list on narrow terminals < 100 columns).
 */
export function Monitor({
  dbPath,
  runId,
  config,
  prompt,
}: MonitorProps) {
  return (
    <Task
      id="monitor"
      output={monitorOutputSchema}
      continueOnFail={true}
    >
      {async () => {
        const ot = await import("@opentui/core");
        const { createCliRenderer, BoxRenderable, TextRenderable, ScrollBoxRenderable, StyledText, fg, bg, bold, dim } = ot as any;
        const RGBA = ot.RGBA;
        const { Database } = await import("bun:sqlite");

        const rgba = (t: { rgb: [number, number, number] }) => RGBA.fromInts(t.rgb[0], t.rgb[1], t.rgb[2]);

        // Token palette
        const pal = {
          brand: rgba(colors.brand),
          brandSoft: rgba(colors.brandSoft),
          border: rgba(colors.border),
          text: rgba(colors.text),
          textDim: rgba(colors.textDim),
          textFaint: rgba(colors.textFaint),
          bgCard: rgba(colors.bgCard),
          success: rgba(colors.success),
          error: rgba(colors.error),
          warning: rgba(colors.warning),
          info: rgba(colors.info),
          pending: rgba(colors.pending),
          blocked: rgba(colors.blocked),
        };

        const narrow = (process.stdout.columns ?? 120) < 100;

        const renderer = await createCliRenderer({
          screenMode: "alternate-screen",
          useMouse: false,
          exitOnCtrlC: false,
        });

        let tasks: TaskInfo[] = [];
        let selectedIndex = 0;
        let focus: "list" | "detail" = "list";
        let isRunning = true;
        let startedAt = Date.now();

        // -- Root -----------------------------------------------------------
        const root = new BoxRenderable(renderer, {
          id: "root",
          border: true,
          title: ` ◈ corral · ${config.projectName || "Workflow"} `,
          titleAlignment: "left",
          borderColor: pal.border,
          width: "100%",
          height: "100%",
          flexDirection: "column",
          paddingLeft: 1,
          paddingRight: 1,
        });
        renderer.root.add(root);

        // -- Header: run id + prompt ---------------------------------------
        const header = new TextRenderable(renderer, {
          id: "header",
          height: 1,
        });
        root.add(header);

        // -- Progress bar line ----------------------------------------------
        const progressText = new TextRenderable(renderer, { id: "progress", height: 1 });
        root.add(progressText);

        // -- Stat chips line -------------------------------------------------
        const statsText = new TextRenderable(renderer, { id: "stats", height: 1 });
        root.add(statsText);

        // -- Main content: list + detail ------------------------------------
        const content = new BoxRenderable(renderer, {
          id: "content",
          border: false,
          flexDirection: narrow ? "column" : "row",
          flexGrow: 1,
          gap: 1,
        });
        root.add(content);

        const listBox = new BoxRenderable(renderer, {
          id: "listBox",
          border: true,
          title: " Tasks ",
          width: narrow ? "100%" : "45%",
          height: narrow ? "55%" : "100%",
          flexDirection: "column",
          borderColor: pal.border,
        });
        content.add(listBox);

        const listScroll = new ScrollBoxRenderable(renderer, { id: "listScroll", flexGrow: 1, scrollY: true });
        listBox.add(listScroll);
        const listContent = new TextRenderable(renderer, { id: "listContent" });
        listScroll.add(listContent);

        const detailBox = new BoxRenderable(renderer, {
          id: "detailBox",
          border: true,
          title: " Details ",
          flexGrow: 1,
          width: narrow ? "100%" : undefined,
          flexDirection: "column",
          borderColor: pal.border,
        });
        content.add(detailBox);

        const detailScroll = new ScrollBoxRenderable(renderer, { id: "detailScroll", flexGrow: 1, scrollY: true });
        detailBox.add(detailScroll);
        const detailContent = new TextRenderable(renderer, { id: "detailContent" });
        detailScroll.add(detailContent);

        // -- Footer ----------------------------------------------------------
        const footer = new TextRenderable(renderer, { id: "footer", height: 1 });
        root.add(footer);

        // -- Render helpers ---------------------------------------------------
        const st = (...chunks: any[]) => new StyledText(chunks);

        function headerContent(): any {
          const shortId = runId.length > 24 ? runId.slice(0, 24) + "…" : runId;
          const p = prompt.length > 60 ? prompt.slice(0, 57) + "…" : prompt;
          return st(
            bold(fg(pal.brand)("◈ ")),
            dim(fg(pal.textFaint)("run ")),
            fg(pal.text)(shortId),
            dim(fg(pal.textFaint)("  ·  ")),
            fg(pal.textDim)(p),
          );
        }

        function progressContent(): any {
          const total = tasks.length;
          const done = tasks.filter((t) => t.status === "completed").length;
          const frac = total === 0 ? 0 : done / total;
          const w = Math.max(12, Math.min(40, (process.stdout.columns ?? 120) - 30));
          const filled = Math.round(frac * w);
          return st(
            fg(pal.textDim)("progress "),
            fg(pal.brand)("█".repeat(filled)),
            fg(pal.border)("░".repeat(w - filled)),
            fg(pal.textDim)(` ${done}/${total} `),
            bold(fg(pal.text)(`${Math.round(frac * 100)}%`)),
          );
        }

        function statsContent(): any {
          const total = tasks.length;
          const n = (s: TaskStatus) => tasks.filter((t) => t.status === s).length;
          const chip = (label: string, count: number, color: any) =>
            st(fg(color)("● "), fg(pal.textDim)(`${label} `), bold(fg(pal.text)(String(count))));
          const elapsed = Math.round((Date.now() - startedAt) / 1000);
          return st(
            chip("running", n("running"), pal.info), fg(pal.textFaint)("   "),
            chip("done", n("completed"), pal.success), fg(pal.textFaint)("   "),
            chip("failed", n("failed"), pal.error), fg(pal.textFaint)("   "),
            chip("blocked", n("blocked"), pal.blocked), fg(pal.textFaint)("   "),
            chip("pending", n("pending"), pal.pending), fg(pal.textFaint)("   "),
            dim(fg(pal.textFaint)(`total ${total} · ${elapsed}s elapsed`)),
          );
        }

        function listContentStyled(): any {
          if (tasks.length === 0) return st(dim(fg(pal.textFaint)("No tasks yet — waiting for the run to report…")));
          const chunks: any[] = [];
          tasks.forEach((t, i) => {
            const meta = statusMeta[toSemantic(t.status)];
            const sel = i === selectedIndex;
            const name = t.nodeId.length > 34 ? t.nodeId.slice(0, 31) + "…" : t.nodeId;
            const row = [
              fg(pal.textFaint)(sel ? "▸ " : "  "),
              fg(rgba(meta.color))(`${meta.icon} `),
              sel ? bold(fg(pal.text)(name)) : fg(pal.textDim)(name),
            ];
            if (sel) {
              chunks.push(bg(pal.brandSoft)(new StyledText(row as any) as any));
            } else {
              chunks.push(...row);
            }
            if (i < tasks.length - 1) chunks.push("\n");
          });
          return st(...chunks);
        }

        function detailContentStyled(): any {
          const task = tasks[selectedIndex];
          if (!task) return st(dim(fg(pal.textFaint)("Select a task to inspect it")));
          const meta = statusMeta[toSemantic(task.status)];
          return st(
            dim(fg(pal.textFaint)("task    ")), fg(pal.text)(task.nodeId), "\n",
            dim(fg(pal.textFaint)("status  ")), fg(rgba(meta.color))(`${meta.icon} ${meta.label}`), "\n",
            task.iteration ? st(dim(fg(pal.textFaint)("iter    ")), fg(pal.text)(String(task.iteration)), "\n") : "",
            dim(fg(pal.textFaint)("─".repeat(40))), "\n",
            fg(pal.textDim)(task.output || "No output recorded yet"),
          );
        }

        function footerContent(): any {
          const key = (k: string, d: string) => st(bold(fg(pal.textDim)(k)), dim(fg(pal.textFaint)(` ${d}  `)));
          return st(
            key("↑↓", "navigate"), key("tab", "switch pane"),
            key("enter", "inspect"), key("q", "quit"),
            narrow ? dim(fg(pal.textFaint)(" · narrow mode: panes stacked")) : "",
          );
        }

        function update() {
          listBox.borderColor = focus === "list" ? pal.brand : pal.border;
          detailBox.borderColor = focus === "detail" ? pal.brand : pal.border;
          header.content = headerContent();
          progressText.content = progressContent();
          statsText.content = statsContent();
          listContent.content = listContentStyled();
          detailContent.content = detailContentStyled();
          footer.content = footerContent();
          renderer.requestRender();
        }

        // -- Poll database ----------------------------------------------------
        async function poll() {
          try {
            const db = new Database(dbPath, { readonly: true });
            const taskMap = new Map<string, TaskInfo>();

            try {
              const rows = db.query(`SELECT node_id, status, summary FROM report WHERE run_id = ?`).all(runId) as any[];
              for (const row of rows) {
                const status: TaskStatus = row.status === "complete" ? "completed" :
                                          row.status === "blocked" ? "blocked" :
                                          row.status === "failed" ? "failed" : "running";
                taskMap.set(row.node_id, {
                  id: row.node_id, nodeId: row.node_id, status, iteration: 0, output: row.summary,
                });
              }
            } catch {}

            try {
              const rows = db.query(`SELECT node_id, merged, evicted, summary FROM land WHERE run_id = ?`).all(runId) as any[];
              for (const row of rows) {
                const status: TaskStatus = row.merged ? "completed" : row.evicted ? "failed" : "running";
                taskMap.set(row.node_id, {
                  id: row.node_id, nodeId: row.node_id, status, iteration: 0, output: row.summary,
                });
              }
            } catch {}

            db.close();

            tasks = Array.from(taskMap.values()).sort((a, b) => {
              const rank = (s: TaskStatus) => s === "running" ? 0 : s === "failed" ? 1 : s === "blocked" ? 2 : 3;
              return rank(a.status) - rank(b.status) || a.nodeId.localeCompare(b.nodeId);
            });

            if (selectedIndex >= tasks.length) selectedIndex = Math.max(0, tasks.length - 1);
          } catch {}
        }

        // -- Input --------------------------------------------------------------
        renderer.addInputHandler((seq: string) => {
          if (!isRunning) return false;

          if (seq === "q" || seq === "Q") {
            isRunning = false;
            renderer.destroy();
            return true;
          }

          if (seq === "\t") {
            focus = focus === "list" ? "detail" : "list";
            update();
            return true;
          }

          if (focus === "list") {
            switch (seq) {
              case "\x1b[A":
                selectedIndex = Math.max(0, selectedIndex - 1);
                update();
                return true;
              case "\x1b[B":
                selectedIndex = Math.min(tasks.length - 1, selectedIndex + 1);
                update();
                return true;
              case "\r":
              case "\n":
                focus = "detail";
                update();
                return true;
            }
          } else {
            switch (seq) {
              case "\x1b[A":
                detailScroll.scrollBy(-3, "step");
                return true;
              case "\x1b[B":
                detailScroll.scrollBy(3, "step");
                return true;
              case "\x1b":
                focus = "list";
                update();
                return true;
            }
          }
          return false;
        });

        await poll();
        update();
        renderer.start();

        while (isRunning) {
          await new Promise((r) => setTimeout(r, 2000));
          if (!isRunning) break;
          await poll();
          update();
        }

        return { started: true, status: "stopped" };
      }}
    </Task>
  );
}