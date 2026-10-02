import { z } from "zod";

import { type Logger, noopLogger } from "../logging/logger.js";
import {
  ChatCompletionClient,
  type ChatCompletionClientConfig,
} from "../shared/chat-completion-client.js";
import type { FetchLike } from "../shared/http-client.js";
import { extractJsonObject } from "../shared/model-output.js";
import type {
  MemoryClassifier,
  MemoryClassifierResult,
  MemoryClassifierResultEntry,
  MemoryKind,
} from "./memory-service.js";

const memoryKindSchema: z.ZodType<MemoryKind> = z.enum([
  "preferred_pattern",
  "false_positive",
  "accepted_recommendation",
  "coding_convention",
  "domain_fact",
  "dismissed_finding",
]);

const responseSchema = z.object({
  entries: z
    .array(
      z.object({
        kind: memoryKindSchema,
        summary: z.string().min(1),
        tags: z.array(z.string()).optional().default([]),
        globs: z.array(z.string()).optional().default([]),
        confidence: z.number().min(0).max(1),
        supersedesHint: z.string().optional(),
      }),
    )
    .default([]),
  acknowledgment: z.string().min(1),
});

const SYSTEM_PROMPT = [
  "You extract durable repo-level knowledge from a single discussion comment left on a code review.",
  "Return strict JSON with two keys: `entries` (array, possibly empty) and `acknowledgment` (one-line natural-language confirmation).",
  "Each entry must have: kind, summary, tags, globs, confidence, optional supersedesHint.",
  "kind ∈ preferred_pattern | false_positive | accepted_recommendation | coding_convention | domain_fact | dismissed_finding.",
  "Only emit an entry when the comment expresses a durable preference, convention, fact, dismissal, or acknowledgment that would help future reviews. One-off corrections in the diff are NOT memories.",
  "summary: one sentence, declarative, codebase-agnostic phrasing (e.g. 'This repo prefers zod for runtime input validation').",
  "tags: short kebab-case labels (e.g. language:typescript, framework:nextjs, area:auth). Empty if unsure.",
  "globs: file globs the memory applies to (e.g. ['src/api/**']). Empty for repo-wide.",
  "confidence: 0–1, how sure you are this is a durable rule.",
  "supersedesHint: short text matching an older memory this replaces (optional).",
  "acknowledgment: one sentence, human-friendly, what the bot saved or why it didn't.",
].join("\n");

export class ChatMemoryClassifier implements MemoryClassifier {
  readonly #client: ChatCompletionClient;
  readonly #logger: Logger;

  constructor(config: ChatCompletionClientConfig, fetchFn?: FetchLike) {
    this.#logger = (config.logger ?? noopLogger).child({
      component: "chat-memory-classifier",
      model: config.model,
    });
    this.#client = new ChatCompletionClient(
      { ...config, logger: this.#logger },
      fetchFn,
    );
  }

  async extract(input: {
    body: string;
    authorLogin: string;
    path: string | null;
  }): Promise<MemoryClassifierResult> {
    const userPayload = [
      `Author: ${input.authorLogin}`,
      input.path ? `Path: ${input.path}` : "Path: (general)",
      "Comment:",
      input.body,
    ].join("\n");

    const startedAt = process.hrtime.bigint();
    this.#logger.debug("memory_classifier.extract started", {});
    const { content, usage } = await this.#client.complete({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPayload },
      ],
    });
    const durationMs = Number(
      (process.hrtime.bigint() - startedAt) / 1_000_000n,
    );

    const extracted = extractJsonObject(content);
    if (!extracted.ok) {
      this.#logger.error("memory_classifier.extract invalid_json", {
        durationMs,
        reason: extracted.reason,
      });
      throw new Error("Memory classifier returned invalid JSON.");
    }
    const parsed: unknown = extracted.value;

    this.#logger.info("memory_classifier.extract succeeded", {
      durationMs,
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      totalTokens: usage?.total_tokens,
    });

    const validated = responseSchema.parse(parsed);
    const entries: MemoryClassifierResultEntry[] = validated.entries.map(
      (entry) => {
        const result: MemoryClassifierResultEntry = {
          kind: entry.kind,
          summary: entry.summary,
          tags: entry.tags,
          globs: entry.globs,
          confidence: entry.confidence,
        };
        if (entry.supersedesHint !== undefined) {
          result.supersedesHint = entry.supersedesHint;
        }
        return result;
      },
    );
    return {
      entries,
      acknowledgment: validated.acknowledgment,
    };
  }
}
