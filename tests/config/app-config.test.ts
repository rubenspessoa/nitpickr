import { describe, expect, it } from "vitest";

import {
  buildAppConfig,
  parseAppConfig,
  parseBootstrapConfig,
  parseRuntimeSecretsFromEnvironment,
} from "../../src/config/app-config.js";

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
    expect(config.review.promptOptimizationMode).toBe("balanced");
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

describe("parseBootstrapConfig", () => {
  it("uses a non-empty default bot login list when unset", () => {
    const config = parseBootstrapConfig({
      DATABASE_URL: "postgres://nitpickr:nitpickr@localhost:5432/nitpickr",
    });

    expect(config.github.botLogins).toEqual(["nitpickr", "getnitpickr"]);
  });

  it("parses Railway-style bootstrap settings", () => {
    const config = parseBootstrapConfig({
      DATABASE_URL: "postgres://nitpickr:nitpickr@localhost:5432/nitpickr",
      NITPICKR_BASE_URL: "https://nitpickr.up.railway.app",
      NITPICKR_SECRET_KEY: "super-secret-key",
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/a/b",
      NITPICKR_REPOSITORY_ALLOWLIST: "rubenspessoa/nitpickr,rubenspessoa/demo",
      NITPICKR_PROMPT_OPTIMIZATION_MODE: "off",
    });

    expect(config.baseUrl).toBe("https://nitpickr.up.railway.app");
    expect(config.discordWebhookUrl).toBe(
      "https://discord.com/api/webhooks/a/b",
    );
    expect(config.repositoryAllowlist).toEqual([
      "rubenspessoa/nitpickr",
      "rubenspessoa/demo",
    ]);
    expect(config.review.promptOptimizationMode).toBe("off");
  });

  it("derives a base URL from the legacy webhook URL", () => {
    const config = parseBootstrapConfig({
      DATABASE_URL: "postgres://nitpickr:nitpickr@localhost:5432/nitpickr",
      NITPICKR_WEBHOOK_URL: "https://nitpickr.example.com/webhooks/github",
    });

    expect(config.baseUrl).toBe("https://nitpickr.example.com");
  });

  it("rejects invalid prompt optimization mode values", () => {
    expect(() =>
      parseBootstrapConfig({
        DATABASE_URL: "postgres://nitpickr:nitpickr@localhost:5432/nitpickr",
        NITPICKR_PROMPT_OPTIMIZATION_MODE: "aggressive",
      }),
    ).toThrow(/NITPICKR_PROMPT_OPTIMIZATION_MODE/i);
  });
});

describe("parseRuntimeSecretsFromEnvironment", () => {
  it("returns null when runtime secrets are incomplete", () => {
    expect(
      parseRuntimeSecretsFromEnvironment({
        OPENAI_API_KEY: "sk-test-key",
        GITHUB_APP_ID: "123456",
      }),
    ).toBeNull();
  });

  it("parses and normalizes runtime bot logins", () => {
    expect(
      parseRuntimeSecretsFromEnvironment({
        OPENAI_API_KEY: "sk-test-key",
        GITHUB_APP_ID: "123456",
        GITHUB_BOT_LOGINS: "GetNitpickr, nitpickr",
        GITHUB_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
        GITHUB_WEBHOOK_SECRET: "webhook-secret",
      }),
    ).toMatchObject({
      githubBotLogins: ["getnitpickr", "nitpickr"],
    });
  });

  it("rejects bot login values that normalize to an empty list", () => {
    expect(() =>
      parseRuntimeSecretsFromEnvironment({
        OPENAI_API_KEY: "sk-test-key",
        GITHUB_APP_ID: "123456",
        GITHUB_BOT_LOGINS: " , ",
        GITHUB_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
        GITHUB_WEBHOOK_SECRET: "webhook-secret",
      }),
    ).toThrow(/GITHUB_BOT_LOGINS/i);
  });
});

describe("buildAppConfig", () => {
  it("combines bootstrap config and stored runtime secrets", () => {
    const config = buildAppConfig(
      parseBootstrapConfig({
        DATABASE_URL: "postgres://nitpickr:nitpickr@localhost:5432/nitpickr",
        NITPICKR_BASE_URL: "https://nitpickr.up.railway.app",
        NITPICKR_SECRET_KEY: "super-secret-key",
        NITPICKR_WORKER_HEARTBEAT_INTERVAL_MS: "3000",
      }),
      {
        openAiApiKey: "sk-test-key",
        openAiModel: "gpt-4.1",
        githubAppId: 123456,
        githubPrivateKey:
          "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
        githubWebhookSecret: "webhook-secret",
        githubBotLogins: ["getnitpickr"],
      },
    );

    expect(config.github.webhookUrl).toBe(
      "https://nitpickr.up.railway.app/webhooks/github",
    );
    expect(config.runtimeSecretSource).toBe("persisted_store");
    expect(config.worker.heartbeatIntervalMs).toBe(3000);
  });
});
