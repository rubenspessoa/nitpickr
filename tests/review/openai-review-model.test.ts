import { describe, expect, it } from "vitest";

import { OpenAiReviewModel } from "../../src/review/openai-review-model.js";

describe("OpenAiReviewModel", () => {
  it("calls the chat completions API and parses structured JSON", async () => {
    let requestedUrl = "";
    let requestedBody = "";
    const model = new OpenAiReviewModel(
      {
        apiKey: "sk-test",
        model: "gpt-4.1",
        baseUrl: "http://openai-stub:4020/v1",
      },
      async (input, init) => {
        requestedUrl = String(input);
        requestedBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "Queue fairness improved.",
                    mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
                    findings: [],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    );

    const result = await model.generateStructuredReview({
      system: "system prompt",
      user: "user prompt",
    });

    expect(requestedUrl).toBe("http://openai-stub:4020/v1/chat/completions");
    expect(requestedBody).toContain('"temperature":0.1');
    expect(result).toEqual({
      summary: "Queue fairness improved.",
      mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
      findings: [],
    });
  });

  it("normalizes custom base URLs without duplicating the version prefix", async () => {
    let requestedUrl = "";
    const model = new OpenAiReviewModel(
      {
        apiKey: "sk-test",
        model: "gpt-4.1",
        baseUrl: "http://openai-stub:4020/",
      },
      async (input) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "Queue fairness improved.",
                    mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
                    findings: [],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    );

    await model.generateStructuredReview({
      system: "system prompt",
      user: "user prompt",
    });

    expect(requestedUrl).toBe("http://openai-stub:4020/v1/chat/completions");
  });

  it("rejects non-successful OpenAI responses", async () => {
    const model = new OpenAiReviewModel(
      {
        apiKey: "sk-test",
        model: "gpt-4.1",
      },
      async () =>
        new Response(
          JSON.stringify({
            error: { message: "bad request" },
          }),
          {
            status: 400,
          },
        ),
    );

    await expect(() =>
      model.generateStructuredReview({
        system: "system prompt",
        user: "user prompt",
      }),
    ).rejects.toThrow(/OpenAI request failed/i);
  });

  it("rejects invalid JSON content from the model", async () => {
    const model = new OpenAiReviewModel(
      {
        apiKey: "sk-test",
        model: "gpt-4.1",
      },
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "not-json",
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );

    await expect(() =>
      model.generateStructuredReview({
        system: "system prompt",
        user: "user prompt",
      }),
    ).rejects.toThrow(/valid JSON/i);
  });

  it("retries without temperature for models that reject non-default temperature", async () => {
    const requestBodies: string[] = [];
    const model = new OpenAiReviewModel(
      {
        apiKey: "sk-test",
        model: "gpt-5",
      },
      async (_input, init) => {
        requestBodies.push(String(init?.body ?? ""));
        if (requestBodies.length === 1) {
          return new Response(
            JSON.stringify({
              error: {
                message:
                  "Unsupported value: 'temperature' does not support 0.1 with this model. Only the default (1) value is supported.",
                type: "invalid_request_error",
                param: "temperature",
                code: "unsupported_value",
              },
            }),
            { status: 400 },
          );
        }

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "Retry succeeded.",
                    mermaid: "flowchart TD\nA[Retry] --> B[Success]",
                    findings: [],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    );

    const result = await model.generateStructuredReview({
      system: "system prompt",
      user: "user prompt",
    });

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]).toContain('"temperature":0.1');
    expect(requestBodies[1]).not.toContain('"temperature":');
    expect(result).toEqual({
      summary: "Retry succeeded.",
      mermaid: "flowchart TD\nA[Retry] --> B[Success]",
      findings: [],
    });
  });
});
