import { z } from "zod";

import type {
  MemoryClassifier,
  MemoryClassifierResult,
  MemoryClassifierResultEntry,
  MemoryKind,
} from "./memory-service.js";

export interface OpenAiMemoryClassifierConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export type FetchLike = typeof fetch;

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

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

export class OpenAiMemoryClassifier implements MemoryClassifier {
  readonly #config: OpenAiMemoryClassifierConfig;
  readonly #fetch: FetchLike;

  constructor(
    config: OpenAiMemoryClassifierConfig,
    fetchFn: FetchLike = fetch,
  ) {
    this.#config = config;
    this.#fetch = fetchFn;
  }

  async extract(input: {
    body: string;
    authorLogin: string;
    path: string | null;
  }): Promise<MemoryClassifierResult> {
    const endpoint = `${normalizeBaseUrl(this.#config.baseUrl)}/chat/completions`;
    const userPayload = [
      `Author: ${input.authorLogin}`,
      input.path ? `Path: ${input.path}` : "Path: (general)",
      "Comment:",
      input.body,
    ].join("\n");

    const response = await this.#fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.#config.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPayload },
        ],
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `OpenAI memory classifier failed with status ${response.status}: ${details}`,
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
        };
      }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI memory classifier returned no content.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("OpenAI memory classifier returned invalid JSON.");
    }

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
