# Kilo compaction broken: same-model small_model + never-persisted epochs

## Goal
Make kilo auto-compaction reliable on this box. Today no compaction has ever
completed (see Evidence). Summarisation is configured to run the SAME model as
the main agent, which stalls in a re-invocation loop and never lands a
`session_context_epoch` row or a `time_compacting` stamp.

## Evidence (from ~/.local/share/kilo/kilo.db, read-only)
- 32 sessions, 5808 messages, 3510 text parts, 5253 tool parts, 2026 reasoning
  parts, 29 compaction parts.
- `session_context_epoch` table is 0 rows and no session.row
  `time_compacting` is set => compaction never completed+persisted.
- DoorBell sessions (`ses_eb9cfb`, `ses_eb9cfd`, `ses_eba508`) carry 5 IDENTICAL
  `auto:false` compaction parts with the SAME ms timestamp => a tight
  re-invocation loop that never finishes.
- `ses_eb97525` has two back-to-back `auto:true overflow:true` parts.
- Config `~/.config/kilo/kilo.jsonc` (wins over `kilo.json` per names order
  `config.json,kilo.json,kilo.jsonc,...`): `model` AND `small_model` are both
  `freeinference/glm-5.3-flash` (identical). `kilo.json` mirrors it with
  `cuttinggate/glm-5.3-flash` on both. kilo docs: `small_model` is
  "Model for titles/summaries". So summary generation resolves to the main
  model: the breakage.
- Log: `kilocode.compaction.chunks chunks=354 concurrency=3 fallback` then
  ERROR `share sync failed`; repeated `fallback` chunk mode.

## Desired end state
1. `small_model` is DISTINCT from `model` in the effective config and points to
   a fast, working summarizer reachable from the running kilo (`freeinference`
   or `hodos`/`openrouter`; local `beellama/exaone-4-0-1-2b-*` family is
   benchmarked at ~27ms p50, quality 2, healthy=1 by the 2026-10-02 roundup
   weights in `estate-router-ts/roundup-weights.json`).
2. After a compaction, `session_context_epoch` gains a row and the session's
   `time_compacting` is stamped.
3. No repeat-instance compaction loops: one compaction part per real overflow.

## Tasks (each machine-verifiable)
- T1 Confirm winning config for the running `kilo serve`/TUI (cwd /home/toxic):
  assert `small_model != model` in `~/.config/kilo/kilo.jsonc` and
  `~/.config/kilo/kilo.json`.
- T2 Pick a fast distinct small_model from the roundup benchmark set; note it in
  the config change.
- T3 Edit both configs so `small_model` differs from `model`.
- T4 Validate the estate plugins in `/home/toxic/estate/.kilo/plugin/`
  (hodos-strategy / gatehouse / herd-models / autofixer) still register under the
  running kilo without errors.
- T5 Run one forced compaction on a scratch session; assert a
  `session_context_epoch` row appears and `time_compacting` is set.
- T6 Confirm hodos `/v1/chat/completions` answers (bonus: route session-data
  dataframe analysis through it).

## Scope / constraints
- Live box, additive only. Do not disable peers/daemons. Do not touch
  `awrawr-mcp.service`. No secrets in config commits; use `{env:...}`.
- Config change must survive restart and be committed to the owning repo
  (durability): keep the small_model choice in the config files themselves.