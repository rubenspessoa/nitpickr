# Local models via Ollama

nitpickr calls its model through the plain OpenAI-compatible HTTP API
(`/v1/chat/completions`, `/v1/embeddings`), so any server that speaks that
protocol works: Ollama, vLLM, LM Studio, llama.cpp server. This page covers
Ollama on the same machine (or LAN) as the nitpickr worker.

## What the worker needs from the model server

| Call | Endpoint | Used for | Requirements |
| --- | --- | --- | --- |
| Review | `POST /chat/completions` | Findings + summary per review chunk | `response_format: {type: "json_object"}` honoured; a chat model that returns valid JSON |
| Memory classifier | `POST /chat/completions` | Turning discussion into memory entries | Same as review; small prompts |
| Memory embedder | `POST /embeddings` | Semantic memory recall | A dedicated embedding model (Ollama cannot embed with a chat model). Optional: set `OPENAI_EMBEDDING_MODEL=off` to disable |

Only the **worker** talks to the model server; the API only enqueues jobs.

## Recommended settings

```dotenv
OPENAI_API_KEY=ollama                                  # required by nitpickr, ignored by Ollama
OPENAI_BASE_URL=http://host.docker.internal:11434/v1   # worker in Docker → host Ollama
# OPENAI_BASE_URL=http://localhost:11434/v1            # worker running natively
OPENAI_MODEL=qwen3.6:35b-a3b-nvfp4                     # any chat model with JSON output
OPENAI_REASONING_EFFORT=none                           # thinking models: none|low|medium|high
OPENAI_MEMORY_MODEL=qwen3.6:35b-a3b-nvfp4              # classifier; defaults to gpt-4o-mini
OPENAI_EMBEDDING_MODEL=nomic-embed-text                # or "off"
NITPICKR_EMBEDDING_DIMENSIONS=768                      # nomic-embed-text = 768
OPENAI_REQUEST_TIMEOUT_MS=1800000                      # 30 min; local prefill is slow
NITPICKR_MODEL_MAX_CONCURRENT_REQUESTS=1               # Ollama serves one request at a time
NITPICKR_REVIEW_CHUNK_MAX_TOTAL_CHARS=160000           # ≈40k tokens per chunk
NITPICKR_JOB_STALE_AFTER_MS=3600000                    # must exceed your slowest review
NITPICKR_WORKER_CONCURRENCY=1
```

Why each matters:

- **`OPENAI_REASONING_EFFORT`** — Ollama enables thinking by default on models
  that support it. `none` gives the fastest reviews; `high` costs 3–10× more
  output tokens. Compare with the eval below before choosing.
- **`OPENAI_REQUEST_TIMEOUT_MS`** and **`NITPICKR_JOB_STALE_AFTER_MS`** — the
  stale-job reclaim acts as a hard deadline; if a review takes longer than
  `NITPICKR_JOB_STALE_AFTER_MS` the job is re-queued while the first request is
  still running, doubling the load. Keep it above the request timeout.
- **`NITPICKR_MODEL_MAX_CONCURRENT_REQUESTS=1`** — nitpickr splits large PRs
  into chunks and reviews them in parallel by default. Against a single-request
  server that only adds queueing; run them sequentially.
- **`NITPICKR_REVIEW_CHUNK_MAX_TOTAL_CHARS`** — bounds prompt size (patch +
  full-file context) per chunk. Lower it for models with small context windows
  or slow prefill (e.g. 120000 ≈ 30k tokens).
- **Embeddings** — the `memories.embedding` column width is set from
  `NITPICKR_EMBEDDING_DIMENSIONS` at migrate time. Changing it re-shapes the
  column and clears stored vectors (memory falls back to keyword/recency
  ranking until re-embedded).

## Ollama-side settings

- Set `OLLAMA_MAX_LOADED_MODELS=2` when embeddings are on, so the embedding
  model can stay resident next to the chat model. With `1`, every embedding
  call evicts and reloads the chat model.
- Set `OLLAMA_KEEP_ALIVE=24h` (or `-1`) so the first review of the day does
  not pay a cold load.
- Keep `OLLAMA_NUM_PARALLEL=1` unless you have VRAM to spare, and mirror it
  with `NITPICKR_MODEL_MAX_CONCURRENT_REQUESTS`.
- Pull the embedding model once: `ollama pull nomic-embed-text` (~274 MB, 768
  dimensions). Verify: `curl localhost:11434/v1/embeddings -d '{"model":"nomic-embed-text","input":"x"}'`.
- Watch memory: model + KV cache at your `NITPICKR_REVIEW_CHUNK_MAX_TOTAL_CHARS`
  must fit; unified-memory Macs hard-crash when they exceed available RAM.

## Docker Compose notes

- The bundled `docker-compose.yml` uses `pgvector/pgvector:pg16` — the memory
  feature needs the `vector` extension.
- The worker service declares `extra_hosts: host.docker.internal:host-gateway`
  so `http://host.docker.internal:11434/v1` resolves on Linux too (Docker
  Desktop resolves it out of the box).

## Behaviour differences vs OpenAI

- Ollama's `/v1` responses omit `completion_tokens_details`; nitpickr only
  reads `prompt_tokens`/`completion_tokens`/`total_tokens`, so token logging
  still works.
- Smaller models occasionally wrap JSON in code fences or prose. The review
  client strips fences/`<think>` blocks and re-prompts once; if the reply is
  still not JSON the job fails as *retryable* so the queue tries again.
- Client timeouts (`OPENAI_REQUEST_TIMEOUT_MS`) also surface as retryable
  failures with a `neutral` check run.
- Node's default `fetch` gives up after ~300 s of waiting for response headers,
  and non-streaming model servers send none until generation is done. nitpickr
  routes model calls through an HTTP agent whose header/body timeouts follow
  `OPENAI_REQUEST_TIMEOUT_MS`, so slow local generations (5–20 min) work.

## Comparing local models: `pnpm eval:reviews --live`

The default `pnpm eval:reviews` replays canned model output and never calls a
model. Live mode runs real diffs through the review engine and scores published
findings against hand-annotated expectations:

```bash
# fixtures live in tests/fixtures/review-evals/live/*.json
OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_API_KEY=ollama \
  pnpm eval:reviews --live --model qwen3.6:35b-a3b-nvfp4 --reasoning-effort none \
  --out reports/qwen36-none.json

# other flags: --base-url, --fixtures <dir>, --filter <substring>, --timeout-ms
```

Scoring: a published finding matches an expectation when it is on the same
path within ±2 lines of the expected range (and the expected category, if
given). The report prints recall/precision per case, wall-clock, chunk count
and tokens, and the JSON contains every raw finding and summary so you can read
the actual review text.

Add cases from your own repositories:

```bash
GITHUB_TOKEN=$(gh auth token) pnpm cli eval:capture owner/repo#123
# then fill expectedFindings in tests/fixtures/review-evals/live/<name>.json
```

Run each model/effort combination sequentially (the server handles one
request at a time), and stop the previous model (`ollama stop <model>`) before
switching if two chat models would not fit in memory together.
