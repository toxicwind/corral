# Contributing to Corral

## Quick Start

```bash
bun install
bun test tests/
bun run typecheck
```

## Project Structure Rules

- **Never** put hardcoded `/home/...` paths — use `homedir()` + env vars
- **CLI**: Keep `src/cli/index.ts` thin (under 100 lines). Logic goes in `env.ts`, `workspace.ts`, `args.ts`, `runner.ts`
- **Merge Queue**: Keep `coordinator.ts` focused on coordination only. Types → `types.ts`, shell/jj ops → `ops.ts`, prompt building → `prompt.ts`
- **Tests**: All `*.test.ts` files live in `tests/`, not `src/`
- **Deps**: Use `smthrs` only, not `smithers-orchestrator` (old name)

## Commit Style

```
feat(cli): split 1189-line monolith into modules
fix(merge-queue): handle rebase conflicts in speculative window
docs(readme): add mermaid architecture diagram
```

Use conventional commits.

## Testing

```bash
bun test tests/ --watch
bun run typecheck --watch
```

## Architecture Decision

The single outer Ralph loop in `SuperRalph.tsx` is load-bearing. Do not revert to 3 sibling loops — it breaks convergence. See README.md Architecture section.

## Shim Changes

`bin/` shims must remain portable:
- No `/home/toxic` hardcoded
- Use `CORRAL_SECRETS_PATH`, `GATEHOUSE_BIN`, `CLAUDE_REAL_BIN` env vars
- Test on fresh VM with different $HOME
