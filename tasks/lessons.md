# Lessons

- Keep prompt payload changes deterministic and reversible: ship with an explicit optimization mode flag and diagnostics before changing defaults further.
- Keep trigger intent aligned with review depth:
  - automatic `pull_request` `opened` and `ready_for_review` should run `full` mode
  - automatic `pull_request` `synchronize` should remain `quick`
- Setup-required worker logs must be actionable and low-noise; include setup readiness fields and avoid repeating the same info-level message every poll.
- OpenAI model compatibility is not uniform across parameters; when using optional tuning params like `temperature`, implement a guarded fallback path for provider/model-specific unsupported-value errors.
- When fixing PR review feedback in bulk, run one deterministic sweep (code + tests + verification) before resolving threads; avoid resolving early and leaving follow-up reopen churn.
