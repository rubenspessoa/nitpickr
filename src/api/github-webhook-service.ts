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
import type { WebhookEventService } from "./webhook-event-service.js";

const webhookRequestSchema = z.object({
  deliveryId: z.string().min(1).optional(),
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
  readonly #webhookEventService: Pick<
    WebhookEventService,
    "beginDelivery" | "markFailed" | "markIgnored" | "markQueued"
  > | null;

  constructor(
    adapter: Pick<
      GitHubAdapter,
      "verifyWebhookSignature" | "normalizeWebhookEvent" | "reactToMention"
    >,
    queueScheduler: Pick<QueueScheduler, "enqueue">,
    logger: Logger = noopLogger,
    webhookEventService: Pick<
      WebhookEventService,
      "beginDelivery" | "markFailed" | "markIgnored" | "markQueued"
    > | null = null,
  ) {
    this.#adapter = adapter;
    this.#queueScheduler = queueScheduler;
    this.#logger = logger.child({
      component: "github-webhook",
    });
    this.#webhookEventService = webhookEventService;
  }

  async handle(input: {
    deliveryId?: string;
    eventName: string;
    signature: string;
    rawBody: string;
    payload: unknown;
  }): Promise<GitHubWebhookResult> {
    const parsed = webhookRequestSchema.parse(input);
    if (parsed.deliveryId && this.#webhookEventService) {
      const delivery = await this.#webhookEventService.beginDelivery({
        deliveryId: parsed.deliveryId,
        provider: "github",
        eventName: parsed.eventName,
        payload: parsed.payload,
      });

      if (delivery === "duplicate") {
        this.#logger.info("Ignored duplicate GitHub webhook delivery.", {
          deliveryId: parsed.deliveryId,
          eventName: parsed.eventName,
        });
        return {
          statusCode: 202,
          accepted: false,
          message: "Duplicate GitHub webhook delivery ignored.",
        };
      }
    }

    const valid = this.#adapter.verifyWebhookSignature(
      parsed.rawBody,
      parsed.signature,
    );
    if (!valid) {
      if (parsed.deliveryId && this.#webhookEventService) {
        await this.#webhookEventService.markFailed({
          deliveryId: parsed.deliveryId,
          errorMessage: "Invalid GitHub webhook signature.",
        });
      }
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

    try {
      const normalized = this.#adapter.normalizeWebhookEvent(
        parsed.eventName,
        parsed.payload,
      );

      if (normalized.kind === "ignored") {
        if (parsed.deliveryId && this.#webhookEventService) {
          await this.#webhookEventService.markIgnored({
            deliveryId: parsed.deliveryId,
          });
        }
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
      if (parsed.deliveryId && this.#webhookEventService) {
        await this.#webhookEventService.markQueued({
          deliveryId: parsed.deliveryId,
          repositoryId: normalized.repository.repositoryId,
          changeRequestId: `${normalized.repository.repositoryId}:${normalized.pullNumber}`,
        });
      }
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
    } catch (error) {
      if (parsed.deliveryId && this.#webhookEventService) {
        await this.#webhookEventService.markFailed({
          deliveryId: parsed.deliveryId,
          errorMessage:
            error instanceof Error ? error.message : "Unknown webhook failure.",
        });
      }

      throw error;
    }
  }
}
