import { type Logger, noopLogger } from "../logging/logger.js";
import type { EmbeddingPurpose, MemoryEmbedder } from "./memory-service.js";

/**
 * Embeds memory text in-process with transformers.js (ONNX Runtime on CPU),
 * so recall never competes with the review model for the model server's
 * memory. A ~150 MB quantized model embeds a short memory in ~15 ms.
 */
export interface LocalMemoryEmbedderConfig {
  /** Hugging Face model id, e.g. `nomic-ai/nomic-embed-text-v1.5`. */
  model: string;
  /** Expected vector width; must match the `memories.embedding` column. */
  expectedDimensions: number;
  /** Where model files are cached; the Docker image bakes them in here. */
  cacheDir?: string | null;
  logger?: Logger;
}

/** Turns text into one pooled, normalized vector. */
export type EmbeddingPipeline = (text: string) => Promise<number[]>;
export type EmbeddingPipelineLoader = (
  config: LocalMemoryEmbedderConfig,
) => Promise<EmbeddingPipeline>;

/** nomic-embed-text is trained with task prefixes; other models get none. */
function taskPrefix(model: string, purpose: EmbeddingPurpose): string {
  if (!/nomic-embed-text/i.test(model)) {
    return "";
  }
  return purpose === "query" ? "search_query: " : "search_document: ";
}

export const loadTransformersPipeline: EmbeddingPipelineLoader = async (
  config,
) => {
  // Imported lazily: the API process and most tests never embed, and loading
  // ONNX Runtime up front would cost them startup time and memory.
  const { env, pipeline } = await import("@huggingface/transformers");
  if (config.cacheDir) {
    env.cacheDir = config.cacheDir;
  }
  const extractor = await pipeline("feature-extraction", config.model, {
    dtype: "q8",
  });
  return async (text) => {
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
  };
};

export class LocalMemoryEmbedder implements MemoryEmbedder {
  readonly #config: LocalMemoryEmbedderConfig;
  readonly #loadPipeline: EmbeddingPipelineLoader;
  readonly #logger: Logger;
  #pipeline: Promise<EmbeddingPipeline> | null = null;

  constructor(
    config: LocalMemoryEmbedderConfig,
    loadPipeline: EmbeddingPipelineLoader = loadTransformersPipeline,
  ) {
    this.#config = config;
    this.#loadPipeline = loadPipeline;
    this.#logger = (config.logger ?? noopLogger).child({
      component: "local-memory-embedder",
      model: config.model,
    });
  }

  async embed(
    text: string,
    purpose: EmbeddingPurpose = "document",
  ): Promise<number[]> {
    const run = await this.#getPipeline();
    const startedAt = process.hrtime.bigint();
    const embedding = await run(
      `${taskPrefix(this.#config.model, purpose)}${text}`,
    );
    const durationMs = Number(
      (process.hrtime.bigint() - startedAt) / 1_000_000n,
    );
    if (embedding.length !== this.#config.expectedDimensions) {
      this.#logger.error("memory_embedder.embed dimension_mismatch", {
        durationMs,
        dimensions: embedding.length,
        expectedDimensions: this.#config.expectedDimensions,
      });
      throw new Error(
        `Embedding model returned ${embedding.length} dimensions but NITPICKR_EMBEDDING_DIMENSIONS is ${this.#config.expectedDimensions}.`,
      );
    }
    this.#logger.info("memory_embedder.embed succeeded", {
      durationMs,
      dimensions: embedding.length,
      purpose,
    });
    return embedding;
  }

  #getPipeline(): Promise<EmbeddingPipeline> {
    if (!this.#pipeline) {
      const startedAt = process.hrtime.bigint();
      this.#pipeline = this.#loadPipeline(this.#config).then(
        (loaded) => {
          this.#logger.info("memory_embedder.model_loaded", {
            durationMs: Number(
              (process.hrtime.bigint() - startedAt) / 1_000_000n,
            ),
          });
          return loaded;
        },
        (error: unknown) => {
          // Let the next call retry instead of caching the failure forever.
          this.#pipeline = null;
          this.#logger.error("memory_embedder.model_load_failed", {
            errorMessage:
              error instanceof Error ? error.message : String(error),
          });
          throw error;
        },
      );
    }
    return this.#pipeline;
  }
}
