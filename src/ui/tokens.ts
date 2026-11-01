/**
 * Corral design tokens — the single source of truth for every user-facing
 * surface: HTML run reports, CLI ANSI output, and the OpenTUI Monitor.
 *
 * Dark-first palette (WCAG AA on dark backgrounds), semantic status colors,
 * spacing/typography scales, and the three output encodings the surfaces need:
 *   - hex     → CSS variables for the HTML report
 *   - rgb     → OpenTUI RGBA tuples in Monitor.tsx
 *   - ansi    → 256-color ANSI codes for cli-style.ts
 *
 * Zero dependencies. No framework. Tokens win.
 */

// ---------------------------------------------------------------------------
// Color: each token carries hex (CSS), rgb tuple (OpenTUI), ansi256 (terminal)
// ---------------------------------------------------------------------------

export interface ColorToken {
  hex: string;
  rgb: [number, number, number];
  ansi256: number;
}

const c = (hex: string, rgb: [number, number, number], ansi256: number): ColorToken => ({ hex, rgb, ansi256 });

export const colors = {
  // Brand
  brand:      c("#7c6cf0", [124, 108, 240], 99),   // corral violet — primary accent
  brandDim:   c("#4a4188", [74, 65, 136], 60),
  brandSoft:  c("#2a2547", [42, 37, 71], 237),     // tinted surface

  // Surfaces (dark-first)
  bg:         c("#0d0e14", [13, 14, 20], 232),
  bgRaised:   c("#15161f", [21, 22, 31], 233),
  bgCard:     c("#1a1b26", [26, 27, 38], 234),
  bgHover:    c("#22232f", [34, 35, 47], 235),
  border:     c("#2e2f3d", [46, 47, 61], 236),
  borderSoft: c("#23242f", [35, 36, 47], 235),

  // Text
  text:       c("#e8e9f1", [232, 233, 241], 255),
  textDim:    c("#a7a9bd", [167, 169, 189], 249),
  textFaint:  c("#6b6d82", [107, 109, 130], 242),

  // Status — semantic, colorblind-tolerant (Okabe-Ito inspired hues)
  success:    c("#3ddc97", [61, 220, 151], 78),
  warning:    c("#f5b841", [245, 184, 65], 214),
  error:      c("#ff5d5d", [255, 93, 93], 203),
  info:       c("#5eb1ff", [94, 177, 255], 75),
  pending:    c("#8b8fa3", [139, 143, 163], 245),
  blocked:    c("#c792ea", [199, 146, 234], 177),
  skipped:    c("#5a5c70", [90, 92, 112], 240),

  // Light-mode companions (used by the report's [data-theme="light"])
  light: {
    bg:       c("#f7f7fb", [247, 247, 251], 255),
    bgRaised: c("#ffffff", [255, 255, 255], 231),
    bgCard:   c("#ffffff", [255, 255, 255], 231),
    border:   c("#e2e3ec", [226, 227, 236], 254),
    borderSoft: c("#eaebf2", [234, 235, 242], 254),
    text:     c("#16171f", [22, 23, 31], 232),
    textDim:  c("#4c4e63", [76, 78, 99], 239),
  },
} as const;

// ---------------------------------------------------------------------------
// Status semantics — one map drives report pills, TUI chips, CLI lines
// ---------------------------------------------------------------------------

export type RunStatus =
  | "success" | "failed" | "running" | "pending"
  | "blocked" | "skipped" | "cancelled" | "unknown";

export interface StatusMeta {
  label: string;
  icon: string;              // single glyph, terminal + web safe
  color: ColorToken;
}

export const statusMeta: Record<RunStatus, StatusMeta> = {
  success:   { label: "Success",   icon: "●", color: colors.success },
  failed:    { label: "Failed",    icon: "●", color: colors.error },
  running:   { label: "Running",   icon: "◐", color: colors.info },
  pending:   { label: "Pending",   icon: "○", color: colors.pending },
  blocked:   { label: "Blocked",   icon: "◈", color: colors.blocked },
  skipped:   { label: "Skipped",   icon: "–", color: colors.skipped },
  cancelled: { label: "Cancelled", icon: "✕", color: colors.warning },
  unknown:   { label: "Unknown",   icon: "?", color: colors.textFaint },
};

