import { type Logger, noopLogger } from "../logging/logger.js";
import {
  ChatCompletionClient,
  type ChatCompletionClientConfig,
  type ChatMessage,
  type ChatUsage,
  type ResponseJsonSchema,
} from "../shared/chat-completion-client.js";
import type { FetchLike } from "../shared/http-client.js";
import { extractJsonObject, ModelOutputError } from "../shared/model-output.js";

export interface ChatReviewModelConfig extends ChatCompletionClientConfig {
  /** Observability hook: called once per successful completion. */
  onCompletion?: (info: ModelCompletionInfo) => void;
}

export interface ModelCompletionInfo {
  durationMs: number;
  promptTokens: number | undefined;
  completionTokens: number | undefined;
  totalTokens: number | undefined;
  attempts: number;
}

const JSON_REPAIR_NUDGE =
  "Your previous reply was not a single valid JSON object. Reply again with only the JSON object described above — no prose, no code fences.";

function usageFields(usage: ChatUsage | undefined): Record<string, unknown> {
  if (!usage) {
    return {};
  }
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

export class ChatReviewModel {
  readonly #config: ChatReviewModelConfig;
  readonly #client: ChatCompletionClient;
  readonly #logger: Logger;

  constructor(config: ChatReviewModelConfig, fetchFn?: FetchLike) {
    this.#config = config;
    this.#logger = (config.logger ?? noopLogger).child({
      component: "chat-review-model",
      model: config.model,
    });
    this.#client = new ChatCompletionClient(
      { ...config, logger: this.#logger },
      fetchFn,
    );
  }

  async generateStructuredReview(input: {
    system: string;
    user: string;
    jsonSchema?: ResponseJsonSchema | null;
  }): Promise<unknown> {
    const startedAt = process.hrtime.bigint();
    const elapsedMs = () =>
      Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
    const messages: ChatMessage[] = [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ];
    const complete = (conversation: ChatMessage[]) =>
      this.#client.complete({
        messages: conversation,
        temperature: 0.1,
        jsonSchema: input.jsonSchema ?? null,
      });

    const first = await complete(messages);
    const firstJson = extractJsonObject(first.content);
    if (firstJson.ok) {
      this.#reportSuccess(first.usage, elapsedMs(), 1);
      return firstJson.value;
    }

    // Local models occasionally wrap JSON in prose or fences even in JSON
    // mode. Nudge once with the bad reply in context before giving up.
    this.#logger.warn("model.chat_completion invalid_json retrying", {
      durationMs: elapsedMs(),
      reason: firstJson.reason,
    });
    const second = await complete([
      ...messages,
      { role: "assistant", content: first.content },
      { role: "user", content: JSON_REPAIR_NUDGE },
    ]);
    const secondJson = extractJsonObject(second.content);
    if (secondJson.ok) {
      this.#reportSuccess(second.usage, elapsedMs(), 2);
      return secondJson.value;
    }

    this.#logger.error("model.chat_completion invalid_json", {
      durationMs: elapsedMs(),
      reason: secondJson.reason,
    });
    throw new ModelOutputError(
      "Model response must contain valid JSON content.",
    );
  }

  #reportSuccess(
    usage: ChatUsage | undefined,
    durationMs: number,
    attempts: number,
  ): void {
    this.#logger.info("model.chat_completion succeeded", {
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
}
