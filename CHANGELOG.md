# Changelog

## 1.0.0 - Clean Refactor (2026-10-05)

### Breaking / Clean
- Removed duplicate dep `smithers-orchestrator@0.32.0`, keep only `smthrs@0.35.0`
- Single bin `corral` instead of 6 aliases (`ralph`, `taskforge`, `super-ralph`, `hyper`, `hyper-ralph`)
- Removed ranch-specific `scripts/*` (guard-single-instance, mise-build, etc.)
- All `src/*.test.ts` moved to `tests/`

### Fixed
- **CLI**: Split 1189-line `src/cli/index.ts` into 5 modules (`env.ts`, `workspace.ts`, `args.ts`, `runner.ts`, `index.ts`)
- **Merge Queue**: Split 851-line `coordinator.ts` into `types.ts`, `ops.ts`, `prompt.ts`, `coordinator.ts`, `index.ts`
- **Portability**: Removed all hardcoded `/home/toxic` paths from `bin/` shims — now env-var driven
- **Preload**: Cleaned Effect compat shims, removed ranch comments
- **Workspace**: Safe isolated provisioning under `~/.corral/runs` instead of nuking `$HOME`
- **Architecture**: Preserved 2026-09-21 single outer Ralph loop fix (3 sibling loops → 1 loop)

### Added
- `.gitignore`, `LICENSE`, `CONTRIBUTING.md`, `.editorconfig`
- `.github/workflows/ci.yml` with hardcoded path check + CLI thin check
- `docs/ARCHITECTURE.md` with mermaid + sequence details
- Maximal GitHub README with badges, comparison table, shim arch diagram
- Portable shim env vars: `CORRAL_SECRETS_PATH`, `GATEHOUSE_BIN`, `GATEHOUSE_CONFIG`, `CLAUDE_REAL_BIN`

### Original lineage
- `super-ralph@0.2.5` (William Cory / roninjin10) → `@estate/corral@1.0.0`
