import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  GitHubAdapter,
  type GitHubApiClient,
} from "../../src/providers/github/github-adapter.js";

class FakeGitHubApiClient implements GitHubApiClient {
  readonly reactions: Array<{
    installationId: string;
    owner: string;
    repo: string;
    commentId: number;
    content: "eyes";
  }> = [];

  async getPullRequest() {
    return {
      id: 101,
      number: 42,
      title: "Improve queue fairness",
      state: "open" as const,
      draft: false,
      user: {
        login: "ruben",
      },
      base: {
        sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ref: "main",
      },
      head: {
        sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        ref: "feature/queue",
      },
    };
  }

  async listPullRequestFiles() {
    return [
      {
        filename: "src/queue/queue-scheduler.ts",
        status: "modified" as const,
        additions: 24,
        deletions: 2,
        patch: "@@ -1,4 +1,6 @@\n+new lines",
      },
    ];
  }

  async listIssueComments() {
    return [
      {
        id: 9001,
        body: "@nitpickr review",
        user: {
          login: "maintainer",
        },
        created_at: "2026-03-09T10:00:00.000Z",
      },
    ];
  }

  async listReviewComments() {
    return [
      {
        id: 8080,
        body: "This should preserve insertion order.",
        user: {
          login: "reviewer",
        },
        path: "src/queue/queue-scheduler.ts",
        line: 18,
        created_at: "2026-03-09T10:01:00.000Z",
      },
    ];
  }

  async createIssueCommentReaction(input: {
    installationId: string;
    owner: string;
    repo: string;
    commentId: number;
    content: "eyes";
  }) {
    this.reactions.push(input);
  }
}

const pullRequestPayload = {
  action: "opened",
  installation: {
    id: 123456,
  },
  repository: {
    id: 99,
    name: "nitpickr",
    owner: {
      login: "rubenspessoa",
    },
    default_branch: "main",
  },
  pull_request: {
    id: 101,
    number: 42,
    title: "Improve queue fairness",
    state: "open",
    draft: false,
    user: {
      login: "ruben",
    },
    base: {
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ref: "main",
    },
    head: {
      sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ref: "feature/queue",
    },
  },
};

