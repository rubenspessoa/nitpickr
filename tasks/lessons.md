# Lessons

- Keep prompt payload changes deterministic and reversible: ship with an explicit optimization mode flag and diagnostics before changing defaults further.
- Keep trigger intent aligned with review depth:
  - automatic `pull_request` `opened` and `ready_for_review` should run `full` mode
  - automatic `pull_request` `synchronize` should remain `quick`
- Setup-required worker logs must be actionable and low-noise; include setup readiness fields and avoid repeating the same info-level message every poll.
- OpenAI model compatibility is not uniform across parameters; when using optional tuning params like `temperature`, implement a guarded fallback path for provider/model-specific unsupported-value errors.
- When fixing PR review feedback in bulk, run one deterministic sweep (code + tests + verification) before resolving threads; avoid resolving early and leaving follow-up reopen churn.
- In shared library code, prefer compatibility-safe string normalization (`replace(/.../g, ...)`) over newer helpers when runtime constraints may vary between local, CI, and deployment targets.
- External provider validation should not take down the full review lifecycle; for known non-critical publish validation failures, degrade gracefully (summary-only) and keep the run completing.
- For truncation helpers, verify edge-case invariants explicitly (e.g., "truncate head" must preserve tail when markers consume budget) to avoid silent semantic inversions.
- Provider errors can come as `Error`, plain strings, or plain objects; fallback logic should inspect structured payloads, not only message substrings.
- Avoid permissive numeric parsing (`parseInt` alone) in reliability paths; enforce full-format validation first to prevent false-positive status handling.
- For parser hardening, prefer linear state-machine extraction over repeated candidate parse loops with ad-hoc caps; this improves both performance and determinism.
- In fallback-critical scanners, wrap parse invocations defensively and add tests for braces inside JSON string values to avoid aborting on malformed candidates or miscounting delimiters.
- In parser helpers, prefer explicit null checks over truthiness checks even when current return types are object-only; this keeps behavior safe against future refactors.
- Security and operability must both be preserved in diagnostics: log sanitized/truncated error context, not raw untrusted payload messages.
- If a helper affects reliability and diagnostics, keep it module-level and test it directly; this reduces churn in behavior-driven tests and speeds review iterations.
- Diagnostic serializers must treat `BigInt`, cycles, and huge objects as first-class inputs: bound traversal, cap serialized size, and prefer named policy constants over inline magic numbers.
