import type { ReasoningEffort } from "../config/app-config.js";
import { type Logger, noopLogger } from "../logging/logger.js";
import { createTimeoutFetch, isTimeoutError } from "../shared/http-client.js";
import { extractJsonObject, ModelOutputError } from "../shared/model-output.js";
import { normalizeOpenAiBaseUrl } from "../shared/openai-base-url.js";

export interface OpenAiReviewModelConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  logger?: Logger;
  /** Sent as `reasoning_effort` when set (OpenAI reasoning models, Ollama thinking models). */
  reasoningEffort?: ReasoningEffort | null;
  /** Abort the request after this many milliseconds. Unset = no client timeout. */
  timeoutMs?: number;
  /** Observability hook: called once per successful completion. */
  onCompletion?: (info: OpenAiCompletionInfo) => void;
}

export interface OpenAiCompletionInfo {
  durationMs: number;
  promptTokens: number | undefined;
  completionTokens: number | undefined;
  totalTokens: number | undefined;
  attempts: number;
}

export type FetchLike = typeof fetch;

const JSON_REPAIR_NUDGE =
  "Your previous reply was not a single valid JSON object. Reply again with only the JSON object described above — no prose, no code fences.";

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

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class OpenAiReviewModel {
  readonly #config: OpenAiReviewModelConfig;
  readonly #fetch: FetchLike;
  readonly #logger: Logger;

  constructor(config: OpenAiReviewModelConfig, fetchFn?: FetchLike) {
    this.#config = config;
    // Default transport honours the configured timeout end-to-end (see
    // createTimeoutFetch for why plain fetch caps out at ~300 s).
    this.#fetch =
      fetchFn ??
      (config.timeoutMs ? createTimeoutFetch(config.timeoutMs) : fetch);
    this.#logger = (config.logger ?? noopLogger).child({
      component: "openai-review-model",
      model: config.model,
    });
  }

  async generateStructuredReview(input: {
    system: string;
    user: string;
  }): Promise<unknown> {
    const startedAt = process.hrtime.bigint();
    const elapsedMs = () =>
      Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
    const messages: ChatMessage[] = [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ];

    const first = await this.#complete(messages, elapsedMs);
    const firstJson = extractJsonObject(first.content);
    if (firstJson.ok) {
      this.#reportSuccess(first.usage, elapsedMs(), 1);
      return firstJson.value;
    }

    // Local / smaller models occasionally wrap JSON in prose or fences even in
    // json_object mode. Nudge once with the bad reply in context before giving up.
    this.#logger.warn("openai.chat_completion invalid_json retrying", {
      durationMs: elapsedMs(),
      reason: firstJson.reason,
    });
    const second = await this.#complete(
      [
        ...messages,
        { role: "assistant", content: first.content },
        { role: "user", content: JSON_REPAIR_NUDGE },
      ],
      elapsedMs,
    );
    const secondJson = extractJsonObject(second.content);
    if (secondJson.ok) {
      this.#reportSuccess(second.usage, elapsedMs(), 2);
      return secondJson.value;
    }

    this.#logger.error("openai.chat_completion invalid_json", {
      durationMs: elapsedMs(),
      reason: secondJson.reason,
    });
    throw new ModelOutputError(
      "OpenAI response must contain valid JSON content.",
    );
  }

  #reportSuccess(
    usage: OpenAiUsage | undefined,
    durationMs: number,
    attempts: number,
  ): void {
    this.#logger.info("openai.chat_completion succeeded", {
      durationMs,
      attempts,
      ...usageFields(usage),
    });
    this.#config.onCompletion?.({
      durationMs,
      attempts,
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      totalTokens: usage?.total_tokens,
    });
  }

  async #complete(
    messages: ChatMessage[],
    elapsedMs: () => number,
  ): Promise<{ content: string; usage: OpenAiUsage | undefined }> {
    const endpoint = `${normalizeOpenAiBaseUrl(this.#config.baseUrl)}/chat/completions`;
    const sendRequest = (includeTemperature: boolean) =>
      this.#fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#config.apiKey}`,
          "content-type": "application/json",
        },
        ...(this.#config.timeoutMs
          ? { signal: AbortSignal.timeout(this.#config.timeoutMs) }
          : {}),
        body: JSON.stringify({
          model: this.#config.model,
          ...(includeTemperature ? { temperature: 0.1 } : {}),
          ...(this.#config.reasoningEffort
            ? { reasoning_effort: this.#config.reasoningEffort }
            : {}),
          response_format: {
            type: "json_object",
          },
          messages,
        }),
      });

    this.#logger.debug("openai.chat_completion started", {});
    let response: Response;
    try {
      response = await sendRequest(true);
      if (!response.ok) {
        const details = await response.text();
        if (!shouldRetryWithoutTemperature(response.status, details)) {
          this.#logger.error("openai.chat_completion failed", {
            status: response.status,
            durationMs: elapsedMs(),
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
              durationMs: elapsedMs(),
              errorBody: retryDetails.slice(0, 500),
            },
          );
          throw new Error(
            `OpenAI request failed with status ${response.status}: ${retryDetails}`,
          );
        }
      }
    } catch (error) {
      // Network/transport errors (incl. timeouts) that never produced a Response.
      if (
        !(error instanceof Error) ||
        !/OpenAI request failed/.test(error.message)
      ) {
        this.#logger.error("openai.chat_completion transport_error", {
          durationMs: elapsedMs(),
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        if (isTimeoutError(error)) {
          throw new ModelOutputError(
            `OpenAI request timed out after ${this.#config.timeoutMs}ms.`,
          );
        }
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

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      this.#logger.error("openai.chat_completion empty_response", {
        durationMs: elapsedMs(),
      });
      throw new ModelOutputError(
        "OpenAI response did not contain a message payload.",
      );
    }

    return { content, usage: payload.usage };
  }
}