describe("GitHubAdapter", () => {
  it("verifies webhook signatures", async () => {
    const adapter = new GitHubAdapter({
      apiClient: new FakeGitHubApiClient(),
      appConfig: {
        appId: 123456,
        privateKey: "test",
        webhookSecret: "super-secret",
        webhookUrl: "https://nitpickr.example.com/webhooks/github",
      },
    });
    const payload = JSON.stringify(pullRequestPayload);
    const signature = createHmac("sha256", "super-secret")
      .update(payload)
      .digest("hex");

    await expect(
      adapter.verifyWebhookSignature(payload, `sha256=${signature}`),
    ).resolves.toBe(true);
    await expect(
      adapter.verifyWebhookSignature(payload, "sha256=bad"),
    ).resolves.toBe(false);
  });

  it("normalizes pull request events into review requests", () => {
    const adapter = new GitHubAdapter({
      apiClient: new FakeGitHubApiClient(),
      appConfig: {
        appId: 123456,
        privateKey: "test",
        webhookSecret: "super-secret",
        webhookUrl: "https://nitpickr.example.com/webhooks/github",
      },
    });

    const event = adapter.normalizeWebhookEvent(
      "pull_request",
      pullRequestPayload,
    );

    expect(event.kind).toBe("review_requested");
    if (event.kind !== "review_requested") {
      throw new Error("Expected a review request event.");
    }

    expect(event.repository.owner).toBe("rubenspessoa");
    expect(event.trigger.type).toBe("pr_opened");
  });

  it("ignores unsupported pull request actions instead of throwing", () => {
    const adapter = new GitHubAdapter({
      apiClient: new FakeGitHubApiClient(),
      appConfig: {
        appId: 123456,
        privateKey: "test",
        webhookSecret: "super-secret",
        webhookUrl: "https://nitpickr.example.com/webhooks/github",
      },
    });

    const event = adapter.normalizeWebhookEvent("pull_request", {
      ...pullRequestPayload,
      action: "edited",
    });

    expect(event).toEqual({
      kind: "ignored",
      reason: "Unsupported pull_request payload.",
    });
  });

  it("normalizes manual commands from issue comments", () => {
    const adapter = new GitHubAdapter({
      apiClient: new FakeGitHubApiClient(),
      appConfig: {
        appId: 123456,
        privateKey: "test",
        webhookSecret: "super-secret",
        webhookUrl: "https://nitpickr.example.com/webhooks/github",
        botLogins: ["nitpickr", "getnitpickr"],
      },
    });

    const event = adapter.normalizeWebhookEvent("issue_comment", {
      action: "created",
      installation: {
        id: 123456,
      },
      repository: {
        id: 99,
        name: "nitpickr",
        owner: {
          login: "rubenspessoa",
        },
        default_branch: "main",
      },
      issue: {
        number: 42,
        pull_request: {
          url: "https://api.github.com/repos/rubenspessoa/nitpickr/pulls/42",
        },
      },
      comment: {
        id: 5001,
        body: "@nitpickr full review",
        user: {
          login: "maintainer",
        },
      },
    });

    expect(event.kind).toBe("review_requested");
    if (event.kind !== "review_requested") {
      throw new Error("Expected a review request event.");
    }

    expect(event.trigger.type).toBe("manual_command");
    if (event.trigger.type !== "manual_command") {
      throw new Error("Expected a manual command trigger.");
    }

    expect(event.trigger.command).toBe("full_review");
    expect(event.mode).toBe("full");
  });

  it("normalizes edited issue comments into manual review requests", () => {
    const adapter = new GitHubAdapter({
      apiClient: new FakeGitHubApiClient(),
      appConfig: {
        appId: 123456,
        privateKey: "test",
        webhookSecret: "super-secret",
        webhookUrl: "https://nitpickr.example.com/webhooks/github",
        botLogins: ["nitpickr", "getnitpickr"],
      },
    });

    const event = adapter.normalizeWebhookEvent("issue_comment", {
      action: "edited",
      installation: {
        id: 123456,
      },
      repository: {
        id: 99,
        name: "nitpickr",
        owner: {
          login: "rubenspessoa",
        },
        default_branch: "main",
      },
      issue: {
        number: 42,
        pull_request: {
          url: "https://api.github.com/repos/rubenspessoa/nitpickr/pulls/42",
        },
      },
      comment: {
        id: 5002,
        body: "@nitpickr review",
        user: {
          login: "maintainer",
        },
      },
    });

    expect(event.kind).toBe("review_requested");
    if (event.kind !== "review_requested") {
      throw new Error("Expected a review request event.");
    }

    expect(event.trigger.type).toBe("manual_command");
    if (event.trigger.type !== "manual_command") {
      throw new Error("Expected a manual command trigger.");
    }

    expect(event.trigger.command).toBe("review");
    expect(event.mode).toBe("quick");
  });

  it("accepts flexible manual command formatting", () => {
    const adapter = new GitHubAdapter({
      apiClient: new FakeGitHubApiClient(),
      appConfig: {
        appId: 123456,
        privateKey: "test",
        webhookSecret: "super-secret",
        webhookUrl: "https://nitpickr.example.com/webhooks/github",
        botLogins: ["nitpickr", "getnitpickr"],
      },
    });

    const event = adapter.normalizeWebhookEvent("issue_comment", {
      action: "created",
      installation: {
        id: 123456,
      },
      repository: {
        id: 99,
        name: "nitpickr",
        owner: {
          login: "rubenspessoa",
        },
        default_branch: "main",
      },
      issue: {
        number: 42,
        pull_request: {
          url: "https://api.github.com/repos/rubenspessoa/nitpickr/pulls/42",
        },
      },
      comment: {
        id: 5003,
        body: "please @getnitpickr: full-review",
        user: {
          login: "maintainer",
        },
      },
    });

    expect(event.kind).toBe("review_requested");
    if (event.kind !== "review_requested") {
      throw new Error("Expected a review request event.");
    }

    expect(event.trigger.type).toBe("manual_command");
    if (event.trigger.type !== "manual_command") {
      throw new Error("Expected a manual command trigger.");
    }

    expect(event.trigger.command).toBe("full_review");
    expect(event.mode).toBe("full");
  });

  it("ignores unsupported comment commands", () => {
    const adapter = new GitHubAdapter({
      apiClient: new FakeGitHubApiClient(),
      appConfig: {
        appId: 123456,
        privateKey: "test",
        webhookSecret: "super-secret",
        webhookUrl: "https://nitpickr.example.com/webhooks/github",
        botLogins: ["nitpickr", "getnitpickr"],
      },
    });

    const event = adapter.normalizeWebhookEvent("issue_comment", {
      action: "created",
      installation: {
        id: 123456,
      },
      repository: {
        id: 99,
        name: "nitpickr",
        owner: {
          login: "rubenspessoa",
        },
        default_branch: "main",
      },
      issue: {
        number: 42,
        pull_request: {
          url: "https://api.github.com/repos/rubenspessoa/nitpickr/pulls/42",
        },
      },
      comment: {
        id: 5004,
        body: "@nitpickr ship it",
        user: {
          login: "maintainer",
        },
      },
    });

    expect(event).toEqual({
      kind: "ignored",
      reason:
        "Comment did not contain a recognized nitpickr command. Supported commands: @nitpickr review, @nitpickr full review, @nitpickr summary, @nitpickr recheck, @nitpickr ignore this, @getnitpickr review, @getnitpickr full review, @getnitpickr summary, @getnitpickr recheck, @getnitpickr ignore this.",
    });
  });

  it("reacts to issue comments that mention the bot", async () => {
    const apiClient = new FakeGitHubApiClient();
    const adapter = new GitHubAdapter({
      apiClient,
      appConfig: {
        appId: 123456,
        privateKey: "test",
        webhookSecret: "super-secret",
        webhookUrl: "https://nitpickr.example.com/webhooks/github",
        botLogins: ["nitpickr", "getnitpickr"],
      },
    });

    const reaction = await adapter.reactToMention("issue_comment", {
      action: "created",
      installation: {
        id: 123456,
      },
      repository: {
        id: 99,
        name: "nitpickr",
        owner: {
          login: "rubenspessoa",
        },
        default_branch: "main",
      },
      issue: {
        number: 42,
        pull_request: {
          url: "https://api.github.com/repos/rubenspessoa/nitpickr/pulls/42",
        },
      },
      comment: {
        id: 7001,
        body: "hey @getnitpickr can you review this?",
        user: {
          login: "maintainer",
        },
      },
    });

    expect(reaction).toEqual({
      commentId: 7001,
      content: "eyes",
    });
    expect(apiClient.reactions).toEqual([
      {
        installationId: "123456",
        owner: "rubenspessoa",
        repo: "nitpickr",
        commentId: 7001,
        content: "eyes",
      },
    ]);
  });

  it("loads normalized change request context from the GitHub API", async () => {
    const adapter = new GitHubAdapter({
      apiClient: new FakeGitHubApiClient(),
      appConfig: {
        appId: 123456,
        privateKey: "test",
        webhookSecret: "super-secret",
        webhookUrl: "https://nitpickr.example.com/webhooks/github",
      },
    });

    const context = await adapter.fetchChangeRequestContext({
      installationId: "123456",
      repository: {
        owner: "rubenspessoa",
        name: "nitpickr",
      },
      pullNumber: 42,
      tenantId: "tenant_1",
      repositoryId: "repo_1",
    });

    expect(context.changeRequest.number).toBe(42);
    expect(context.files[0]?.path).toBe("src/queue/queue-scheduler.ts");
    expect(context.comments).toHaveLength(2);
  });

  it("ignores malformed webhook payloads", () => {
    const adapter = new GitHubAdapter({
      apiClient: new FakeGitHubApiClient(),
      appConfig: {
        appId: 123456,
        privateKey: "test",
        webhookSecret: "super-secret",
        webhookUrl: "https://nitpickr.example.com/webhooks/github",
      },
    });

    expect(
      adapter.normalizeWebhookEvent("pull_request", {
        action: "opened",
      }),
    ).toEqual({
      kind: "ignored",
      reason: "Unsupported pull_request payload.",
    });
  });
});
