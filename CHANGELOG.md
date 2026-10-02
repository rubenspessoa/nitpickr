# Changelog

## Unreleased

- **Breaking: local models only.** nitpickr now talks exclusively to a local
  model server (Ollama, llama-server, LM Studio, vLLM) over
  `/v1/chat/completions`; OpenAI defaults (`gpt-5-mini`, `api.openai.com`,
  `text-embedding-3-small`), branding and pricing guidance are removed.
  Renamed environment variables:
  - `OPENAI_BASE_URL` → `NITPICKR_MODEL_BASE_URL` (default
    `http://localhost:11434/v1`)
  - `OPENAI_API_KEY` → `NITPICKR_MODEL_API_KEY` (optional; no auth header when
    unset)
  - `OPENAI_MODEL` → `NITPICKR_REVIEW_MODEL` (required, no default)
  - `OPENAI_MEMORY_MODEL` → `NITPICKR_MEMORY_MODEL` (defaults to the review
    model)
  - `OPENAI_REASONING_EFFORT` → `NITPICKR_MODEL_REASONING_EFFORT`
  - `OPENAI_REQUEST_TIMEOUT_MS` → `NITPICKR_MODEL_REQUEST_TIMEOUT_MS`
  - `OPENAI_EMBEDDING_MODEL` → `NITPICKR_EMBEDDING_MODEL`

  A `.env` that still sets `OPENAI_*` without `NITPICKR_REVIEW_MODEL` fails at
  boot naming the new vars; once `NITPICKR_REVIEW_MODEL` is set, a stray
  `OPENAI_API_KEY` is ignored.
- Memory embeddings run in-process in the worker via transformers.js (ONNX on
  CPU). Default model `nomic-ai/nomic-embed-text-v1.5` (q8, 768 dims, nomic
  `search_document`/`search_query` prefixes), baked into the Docker image at
  build (`ARG NITPICKR_EMBEDDING_MODEL`, cache at `/app/models` via
  `NITPICKR_EMBEDDING_CACHE_DIR`). `NITPICKR_EMBEDDING_DIMENSIONS` now defaults
  to 768; `off` still disables embeddings. The model server no longer needs an
  embedding model, so Ollama can run with `OLLAMA_MAX_LOADED_MODELS=1`.
  Measured: ~15 ms/embed, ~5 s cold load, ~420 MB RSS, ~146 MB model.
- Review chunks and the memory classifier request strict JSON Schema structured
  output (`response_format: json_schema`, `strict`); lenient JSON extraction
  and one repair re-prompt remain as fallback. The OpenAI-only "retry without
  temperature" path is gone.
- Logs: `openai.chat_completion.*` → `model.chat_completion.*`; components
  `chat-review-model`, `chat-memory-classifier`, `local-memory-embedder`.
  Failure class `openai_model_output` → `model_output`.
- `NITPICKR_REPOSITORY_ALLOWLIST` is now enforced (case-insensitive
  `owner/name`): webhooks from other repositories get `202` + ignored before
  any mention reaction or queueing, and workers complete stale queued jobs for
  them without processing.
- Retries back off exponentially (30 s base, doubling per attempt, capped at
  15 min); workers only claim jobs whose `scheduled_at` has passed.
- Toolchain: Node 24 LTS (Docker, CI, `engines`, `mise.toml`), pnpm 10.34.6;
  zod 4, vitest 5, biome 2, Sentry 11 (`sendDefaultPii`/`enableLogs` options
  dropped; defaults cover them), undici 8. Docker Compose `api`/`worker` now
  preload Sentry via `--import`.

_The `OPENAI_*` variable names in the entries below were introduced earlier in
this same unreleased cycle and are superseded by the renames above._

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
