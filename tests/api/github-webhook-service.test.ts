import { describe, expect, it } from "vitest";

import { GitHubWebhookService } from "../../src/api/github-webhook-service.js";
import type { GitHubNormalizedEvent } from "../../src/providers/github/github-adapter.js";
import type {
  EnqueueJobInput,
  QueueJob,
} from "../../src/queue/queue-scheduler.js";

class FakeLogger {
  readonly entries: Array<{
    level: string;
    message: string;
    fields: Record<string, unknown>;
  }> = [];

  debug(message: string, fields: Record<string, unknown> = {}) {
    this.entries.push({ level: "debug", message, fields });
  }

  info(message: string, fields: Record<string, unknown> = {}) {
    this.entries.push({ level: "info", message, fields });
  }

  warn(message: string, fields: Record<string, unknown> = {}) {
    this.entries.push({ level: "warn", message, fields });
  }

  error(message: string, fields: Record<string, unknown> = {}) {
    this.entries.push({ level: "error", message, fields });
  }

  child(fields: Record<string, unknown>) {
    return {
      debug: (message: string, entryFields: Record<string, unknown> = {}) =>
        this.debug(message, { ...fields, ...entryFields }),
      info: (message: string, entryFields: Record<string, unknown> = {}) =>
        this.info(message, { ...fields, ...entryFields }),
      warn: (message: string, entryFields: Record<string, unknown> = {}) =>
        this.warn(message, { ...fields, ...entryFields }),
      error: (message: string, entryFields: Record<string, unknown> = {}) =>
        this.error(message, { ...fields, ...entryFields }),
      child: (childFields: Record<string, unknown>) =>
        this.child({ ...fields, ...childFields }),
    };
  }
}

class FakeQueueScheduler {
  readonly calls: EnqueueJobInput[] = [];

  async enqueue(input: EnqueueJobInput): Promise<QueueJob> {
    this.calls.push(input);
    return {
      id: "job_1",
      type: input.type,
      tenantId: input.tenantId,
      repositoryId: input.repositoryId,
      changeRequestId: input.changeRequestId,
      dedupeKey: input.dedupeKey,
      priority: input.priority,
      status: "queued",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      payload: input.payload,
      createdAt: new Date("2026-03-09T10:00:00.000Z"),
      scheduledAt: new Date("2026-03-09T10:00:00.000Z"),
      startedAt: null,
      completedAt: null,
      workerId: null,
      lastError: null,
    };
  }
}

class FakeGitHubAdapter {
  signatureValid = true;
  mentionReaction: {
    commentId: number;
    content: "eyes";
  } | null = null;
  mentionReactionError: Error | null = null;
  normalizedEvent: GitHubNormalizedEvent = {
    kind: "review_requested",
    installationId: "123456",
    repository: {
      installationId: "123456",
      repositoryId: "github:99",
      providerRepositoryId: 99,
      owner: "rubenspessoa",
      name: "nitpickr",
      defaultBranch: "main",
    },
    pullNumber: 42,
    trigger: {
      type: "pr_opened",
      actorLogin: "ruben",
    },
    mode: "quick",
    actorLogin: "ruben",
  };

  verifyWebhookSignature(): boolean {
    return this.signatureValid;
  }

  normalizeWebhookEvent(): GitHubNormalizedEvent {
    return this.normalizedEvent;
  }

  async reactToMention() {
    if (this.mentionReactionError) {
      throw this.mentionReactionError;
    }

    return this.mentionReaction;
  }
}

