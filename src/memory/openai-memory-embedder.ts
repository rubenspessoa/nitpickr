import { type Logger, noopLogger } from "../logging/logger.js";
import { normalizeOpenAiBaseUrl } from "../shared/openai-base-url.js";
import type { MemoryEmbedder } from "./memory-service.js";

export interface OpenAiMemoryEmbedderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  logger?: Logger;
}

export type FetchLike = typeof fetch;

export class OpenAiMemoryEmbedder implements MemoryEmbedder {
  readonly #config: OpenAiMemoryEmbedderConfig;
  readonly #fetch: FetchLike;
  readonly #logger: Logger;

  constructor(config: OpenAiMemoryEmbedderConfig, fetchFn: FetchLike = fetch) {
    this.#config = config;
    this.#fetch = fetchFn;
    this.#logger = (config.logger ?? noopLogger).child({
      component: "openai-memory-embedder",
      model: config.model,
    });
  }

  async embed(text: string): Promise<number[]> {
    const endpoint = `${normalizeOpenAiBaseUrl(this.#config.baseUrl)}/embeddings`;
    const startedAt = process.hrtime.bigint();
    this.#logger.debug("memory_embedder.embed started", {
      textLength: text.length,
    });
    let response: Response;
    try {
      response = await this.#fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.#config.model,
          input: text,
        }),
      });
    } catch (error) {
      this.#logger.error("memory_embedder.embed transport_error", {
        durationMs: Number((process.hrtime.bigint() - startedAt) / 1_000_000n),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    if (!response.ok) {
      const details = await response.text();
      this.#logger.error("memory_embedder.embed failed", {
        status: response.status,
        durationMs: Number((process.hrtime.bigint() - startedAt) / 1_000_000n),
        errorBody: details.slice(0, 500),
      });
      throw new Error(
        `OpenAI embeddings request failed with status ${response.status}: ${details}`,
      );
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
      usage?: {
        prompt_tokens?: number;
        total_tokens?: number;
      };
    };
    const embedding = payload.data?.[0]?.embedding;
    const durationMs = Number(
      (process.hrtime.bigint() - startedAt) / 1_000_000n,
    );
    if (!Array.isArray(embedding) || embedding.length === 0) {
      this.#logger.error("memory_embedder.embed empty_vector", { durationMs });
      throw new Error("OpenAI embeddings response did not contain a vector.");
    }
    this.#logger.info("memory_embedder.embed succeeded", {
      durationMs,
      dimensions: embedding.length,
      promptTokens: payload.usage?.prompt_tokens,
      totalTokens: payload.usage?.total_tokens,
    });
    return embedding;
  }
}
