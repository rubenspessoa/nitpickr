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
    const endpoint = `${normalizeBaseUrl(this.#config.baseUrl)}/chat/completions`;
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

    let response = await sendRequest(true);
    if (!response.ok) {
      const details = await response.text();
      if (!shouldRetryWithoutTemperature(response.status, details)) {
        throw new Error(
          `OpenAI request failed with status ${response.status}: ${details}`,
        );
      }

      response = await sendRequest(false);
      if (!response.ok) {
        const retryDetails = await response.text();
        throw new Error(
          `OpenAI request failed with status ${response.status}: ${retryDetails}`,
        );
      }
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
