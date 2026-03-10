import { z } from "zod";

import { type Logger, noopLogger } from "../logging/logger.js";
import type {
  GitHubAdapter,
  GitHubNormalizedEvent,
} from "../providers/github/github-adapter.js";
import type {
  EnqueueJobInput,
  QueueScheduler,
} from "../queue/queue-scheduler.js";

const webhookRequestSchema = z.object({
  eventName: z.string().min(1),
  signature: z.string().min(1),
  rawBody: z.string(),
  payload: z.unknown(),
});

export interface GitHubWebhookResult {
  statusCode: number;
  accepted: boolean;
  message: string;
}

function buildReviewJobInput(
  event: Extract<GitHubNormalizedEvent, { kind: "review_requested" }>,
): EnqueueJobInput {
  return {
    type: "review_requested",
    tenantId: `github-installation:${event.installationId}`,
    repositoryId: event.repository.repositoryId,
    changeRequestId: `${event.repository.repositoryId}:${event.pullNumber}`,
    dedupeKey: `${event.repository.repositoryId}:${event.pullNumber}:${event.mode}`,
    priority: event.trigger.type === "manual_command" ? 100 : 50,
    payload: {
      installationId: event.installationId,
      repository: {
        owner: event.repository.owner,
        name: event.repository.name,
      },
      pullNumber: event.pullNumber,
      mode: event.mode,
      trigger: event.trigger,
    },
  };
}

export class GitHubWebhookService {
  readonly #adapter: Pick<
    GitHubAdapter,
    "verifyWebhookSignature" | "normalizeWebhookEvent" | "reactToMention"
  >;
  readonly #queueScheduler: Pick<QueueScheduler, "enqueue">;
  readonly #logger: Logger;

  constructor(
    adapter: Pick<
      GitHubAdapter,
      "verifyWebhookSignature" | "normalizeWebhookEvent" | "reactToMention"
    >,
    queueScheduler: Pick<QueueScheduler, "enqueue">,
    logger: Logger = noopLogger,
  ) {
    this.#adapter = adapter;
    this.#queueScheduler = queueScheduler;
    this.#logger = logger.child({
      component: "github-webhook",
    });
  }

  async handle(input: {
    eventName: string;
    signature: string;
    rawBody: string;
    payload: unknown;
  }): Promise<GitHubWebhookResult> {
    const parsed = webhookRequestSchema.parse(input);
    const valid = this.#adapter.verifyWebhookSignature(
      parsed.rawBody,
      parsed.signature,
    );
    if (!valid) {
      this.#logger.warn("Rejected GitHub webhook with invalid signature.", {
        eventName: parsed.eventName,
      });
      return {
        statusCode: 401,
        accepted: false,
        message: "Invalid GitHub webhook signature.",
      };
    }

    try {
      const reaction = await this.#adapter.reactToMention(
        parsed.eventName,
        parsed.payload,
      );
      if (reaction) {
        this.#logger.info("Reacted to GitHub bot mention.", {
          eventName: parsed.eventName,
          commentId: reaction.commentId,
          content: reaction.content,
        });
      }
    } catch (error) {
      this.#logger.warn("Failed to react to GitHub bot mention.", {
        eventName: parsed.eventName,
        error:
          error instanceof Error ? error.message : "Unknown reaction failure.",
      });
    }

    const normalized = this.#adapter.normalizeWebhookEvent(
      parsed.eventName,
      parsed.payload,
    );

    if (normalized.kind === "ignored") {
      this.#logger.info("Ignored GitHub webhook event.", {
        eventName: parsed.eventName,
        reason: normalized.reason,
      });
      return {
        statusCode: 202,
        accepted: false,
        message: normalized.reason,
      };
    }

    await this.#queueScheduler.enqueue(buildReviewJobInput(normalized));
    this.#logger.info("Queued GitHub review job.", {
      eventName: parsed.eventName,
      installationId: normalized.installationId,
      repositoryId: normalized.repository.repositoryId,
      pullNumber: normalized.pullNumber,
      mode: normalized.mode,
    });
    return {
      statusCode: 202,
      accepted: true,
      message: "Review job queued.",
    };
  }
}