describe("GitHubWebhookService", () => {
  it("enqueues review jobs for supported GitHub events", async () => {
    const adapter = new FakeGitHubAdapter();
    const queue = new FakeQueueScheduler();
    const logger = new FakeLogger();
    const service = new GitHubWebhookService(adapter, queue, logger);

    const result = await service.handle({
      eventName: "pull_request",
      signature: "sha256=test",
      rawBody: "{}",
      payload: {},
    });

    expect(result.statusCode).toBe(202);
    expect(queue.calls).toHaveLength(1);
    expect(queue.calls[0]?.type).toBe("review_requested");
    expect(queue.calls[0]?.tenantId).toBe("github-installation:123456");
    expect(queue.calls[0]?.payload.trigger).toEqual({
      type: "pr_opened",
      actorLogin: "ruben",
    });
    expect(logger.entries).toContainEqual({
      level: "info",
      message: "Queued GitHub review job.",
      fields: {
        component: "github-webhook",
        eventName: "pull_request",
        installationId: "123456",
        repositoryId: "github:99",
        pullNumber: 42,
        mode: "quick",
      },
    });
  });

  it("reacts to issue comment mentions before queueing work", async () => {
    const adapter = new FakeGitHubAdapter();
    adapter.mentionReaction = {
      commentId: 9001,
      content: "eyes",
    };
    const queue = new FakeQueueScheduler();
    const logger = new FakeLogger();
    const service = new GitHubWebhookService(adapter, queue, logger);

    const result = await service.handle({
      eventName: "issue_comment",
      signature: "sha256=test",
      rawBody: "{}",
      payload: {},
    });

    expect(result.statusCode).toBe(202);
    expect(logger.entries).toContainEqual({
      level: "info",
      message: "Reacted to GitHub bot mention.",
      fields: {
        component: "github-webhook",
        eventName: "issue_comment",
        commentId: 9001,
        content: "eyes",
      },
    });
  });

  it("logs mention reaction failures without rejecting the webhook", async () => {
    const adapter = new FakeGitHubAdapter();
    adapter.mentionReactionError = new Error("reaction failed");
    const queue = new FakeQueueScheduler();
    const logger = new FakeLogger();
    const service = new GitHubWebhookService(adapter, queue, logger);

    const result = await service.handle({
      eventName: "issue_comment",
      signature: "sha256=test",
      rawBody: "{}",
      payload: {},
    });

    expect(result.statusCode).toBe(202);
    expect(logger.entries).toContainEqual({
      level: "warn",
      message: "Failed to react to GitHub bot mention.",
      fields: {
        component: "github-webhook",
        eventName: "issue_comment",
        error: "reaction failed",
      },
    });
  });

  it("rejects invalid signatures", async () => {
    const adapter = new FakeGitHubAdapter();
    adapter.signatureValid = false;
    const queue = new FakeQueueScheduler();
    const logger = new FakeLogger();
    const service = new GitHubWebhookService(adapter, queue, logger);

    const result = await service.handle({
      eventName: "pull_request",
      signature: "sha256=bad",
      rawBody: "{}",
      payload: {},
    });

    expect(result.statusCode).toBe(401);
    expect(queue.calls).toEqual([]);
    expect(logger.entries).toContainEqual({
      level: "warn",
      message: "Rejected GitHub webhook with invalid signature.",
      fields: {
        component: "github-webhook",
        eventName: "pull_request",
      },
    });
  });

  it("ignores unsupported events without queueing work", async () => {
    const adapter = new FakeGitHubAdapter();
    adapter.normalizedEvent = {
      kind: "ignored",
      reason: "unsupported",
    };
    const queue = new FakeQueueScheduler();
    const logger = new FakeLogger();
    const service = new GitHubWebhookService(adapter, queue, logger);

    const result = await service.handle({
      eventName: "issue_comment",
      signature: "sha256=test",
      rawBody: "{}",
      payload: {},
    });

    expect(result.statusCode).toBe(202);
    expect(result.accepted).toBe(false);
    expect(queue.calls).toEqual([]);
    expect(logger.entries).toContainEqual({
      level: "info",
      message: "Ignored GitHub webhook event.",
      fields: {
        component: "github-webhook",
        eventName: "issue_comment",
        reason: "unsupported",
      },
    });
  });
});
