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

# PR Open Full Review + Worker Setup Logging

## Plan

- [x] Change automatic `pull_request` mode mapping so:
  - `opened` -> `full`
  - `ready_for_review` -> `full`
  - `synchronize` -> `quick`
- [x] Update webhook normalization tests to validate the new mode behavior.
- [x] Reduce setup-required worker log noise while improving diagnostic clarity.
- [x] Verify with typecheck, lint, and test suite.

## Results

- Updated PR event mode mapping in `src/providers/github/github-adapter.ts`.
- Updated mode assertions in:
  - `tests/providers/github-adapter.test.ts`
  - `tests/api/github-webhook-service.test.ts`
- Worker setup-required behavior in `src/worker/index.ts` now:
  - logs detailed setup state on change
  - uses debug for unchanged idle cycles
  - logs a resume message once setup completes
- Verification completed:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test` (50 files, 241 tests)

## Follow-up: OpenAI Temperature Compatibility

### Plan

- [x] Reproduce the failure path from logs and identify the source of `temperature: 0.1`.
- [x] Add model-request fallback that retries once without `temperature` for unsupported-temperature 400 responses.
- [x] Add regression tests for fallback behavior and request payloads.
- [x] Verify with typecheck, lint, and tests.

### Results

- Updated `src/review/openai-review-model.ts`:
  - first request keeps `temperature: 0.1`
  - if OpenAI returns a 400 unsupported-temperature error, retries once without `temperature`
  - preserves existing error behavior for other failures
- Updated `tests/review/openai-review-model.test.ts`:
  - validates temperature is sent on the first request
  - validates fallback retry omits temperature and succeeds
