/**
 * Corral CLI styling — zero-dependency ANSI output with the design-token
 * palette from ./tokens. NO_COLOR and dumb-terminal aware; width-aware for
 * wrapping; degrades to plain text when piped.
 *
 * Usage:
 *   import { banner, ok, err, warn, info, kv, progressBar, rule } from "../ui/cli-style";
 */

import { colors, type ColorToken } from "./tokens";

// ---------------------------------------------------------------------------
// Capability detection (computed once)
// ---------------------------------------------------------------------------

const isTTY = Boolean(process.stdout.isTTY);
const noColor =
  process.env.NO_COLOR !== undefined ||
  process.env.TERM === "dumb" ||
  !isTTY;

export const styleEnabled = !noColor;

/** Terminal width, clamped to something sane. */
export function termWidth(): number {
  const w = process.stdout.columns ?? 80;
  return Math.max(40, Math.min(120, w));
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Wrap text in a 256-color foreground + optional bold. */
export function paint(text: string, color: ColorToken, bold = false): string {
  if (!styleEnabled) return text;
  const b = bold ? "\x1b[1m" : "";
  return `${b}\x1b[38;5;${color.ansi256}m${text}\x1b[0m`;
}

/** Bold without color. */
export function strong(text: string): string {
  return styleEnabled ? `\x1b[1m${text}\x1b[0m` : text;
}

/** Dimmed secondary text. */
export function dim(text: string): string {
  return paint(text, colors.textFaint);
}

/** A horizontal rule that fits the terminal. */
export function rule(char = "─"): string {
  return dim(char.repeat(termWidth()));
}

// ---------------------------------------------------------------------------
// Semantic lines
// ---------------------------------------------------------------------------

export const ok   = (msg: string) => console.log(`${paint("✓", colors.success, true)} ${msg}`);
export const err  = (msg: string) => console.error(`${paint("✕", colors.error, true)} ${paint(msg, colors.error)}`);
export const warn = (msg: string) => console.warn(`${paint("▲", colors.warning, true)} ${paint(msg, colors.warning)}`);
export const info = (msg: string) => console.log(`${paint("●", colors.info, true)} ${msg}`);
export const muted = (msg: string) => console.log(dim(msg));

// ---------------------------------------------------------------------------
// Banner — corral brand block at CLI startup
// ---------------------------------------------------------------------------

const LOGO = [
  " ██████╗ ██████╗ ██████╗ ██████╗  █████╗ ██╗     ",
  "██╔════╝██╔═══██╗██╔══██╗██╔══██╗██╔══██╗██║     ",
  "██║     ██║   ██║██████╔╝██████╔╝███████║██║     ",
  "██║     ██║   ██║██╔══██╗██╔══██╗██╔══██║██║     ",
  "╚██████╗╚██████╔╝██║  ██║██║  ██║██║  ██║███████╗",
  " ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝",
];

export function banner(subtitle?: string): void {
  for (const line of LOGO) console.log(paint(line, colors.brand, true));
  if (subtitle) console.log(`  ${dim(subtitle)}`);
  console.log("");
}

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

export function h1(text: string): void {
  console.log(`\n${paint(text, colors.brand, true)}`);
  console.log(paint("─".repeat(Math.min(text.length, termWidth())), colors.brandDim));
}

export function h2(text: string): void {
  console.log(`\n${strong(text)}`);
}

// ---------------------------------------------------------------------------
// Key/value table — aligned, dim keys, wrapped values
// ---------------------------------------------------------------------------

export function kv(rows: Array<[string, string]>, indent = 2): void {
  const width = termWidth();
  const keyW = Math.max(...rows.map(([k]) => k.length));
  const pad = " ".repeat(indent);
  for (const [k, v] of rows) {
    const key = dim(k.padEnd(keyW));
    const maxV = Math.max(20, width - indent - keyW - 3);
    const value = v.length > maxV ? v.slice(0, maxV - 1) + "…" : v;
    console.log(`${pad}${key}  ${value}`);
  }
}

// ---------------------------------------------------------------------------
// Progress bar — block characters, no animation frames, TTY-width aware
// ---------------------------------------------------------------------------

export function progressBar(frac: number, opts: { label?: string; color?: ColorToken } = {}): string {
  const f = Math.max(0, Math.min(1, frac));
  const width = termWidth();
  const label = opts.label ?? "";
  const pct = `${Math.round(f * 100)}%`.padStart(4);
  const barW = Math.max(10, width - label.length - pct.length - 6);
  const filled = Math.round(f * barW);
  const bar = "█".repeat(filled) + "░".repeat(barW - filled);
  const colored = styleEnabled ? paint(bar, opts.color ?? colors.brand, true) : bar;
  return `${label} [${colored}] ${pct}`;
}

// ---------------------------------------------------------------------------
// Step line — "● 3/8  Implement auth" with status coloring
// ---------------------------------------------------------------------------

export function stepLine(index: number, total: number, name: string, status: "running" | "done" | "todo"): void {
  const n = `${index}/${total}`.padStart(String(total).length * 2 + 1);
  if (status === "done") console.log(`  ${paint("✓", colors.success)} ${dim(n)} ${name}`);
  else if (status === "running") console.log(`  ${paint("◐", colors.info, true)} ${dim(n)} ${strong(name)}`);
  else console.log(`  ${paint("○", colors.pending)} ${dim(n)} ${dim(name)}`);
}

// ---------------------------------------------------------------------------
// Summary box — bordered completion block
// ---------------------------------------------------------------------------

export function summaryBox(title: string, rows: Array<[string, string]>, tone: "success" | "error" | "info" = "info"): void {
  const toneColor = tone === "success" ? colors.success : tone === "error" ? colors.error : colors.info;
  const width = termWidth();
  const top = paint("┌" + "─".repeat(width - 2) + "┐", toneColor);
  const bot = paint("└" + "─".repeat(width - 2) + "┘", toneColor);
  console.log(top);
  console.log(paint("│", toneColor) + " " + strong(title.padEnd(width - 4)) + paint("│", toneColor));
  for (const [k, v] of rows) {
    const line = `  ${k}: ${v}`;
    console.log(paint("│", toneColor) + " " + line.padEnd(width - 4).slice(0, width - 4) + paint("│", toneColor));
  }
  console.log(bot);
}