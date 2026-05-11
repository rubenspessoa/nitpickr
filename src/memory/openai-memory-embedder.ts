import type { MemoryEmbedder } from "./memory-service.js";

export interface OpenAiMemoryEmbedderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export type FetchLike = typeof fetch;

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export class OpenAiMemoryEmbedder implements MemoryEmbedder {
  readonly #config: OpenAiMemoryEmbedderConfig;
  readonly #fetch: FetchLike;

  constructor(config: OpenAiMemoryEmbedderConfig, fetchFn: FetchLike = fetch) {
    this.#config = config;
    this.#fetch = fetchFn;
  }

  async embed(text: string): Promise<number[]> {
    const endpoint = `${normalizeBaseUrl(this.#config.baseUrl)}/embeddings`;
    const response = await this.#fetch(endpoint, {
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

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `OpenAI embeddings request failed with status ${response.status}: ${details}`,
      );
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = payload.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("OpenAI embeddings response did not contain a vector.");
    }
    return embedding;
  }
}
