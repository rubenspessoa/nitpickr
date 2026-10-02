import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createPostgresClientMock,
  githubAdapterConstructorMock,
  githubRestClientConstructorMock,
  chatReviewModelConstructorMock,
} = vi.hoisted(() => ({
  createPostgresClientMock: vi.fn(() => ({
    unsafe: vi.fn(async () => []),
    end: vi.fn(),
  })),
  githubAdapterConstructorMock: vi.fn(),
  githubRestClientConstructorMock: vi.fn(),
  chatReviewModelConstructorMock: vi.fn(),
}));

vi.mock("../../src/runtime/postgres.js", () => ({
  createPostgresClient: createPostgresClientMock,
}));

vi.mock("../../src/providers/github/github-rest-client.js", () => ({
  GitHubRestClient: vi.fn(function (...args: unknown[]) {
    githubRestClientConstructorMock(...args);
    return {
      getPullRequest: vi.fn(),
      listPullRequestFiles: vi.fn(),
      listPullRequestReviews: vi.fn(),
      listIssueComments: vi.fn(),
      listReviewComments: vi.fn(),
      readTextFile: vi.fn(),
      listFiles: vi.fn(),
      createCheckRun: vi.fn(),
      updateCheckRun: vi.fn(),
      publishPullRequestReview: vi.fn(),
    };
  }),
}));

vi.mock("../../src/providers/github/github-adapter.js", () => ({
  GitHubAdapter: vi.fn(function (config: unknown) {
    githubAdapterConstructorMock(config);
    return {
      verifyWebhookSignature: vi.fn(),
      normalizeWebhookEvent: vi.fn(),
      fetchChangeRequestContext: vi.fn(),
    };
  }),
}));

vi.mock("../../src/review/chat-review-model.js", () => ({
  ChatReviewModel: vi.fn(function (config: unknown) {
    chatReviewModelConstructorMock(config);
    return {
      generateStructuredReview: vi.fn(),
    };
  }),
}));

import { buildRuntime } from "../../src/runtime/build-runtime.js";

describe("buildRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes configured provider base URLs into runtime clients when env secrets are present", async () => {
    const runtime = await buildRuntime({
      DATABASE_URL: "postgres://nitpickr:nitpickr@localhost:5432/nitpickr",
      NITPICKR_BASE_URL: "https://nitpickr.up.railway.app",
      NITPICKR_SECRET_KEY: "super-secret-key",
      NITPICKR_MODEL_BASE_URL: "http://model-stub:4020/v1",
      NITPICKR_REVIEW_MODEL: "qwen3.6:35b-a3b-coding-nvfp4",
      GITHUB_APP_ID: "123456",
      GITHUB_API_BASE_URL: "http://github-stub:4010",
      GITHUB_BOT_LOGINS: "getnitpickr,nitpickr",
      GITHUB_PRIVATE_KEY:
        "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
    });
    const operationalRuntime = await runtime.getOperationalRuntime();

    expect(createPostgresClientMock).toHaveBeenCalledWith(
      "postgres://nitpickr:nitpickr@localhost:5432/nitpickr",
    );
    expect(operationalRuntime).not.toBeNull();
    expect(githubRestClientConstructorMock).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.objectContaining({
        baseUrl: "http://github-stub:4010",
      }),
    );
    expect(githubAdapterConstructorMock).toHaveBeenCalledWith({
      apiClient: expect.anything(),
      appConfig: expect.objectContaining({
        botLogins: ["getnitpickr", "nitpickr"],
      }),
    });
    expect(chatReviewModelConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: null,
        model: "qwen3.6:35b-a3b-coding-nvfp4",
        baseUrl: "http://model-stub:4020/v1",
      }),
    );
  });

  it("stays in setup_required mode when no runtime secrets are configured", async () => {
    const runtime = await buildRuntime({
      DATABASE_URL: "postgres://nitpickr:nitpickr@localhost:5432/nitpickr",
      NITPICKR_BASE_URL: "https://nitpickr.up.railway.app",
      NITPICKR_SECRET_KEY: "super-secret-key",
    });

    await expect(runtime.getOperationalRuntime()).resolves.toBeNull();
    await expect(
      runtime.runtimeConfigService.getSetupStatus(),
    ).resolves.toEqual({
      state: "setup_required",
      modelConfigured: false,
      githubAppConfigured: false,
      ready: false,
    });
  });
});
