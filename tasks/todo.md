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

# PR #3 Review Thread Sweep

## Plan

- [x] Triage all open PR review threads and separate code fixes from reply-only clarifications.
- [x] Implement config, optimizer, and test hardening updates from accepted findings.
- [x] Re-run lint, typecheck, and test suite before resolving threads.
- [x] Resolve addressed GitHub review threads and reply to remaining open questions.

## Results

- Updated `src/config/app-config.ts`:
  - introduced `PromptOptimizationMode` type derived from Zod schema
  - reused the derived type in bootstrap/app config interfaces
  - documented why `balanced` remains the default mode
- Updated `src/review/prompt-payload-optimizer.ts`:
  - stabilized minimum omission marker sizing so truncation logic does not grow with full input length
  - unified text truncation marker formatting through `buildOmissionMarker`
  - clarified truncation marker initialization heuristic in patch truncation
  - normalized path separators for chunk-memory relevance matching
- Updated tests:
  - `tests/config/app-config.test.ts` now explicitly covers default `balanced` and explicit `balanced` value
  - `tests/review/prompt-payload-optimizer.test.ts` now avoids brittle path indexing, verifies context compaction structure, adds Windows-path memory relevance coverage, and relaxes over-tight numeric expectations
  - `tests/worker/worker-runner.test.ts` now uses shape-safe scope/mode assertions and non-identical before/after prompt usage fixtures
- Follow-up after next nitpickr pass:
  - stabilized omission-marker reference with a named constant
  - restored newline-prefixed omission marker in `truncateTextHead`
  - replaced `replaceAll` path normalization with regex-based replacement for broader runtime compatibility
- Verification completed:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test` (`51` files, `252` tests)

# Publish 422 Resilience (Path/Line Resolution)

## Plan

- [x] Confirm the failing class from logs and identify the publish-path failure point.
- [x] Add publisher fallback behavior for GitHub 422 inline-comment resolution failures.
- [x] Add regression tests for fallback behavior and non-fallback error handling.
- [x] Run lint, typecheck, and tests; document verification.

## Results

- Updated `src/publisher/review-publisher.ts`:
  - added targeted detection for GitHub 422 errors that indicate unresolved review comment `path`/`line`
  - added one retry path that republishes the same review body without inline comments when that specific error happens
  - kept existing behavior for all non-target errors (they still fail fast)
- Updated `tests/publisher/review-publisher.test.ts`:
  - added regression test covering fallback to summary-only publish after a 422 path/line resolution rejection
  - added regression test ensuring unrelated 422 validation errors are not swallowed
- Verification completed:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test tests/publisher/review-publisher.test.ts`
  - `pnpm test` (`51` files, `254` tests)

# PR #3 Follow-up Thread Sweep

## Plan

- [x] Re-triage new unresolved nitpickr threads after the latest push.
- [x] Fix omission-marker and truncation edge-case correctness issues.
- [x] Harden 422 fallback error-shape parsing and add non-Error payload test coverage.
- [x] Re-run lint, typecheck, and full test suite.
- [x] Resolve all addressed PR threads.

## Results

- Updated `src/review/prompt-payload-optimizer.ts`:
  - minimum omission budget now includes the newline-prefixed marker shape
  - `truncateTextHead` now preserves trailing content when marker alone would exceed the target budget
  - path comparison now uses Node path utilities for normalization before matching memory scope
- Updated `src/publisher/review-publisher.ts`:
  - replaced brittle single-string checks with structured error inspection
  - supports `Error`, string, and plain-object payloads
  - parses JSON payload fragments from error messages even when trailing text follows the JSON object
  - requires purely numeric status strings before interpreting them as HTTP status codes
  - switched to a linear brace-aware JSON object scanner to avoid bounded reverse-scan misses and unbounded parse loops
  - added defensive `safeTryParseObject` calls in the scan loop so unexpected parser exceptions do not abort fallback detection
  - tightened direct/candidate return checks to explicit `!== null` semantics
  - removed redundant scanner undefined-character guard for clarity
  - restored sanitized/truncated parse diagnostics (`errorMessage`, capped to 200 chars) without logging raw payload content
  - extracted sanitizer to module scope as `sanitizeDiagnosticErrorMessage` for reuse and focused testing
- Updated `tests/publisher/review-publisher.test.ts`:
  - added regression test for non-Error `{ status: "422", errors: [...] }` throw shape to ensure fallback still triggers
  - added regression test covering non-JSON brace content before a valid JSON payload in the same error string
  - added regression test for braces inside JSON string values so string-content braces are not treated as structural boundaries
  - added focused sanitizer tests for `Error`, object input, non-ASCII filtering, truncation, and fallback behavior
- Verification completed:
  - `pnpm test tests/review/prompt-payload-optimizer.test.ts tests/publisher/review-publisher.test.ts`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test` (`51` files, `255` tests)

# PR #3 Follow-up Thread Sweep (Round 2)

## Plan

- [x] Re-triage newly opened sanitizer-focused PR threads.
- [x] Harden diagnostic serialization for bounded object payloads and `BigInt` values.
- [x] Add/extend sanitizer-focused regression tests.
- [x] Re-run lint, typecheck, and targeted publisher tests.
- [x] Resolve addressed PR threads.

## Results

- Updated `src/publisher/review-publisher.ts`:
  - introduced named constants for diagnostic serialization/truncation budgets
  - hardened object serialization with bounded traversal and serialized-length capping
  - added explicit `BigInt` support in the JSON replacer to avoid stringify throws
  - simplified replacer flow with early primitive returns and consolidated object handling
  - kept parse-error deduplication sentinel function-scoped during scanner execution
- Updated `tests/publisher/review-publisher.test.ts`:
  - added circular-object sanitizer coverage
  - added `BigInt` serialization regression coverage
- Follow-up after next nitpickr pass:
  - ensured sanitizer preserves truncation sentinels when trimming to 200 chars
  - added regression tests for serialized-length truncation marker preservation
  - added regression tests for object-budget truncation marker preservation
  - exported sanitizer truncation constants for canonical reuse across tests/callers
  - switched truncation assertions to import constants instead of hard-coded literals
  - extracted diagnostic constants into `src/publisher/diagnostic-constants.ts`
  - updated publisher and tests to import constants from the dedicated diagnostics module
  - moved `DIAGNOSTIC_MAX_SERIALIZED_LENGTH`, `DIAGNOSTIC_MAX_STRING_LENGTH`, and `DIAGNOSTIC_OBJECT_BUDGET` into the same diagnostics constants module
  - added a diagnostics constants header comment documenting units/relationships
  - unified truncation casing to lowercase marker format (`[truncated]`)
  - added deprecated uppercase marker alias for backward compatibility (`DIAGNOSTIC_OBJECT_TRUNCATION_MARKER_DEPRECATED`)
  - documented casing-change impact as a breaking change that needs release-note visibility
  - added marker-variant detection export to cover canonical + deprecated object truncation literals
  - added `CHANGELOG.md` with an Unreleased note about marker casing and the deprecated alias
  - clarified changelog wording to foreground backward compatibility
  - exported a marker `Set` companion for compatibility-friendly membership checks
  - kept sanitizer marker iteration on the ordered variants array for readability and deterministic ordering
  - added sanitizer regression coverage for canonical + deprecated truncation marker variants
  - cleaned up lessons wording typo flagged during PR review
- Verification completed:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test tests/publisher/review-publisher.test.ts`
