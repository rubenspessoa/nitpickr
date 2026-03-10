import { describe, expect, it } from "vitest";

import { OpenAiReviewModel } from "../../src/review/openai-review-model.js";

describe("OpenAiReviewModel", () => {
  it("calls the chat completions API and parses structured JSON", async () => {
    let requestedUrl = "";
    const model = new OpenAiReviewModel(
      {
        apiKey: "sk-test",
        model: "gpt-4.1",
        baseUrl: "http://openai-stub:4020/v1",
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

    const result = await model.generateStructuredReview({
      system: "system prompt",
      user: "user prompt",
    });

    expect(requestedUrl).toBe("http://openai-stub:4020/v1/chat/completions");
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
});
