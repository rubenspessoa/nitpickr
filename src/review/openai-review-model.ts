import { type Logger, noopLogger } from "../logging/logger.js";
import { normalizeOpenAiBaseUrl } from "../shared/openai-base-url.js";

export interface OpenAiReviewModelConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  logger?: Logger;
}

export type FetchLike = typeof fetch;

function shouldRetryWithoutTemperature(
  status: number,
  details: string,
): boolean {
  if (status !== 400) {
    return false;
  }

  const normalized = details.toLowerCase();
  return (
    normalized.includes("temperature") &&
    normalized.includes("unsupported") &&
    normalized.includes("default")
  );
}

interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

function usageFields(usage: OpenAiUsage | undefined): Record<string, unknown> {
  if (!usage) {
    return {};
  }
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

export class OpenAiReviewModel {
  readonly #config: OpenAiReviewModelConfig;
  readonly #fetch: FetchLike;
  readonly #logger: Logger;

  constructor(config: OpenAiReviewModelConfig, fetchFn: FetchLike = fetch) {
    this.#config = config;
    this.#fetch = fetchFn;
    this.#logger = (config.logger ?? noopLogger).child({
      component: "openai-review-model",
      model: config.model,
    });
  }

  async generateStructuredReview(input: {
    system: string;
    user: string;
  }): Promise<unknown> {
    const endpoint = `${normalizeOpenAiBaseUrl(this.#config.baseUrl)}/chat/completions`;
    const sendRequest = (includeTemperature: boolean) =>
      this.#fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.#config.model,
          ...(includeTemperature ? { temperature: 0.1 } : {}),
          response_format: {
            type: "json_object",
          },
          messages: [
            {
              role: "system",
              content: input.system,
            },
            {
              role: "user",
              content: input.user,
            },
          ],
        }),
      });

    const startedAt = process.hrtime.bigint();
    this.#logger.debug("openai.chat_completion started", {});
    let response: Response;
    try {
      response = await sendRequest(true);
      if (!response.ok) {
        const details = await response.text();
        if (!shouldRetryWithoutTemperature(response.status, details)) {
          this.#logger.error("openai.chat_completion failed", {
            status: response.status,
            durationMs: Number(
              (process.hrtime.bigint() - startedAt) / 1_000_000n,
            ),
            errorBody: details.slice(0, 500),
          });
          throw new Error(
            `OpenAI request failed with status ${response.status}: ${details}`,
          );
        }

        this.#logger.info(
          "openai.chat_completion retrying without temperature",
          {
            status: response.status,
          },
        );
        response = await sendRequest(false);
        if (!response.ok) {
          const retryDetails = await response.text();
          this.#logger.error(
            "openai.chat_completion failed (retry-without-temperature)",
            {
              status: response.status,
              durationMs: Number(
                (process.hrtime.bigint() - startedAt) / 1_000_000n,
              ),
              errorBody: retryDetails.slice(0, 500),
            },
          );
          throw new Error(
            `OpenAI request failed with status ${response.status}: ${retryDetails}`,
          );
        }
      }
    } catch (error) {
      // Network/transport errors that never produced a Response.
      if (
        !(error instanceof Error) ||
        !/OpenAI request failed/.test(error.message)
      ) {
        this.#logger.error("openai.chat_completion transport_error", {
          durationMs: Number(
            (process.hrtime.bigint() - startedAt) / 1_000_000n,
          ),
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
        };
      }>;
      usage?: OpenAiUsage;
    };

    const durationMs = Number(
      (process.hrtime.bigint() - startedAt) / 1_000_000n,
    );

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      this.#logger.error("openai.chat_completion empty_response", {
        durationMs,
      });
      throw new Error("OpenAI response did not contain a message payload.");
    }

    this.#logger.info("openai.chat_completion succeeded", {
      durationMs,
      ...usageFields(payload.usage),
    });

    try {
      return JSON.parse(content);
    } catch {
      this.#logger.error("openai.chat_completion invalid_json", { durationMs });
      throw new Error("OpenAI response must contain valid JSON content.");
    }
  }
}
