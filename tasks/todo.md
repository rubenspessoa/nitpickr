# Prompt Token Optimization v1

## Plan

- [x] Add prompt payload optimizer stage with deterministic compaction budgets.
- [x] Wire optimization mode and review scope through config -> runtime -> worker -> review engine.
- [x] Extend review diagnostics with prompt usage before/after compaction and worker logs.
- [x] Add and update unit/integration tests for optimizer, config parsing, worker input wiring, and diagnostics.
- [x] Run lint, typecheck, and tests; document results.

## Results

- Added `PromptPayloadOptimizer` with:
  - scope budgets for `commit_delta` and `full_pr`
  - deterministic primary patch truncation with omission markers
  - context metadata-only compaction and deterministic ordering
  - instruction and per-chunk memory compaction
  - prompt usage estimation utilities
- `ReviewEngine` now:
  - accepts `scope` and `optimizationMode`
  - defaults chunk size to `16000`
  - compacts payloads before prompt build
  - returns diagnostics with prompt usage before/after compaction
- Bootstrap config now supports:
  - `NITPICKR_PROMPT_OPTIMIZATION_MODE=off|balanced` (default `balanced`)
- Worker pipeline now:
  - passes `scope` and `optimizationMode` explicitly to review engine input
  - logs prompt usage metrics before and after compaction
- Added and updated tests:
  - `tests/review/prompt-payload-optimizer.test.ts`
  - `tests/review/review-engine.test.ts`
  - `tests/config/app-config.test.ts`
  - `tests/worker/worker-runner.test.ts`
- Verification:
  - `pnpm typecheck` passed
  - `pnpm lint` passed
  - `pnpm test` passed (`51` files, `247` tests)
  - `pnpm eval:reviews` passed (`Fixtures: 1`, `Precision: 1.00`)
