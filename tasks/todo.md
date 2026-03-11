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
