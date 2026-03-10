import { describe, expect, it } from "vitest";

import { parseAppConfig } from "../../src/config/app-config.js";

describe("parseAppConfig", () => {
  it("parses valid environment variables", () => {
    const config = parseAppConfig({
      DATABASE_URL: "postgres://nitpickr:nitpickr@localhost:5432/nitpickr",
      OPENAI_API_KEY: "sk-test-key",
      GITHUB_APP_ID: "123456",
      GITHUB_PRIVATE_KEY:
        "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
      NITPICKR_WEBHOOK_URL: "https://nitpickr.example.com/webhooks/github",
    });

    expect(config.port).toBe(3000);
    expect(config.worker.concurrency).toBe(4);
    expect(config.github.appId).toBe(123456);
    expect(config.openAi.model).toBe("gpt-4.1");
    expect(config.github.apiBaseUrl).toBe("https://api.github.com");
    expect(config.openAi.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.github.botLogins).toEqual(["nitpickr", "getnitpickr"]);
  });

  it("parses custom provider base URLs", () => {
    const config = parseAppConfig({
      DATABASE_URL: "postgres://nitpickr:nitpickr@localhost:5432/nitpickr",
      OPENAI_API_KEY: "sk-test-key",
      OPENAI_BASE_URL: "http://openai-stub:4020/v1",
      GITHUB_APP_ID: "123456",
      GITHUB_API_BASE_URL: "http://github-stub:4010",
      GITHUB_BOT_LOGINS: "getnitpickr,nitpickr",
      GITHUB_PRIVATE_KEY:
        "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
      NITPICKR_WEBHOOK_URL: "https://nitpickr.example.com/webhooks/github",
    });

    expect(config.openAi.baseUrl).toBe("http://openai-stub:4020/v1");
    expect(config.github.apiBaseUrl).toBe("http://github-stub:4010");
    expect(config.github.botLogins).toEqual(["getnitpickr", "nitpickr"]);
  });

  it("rejects missing required variables", () => {
    expect(() =>
      parseAppConfig({
        DATABASE_URL: "postgres://nitpickr:nitpickr@localhost:5432/nitpickr",
      }),
    ).toThrow(/OPENAI_API_KEY/i);
  });

  it("rejects invalid numeric configuration", () => {
    expect(() =>
      parseAppConfig({
        DATABASE_URL: "postgres://nitpickr:nitpickr@localhost:5432/nitpickr",
        OPENAI_API_KEY: "sk-test-key",
        GITHUB_APP_ID: "123456",
        GITHUB_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
        GITHUB_WEBHOOK_SECRET: "webhook-secret",
        NITPICKR_WEBHOOK_URL: "https://nitpickr.example.com/webhooks/github",
        PORT: "bad",
      }),
    ).toThrow(/PORT/i);
  });
});