/** Normalize engine/DB status strings into our semantic set. */
export function toRunStatus(raw: string | null | undefined): RunStatus {
  const s = (raw ?? "").toLowerCase();
  if (["success", "succeeded", "completed", "done", "ok", "pass", "passed"].includes(s)) return "success";
  if (["failed", "failure", "error", "errored"].includes(s)) return "failed";
  if (["running", "in_progress", "in-progress", "active", "started"].includes(s)) return "running";
  if (["pending", "queued", "waiting", "todo"].includes(s)) return "pending";
  if (["blocked", "stuck"].includes(s)) return "blocked";
  if (["skipped", "skip"].includes(s)) return "skipped";
  if (["cancelled", "canceled", "aborted", "interrupted"].includes(s)) return "cancelled";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export const fonts = {
  sans: `-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif`,
  mono: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`,
} as const;

export const typeScale = {
  xs:   "0.75rem",   // 12px
  sm:   "0.875rem",  // 14px
  base: "1rem",      // 16px
  lg:   "1.25rem",   // 20px
  xl:   "1.5rem",    // 24px
  xxl:  "2rem",      // 32px
} as const;

// ---------------------------------------------------------------------------
// Spacing & shape
// ---------------------------------------------------------------------------

export const space = {
  xs: "0.25rem",   // 4px
  sm: "0.5rem",    // 8px
  md: "1rem",      // 16px
  lg: "1.5rem",    // 24px
  xl: "2rem",      // 32px
  xxl: "3rem",     // 48px
} as const;

export const radius = {
  sm: "6px",
  md: "10px",
  lg: "16px",
  pill: "999px",
} as const;

// ---------------------------------------------------------------------------
// Breakpoints (report HTML)
// ---------------------------------------------------------------------------

export const breakpoints = {
  mobile: 640,    // px — single column, stacked
  tablet: 1024,   // px — two column
  desktop: 1440,  // px — full grid, max-width container
} as const;

/** Report content max width — readable line length, no full-bleed walls. */
export const contentMaxWidth = "72rem"; // 1152px

// ---------------------------------------------------------------------------
// CSS variable emission — tokens → :root block for the report stylesheet
// ---------------------------------------------------------------------------

export function cssVariables(theme: "dark" | "light" = "dark"): string {
  const t = theme === "dark" ? colors : null;
  const bg = theme === "dark" ? colors.bg : colors.light.bg;
  const raised = theme === "dark" ? colors.bgRaised : colors.light.bgRaised;
  const card = theme === "dark" ? colors.bgCard : colors.light.bgCard;
  const border = theme === "dark" ? colors.border : colors.light.border;
  const borderSoft = theme === "dark" ? colors.borderSoft : colors.light.borderSoft;
  const text = theme === "dark" ? colors.text : colors.light.text;
  const textDim = theme === "dark" ? colors.textDim : colors.light.textDim;
  void t;
  return [
    `--bg:${bg.hex};`,
    `--bg-raised:${raised.hex};`,
    `--bg-card:${card.hex};`,
    `--bg-hover:${colors.bgHover.hex};`,
    `--border:${border.hex};`,
    `--border-soft:${borderSoft.hex};`,
    `--text:${text.hex};`,
    `--text-dim:${textDim.hex};`,
    `--text-faint:${colors.textFaint.hex};`,
    `--brand:${colors.brand.hex};`,
    `--brand-dim:${colors.brandDim.hex};`,
    `--brand-soft:${colors.brandSoft.hex};`,
    `--success:${colors.success.hex};`,
    `--warning:${colors.warning.hex};`,
    `--error:${colors.error.hex};`,
    `--info:${colors.info.hex};`,
    `--pending:${colors.pending.hex};`,
    `--blocked:${colors.blocked.hex};`,
    `--font-sans:${fonts.sans};`,
    `--font-mono:${fonts.mono};`,
  ].join("");
}