# Architecture Deep Dive

## Single Outer Ralph Loop

The original super-ralph had:

```tsx
<>
  <Ralph until={schedulerDone}> <TicketScheduler /> </Ralph>
  <Ralph until={executionDone}> <Parallel>{jobs}</Parallel> </Ralph>
  <Ralph until={mergeDone}> <AgenticMergeQueue /> </Ralph>
</>
```

Problem: Smithers runs Ralph loops sequentially. Scheduler loop runs to maxIterations before execution loop ever gets a turn. Jobs never run → allWorkComplete never true → RALPH_MAX_REACHED.

Fix (2026-09-21):

```tsx
<Ralph until={allWorkComplete} maxIterations={25} onMaxReached="fail">
  {activeCount < maxConcurrency && <TicketScheduler />}
  <Parallel>{activeJobs.map(job => <Job />)}</Parallel>
  <AgenticMergeQueue />
</Ralph>
```

Now each iteration does all three phases. Shared predicate converges.

## Workspace Provisioning

```
ensureWorkspace(requestedCwd, promptPath)
  ├─ jj --version exists? else error
  ├─ has .jj && .git? → return requestedCwd (already colocated)
  ├─ has .git && !.jj? → jj git init --colocate (adopt)
  └─ else → provision isolated ~/.corral/runs/<stamp>-<slug>-<uniq>
           ├─ jj git init --colocate
           ├─ write .corral-workspace marker
           ├─ jj commit -m 'corral: initial workspace commit'
           └─ jj bookmark create main -r @-
```

Why seed commit? Smithers does `git worktree add` trying main/origin/main/HEAD. Fresh jj init has none → WORKTREE_CREATE_FAILED.

## Merge Queue Speculative Window

```
pending queue ordered by strategy (report-complete-fifo | priority | ticket-order)
window = pending.slice(0, maxSpeculativeDepth)

1. fetchMain()
2. rebase each ticket in window onto main + previous tickets in window
   destination = main → ticket0 bookmark → ticket1 bookmark → ...
   If rebase fails → evict that ticket + downstream
3. postRebaseReviewAgent (optional LLM gate)
   - logs main..ticket, diff --stat, ticket..main changes
   - JSON {approved: true/false}
   - If rejected → evict, land prefix before failure
4. runCiInSpeculativeWorkspace() in parallel for window
   - mkdtemp + workspaceAdd at ticket bookmark
   - run postLandChecks (e.g., bun test)
   - workspace forget on cleanup
5. If all CI pass → fastForwardMain to furthest ticket, pushMain
6. Else evict failing ticket, re-test downstream
```

## Nim Proxy / Flock Routing

```
resolveProxyConfig()
  ├─ FLOCK_API_KEY (comma-separated) → key pool
  ├─ fallback NIM_PROXY_API_KEY (deprecated)
  └─ fallback ANTHROPIC_API_KEY / NVIDIA_API_KEY

proxyEnvOverrides(config)
  → { NIM_BASE_URL, ANTHROPIC_BASE_URL, NVIDIA_API_KEY, NIM_MODEL }
  injected into child process env only, never written to files

NimProxyKeyPool
  - rateLimitedUntil / isAvailable / recordRateLimit
  - 429/backoff handling across keys
```

## Shim Wrapper

Portable wrapper replaces hardcoded paths:

Old: source /home/toxic/.secrets
New: candidates = [CORRAL_SECRETS_PATH, ~/.secrets, ~/.config/corral/secrets, .env], first found wins, caller-provided env wins over file

Old: GATEHOUSE_BIN = "/home/toxic/estate/ranch/range/bin/gatehouse"
New: GATEHOUSE_BIN env var, default "gatehouse" in PATH

Old: NIM_SHIM_REAL = "/home/toxic/.local/bin/claude.nim-shim-real"
New: CLAUDE_REAL_BIN env var
