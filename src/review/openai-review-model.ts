export interface OpenAiReviewModelConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export type FetchLike = typeof fetch;

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export class OpenAiReviewModel {
  readonly #config: OpenAiReviewModelConfig;
  readonly #fetch: FetchLike;

  constructor(config: OpenAiReviewModelConfig, fetchFn: FetchLike = fetch) {
    this.#config = config;
    this.#fetch = fetchFn;
  }

  async generateStructuredReview(input: {
    system: string;
    user: string;
  }): Promise<unknown> {
    const response = await this.#fetch(
      `${normalizeBaseUrl(this.#config.baseUrl)}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.#config.model,
          temperature: 0.1,
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
      },
    );

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `OpenAI request failed with status ${response.status}: ${details}`,
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
      throw new Error("OpenAI response did not contain a message payload.");
    }

    try {
      return JSON.parse(content);
    } catch {
      throw new Error("OpenAI response must contain valid JSON content.");
    }
  }
}
