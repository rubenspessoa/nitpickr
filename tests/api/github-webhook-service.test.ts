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

class FakeWebhookEventService {
  received: string[] = [];
  queued: string[] = [];
  ignored: string[] = [];
  failed: string[] = [];
  duplicates = new Set<string>();
  markFailedError: Error | null = null;

  async beginDelivery(input: { deliveryId: string }) {
    this.received.push(input.deliveryId);
    return this.duplicates.has(input.deliveryId) ? "duplicate" : "new";
  }

  async markQueued(input: { deliveryId: string }) {
    this.queued.push(input.deliveryId);
  }

  async markIgnored(input: { deliveryId: string }) {
    this.ignored.push(input.deliveryId);
  }

  async markFailed(input: { deliveryId: string }) {
    if (this.markFailedError) {
      throw this.markFailedError;
    }
    this.failed.push(input.deliveryId);
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
    const webhookEvents = new FakeWebhookEventService();
    const logger = new FakeLogger();
    const service = new GitHubWebhookService(
      adapter,
      queue,
      logger,
      webhookEvents,
    );

    const result = await service.handle({
      deliveryId: "delivery-1",
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
    expect(webhookEvents.queued).toEqual(["delivery-1"]);
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
    const webhookEvents = new FakeWebhookEventService();
    const logger = new FakeLogger();
    const service = new GitHubWebhookService(
      adapter,
      queue,
      logger,
      webhookEvents,
    );

    const result = await service.handle({
      deliveryId: "delivery-2",
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
    const webhookEvents = new FakeWebhookEventService();
    const logger = new FakeLogger();
    const service = new GitHubWebhookService(
      adapter,
      queue,
      logger,
      webhookEvents,
    );

    const result = await service.handle({
      deliveryId: "delivery-3",
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
    const webhookEvents = new FakeWebhookEventService();
    const logger = new FakeLogger();
    const service = new GitHubWebhookService(
      adapter,
      queue,
      logger,
      webhookEvents,
    );

    const result = await service.handle({
      deliveryId: "delivery-4",
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
    const webhookEvents = new FakeWebhookEventService();
    const logger = new FakeLogger();
    const service = new GitHubWebhookService(
      adapter,
      queue,
      logger,
      webhookEvents,
    );

    const result = await service.handle({
      deliveryId: "delivery-5",
      eventName: "issue_comment",
      signature: "sha256=test",
      rawBody: "{}",
      payload: {},
    });

    expect(result.statusCode).toBe(202);
    expect(result.accepted).toBe(false);
    expect(queue.calls).toEqual([]);
    expect(webhookEvents.ignored).toEqual(["delivery-5"]);
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

  it("dedupes repeated webhook deliveries before queueing", async () => {
    const adapter = new FakeGitHubAdapter();
    const queue = new FakeQueueScheduler();
    const webhookEvents = new FakeWebhookEventService();
    webhookEvents.duplicates.add("delivery-dup");
    const logger = new FakeLogger();
    const service = new GitHubWebhookService(
      adapter,
      queue,
      logger,
      webhookEvents,
    );

    const result = await service.handle({
      deliveryId: "delivery-dup",
      eventName: "pull_request",
      signature: "sha256=test",
      rawBody: "{}",
      payload: {},
    });

    expect(result.statusCode).toBe(202);
    expect(result.accepted).toBe(false);
    expect(result.message).toBe("Duplicate GitHub webhook delivery ignored.");
    expect(queue.calls).toEqual([]);
  });

  it("logs webhook event persistence failures without swallowing the original webhook error", async () => {
    const adapter = new FakeGitHubAdapter();
    const queue = new FakeQueueScheduler();
    const webhookEvents = new FakeWebhookEventService();
    webhookEvents.markFailedError = new Error("db write failed");
    const logger = new FakeLogger();
    const service = new GitHubWebhookService(
      adapter,
      queue,
      logger,
      webhookEvents,
    );

    adapter.normalizeWebhookEvent = () => {
      throw new Error("boom");
    };

    const result = await service.handle({
      deliveryId: "delivery-fail",
      eventName: "pull_request",
      signature: "sha256=test",
      rawBody: "{}",
      payload: {},
    });

    expect(result.statusCode).toBe(500);
    expect(result.accepted).toBe(false);
    expect(result.message).toBe("Failed to process GitHub webhook event.");
    expect(logger.entries).toContainEqual({
      level: "warn",
      message: "Failed to persist GitHub webhook event status.",
      fields: {
        component: "github-webhook",
        deliveryId: "delivery-fail",
        status: "failed",
        error: "db write failed",
      },
    });
    expect(logger.entries).toContainEqual({
      level: "error",
      message: "GitHub webhook processing failed.",
      fields: {
        component: "github-webhook",
        eventName: "pull_request",
        error: "boom",
      },
    });
  });

  it("logs when webhook event tracking is disabled", async () => {
    const adapter = new FakeGitHubAdapter();
    const queue = new FakeQueueScheduler();
    const logger = new FakeLogger();
    const service = new GitHubWebhookService(adapter, queue, logger);

    const result = await service.handle({
      deliveryId: "delivery-noop",
      eventName: "pull_request",
      signature: "sha256=test",
      rawBody: "{}",
      payload: {},
    });

    expect(result.statusCode).toBe(202);
    expect(logger.entries).toContainEqual({
      level: "debug",
      message: "GitHub webhook event tracking is disabled.",
      fields: {
        component: "webhook-event-tracker",
        deliveryId: "delivery-noop",
        operation: "beginDelivery",
      },
    });
  });
});
