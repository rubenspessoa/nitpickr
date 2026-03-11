# Lessons

- Keep trigger intent aligned with review depth:
  - automatic `pull_request` `opened` and `ready_for_review` should run `full` mode
  - automatic `pull_request` `synchronize` should remain `quick`
- Setup-required worker logs must be actionable and low-noise; include setup readiness fields and avoid repeating the same info-level message every poll.
- OpenAI model compatibility is not uniform across parameters; when using optional tuning params like `temperature`, implement a guarded fallback path for provider/model-specific unsupported-value errors.
