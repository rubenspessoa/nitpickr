# Changelog

## Unreleased

- Local / OpenAI-compatible model servers (Ollama, vLLM, …): new
  `OPENAI_REASONING_EFFORT`, `OPENAI_MEMORY_MODEL`, `OPENAI_EMBEDDING_MODEL`
  (`off` disables embeddings), `NITPICKR_EMBEDDING_DIMENSIONS`,
  `OPENAI_REQUEST_TIMEOUT_MS`, `NITPICKR_MODEL_MAX_CONCURRENT_REQUESTS`, and
  `NITPICKR_REVIEW_CHUNK_MAX_TOTAL_CHARS`. Memory classifier/embedder models
  are no longer hardcoded. Model calls honour the configured timeout end to end
  (Node's default 300 s header timeout no longer applies), tolerate fenced /
  `<think>`-prefixed JSON with one automatic re-prompt, and malformed output or
  timeouts are retryable job failures. Review chunks are packed by total prompt
  size and can be dispatched sequentially. See `docs/local-models-ollama.md`.
- Migrations: the `memories.embedding` vector width follows
  `NITPICKR_EMBEDDING_DIMENSIONS`; changing it re-shapes the column (clearing
  stored vectors).
- Docker Compose: Postgres image switched to `pgvector/pgvector:pg16` (the
  `vector` extension was already required by migrations); `restart:
  unless-stopped`; worker gets `host.docker.internal` on Linux.
- Eval: `pnpm eval:reviews --live` runs fixtures against a real model and
  scores recall/precision, latency and tokens; `pnpm cli eval:capture
  owner/repo#N` snapshots a PR into a live fixture. Five planted-bug fixtures
  ship in `tests/fixtures/review-evals/live/`.
- `pnpm cli doctor` accepts PKCS#1 (`BEGIN RSA PRIVATE KEY`) GitHub App keys.

- Publisher diagnostics: canonical object truncation marker is standardized to
  lowercase `[truncated]`; a deprecated uppercase alias `[Truncated]` remains
  available for backward compatibility with consumers matching legacy literals.
