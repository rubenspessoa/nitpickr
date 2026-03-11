import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createPostgresClientMock,
  githubAdapterConstructorMock,
  githubRestClientConstructorMock,
  openAiReviewModelConstructorMock,
} = vi.hoisted(() => ({
  createPostgresClientMock: vi.fn(() => ({
    unsafe: vi.fn(async () => []),
    end: vi.fn(),
  })),
  githubAdapterConstructorMock: vi.fn(),
  githubRestClientConstructorMock: vi.fn(),
  openAiReviewModelConstructorMock: vi.fn(),
}));

vi.mock("../../src/runtime/postgres.js", () => ({
  createPostgresClient: createPostgresClientMock,
}));

vi.mock("../../src/providers/github/github-rest-client.js", () => ({
  GitHubRestClient: vi.fn().mockImplementation((...args: unknown[]) => {
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
  GitHubAdapter: vi.fn().mockImplementation((config: unknown) => {
    githubAdapterConstructorMock(config);
    return {
      verifyWebhookSignature: vi.fn(),
      normalizeWebhookEvent: vi.fn(),
      fetchChangeRequestContext: vi.fn(),
    };
  }),
}));

vi.mock("../../src/review/openai-review-model.js", () => ({
  OpenAiReviewModel: vi.fn().mockImplementation((config: unknown) => {
    openAiReviewModelConstructorMock(config);
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
      OPENAI_API_KEY: "sk-test-key",
      OPENAI_BASE_URL: "http://openai-stub:4020/v1",
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
      {
        baseUrl: "http://github-stub:4010",
      },
    );
    expect(githubAdapterConstructorMock).toHaveBeenCalledWith({
      apiClient: expect.anything(),
      appConfig: expect.objectContaining({
        botLogins: ["getnitpickr", "nitpickr"],
      }),
    });
    expect(openAiReviewModelConstructorMock).toHaveBeenCalledWith({
      apiKey: "sk-test-key",
      model: "gpt-4.1",
      baseUrl: "http://openai-stub:4020/v1",
    });
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
      openAiConfigured: false,
      githubAppConfigured: false,
      ready: false,
    });
  });
});
