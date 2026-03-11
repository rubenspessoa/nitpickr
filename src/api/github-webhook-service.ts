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
  deliveryId: z.string().min(1),
  eventName: z.string().min(1),
  signature: z.string().min(1),
  rawBody: z.string(),
  payload: z.object({}).passthrough(),
});

export interface GitHubWebhookResult {
  statusCode: number;
  accepted: boolean;
  message: string;
}

export interface GitHubWebhookRequest {
  deliveryId: string;
  eventName: string;
  signature: string;
  rawBody: string;
  payload: unknown;
}

export type GitHubWebhookSignatureVerificationResult =
  | boolean
  | "setup_required";

export interface GitHubWebhookHandler {
  verifySignature(
    rawBody: string,
    signature: string,
  ): Promise<GitHubWebhookSignatureVerificationResult>;
  handle(input: GitHubWebhookRequest): Promise<GitHubWebhookResult>;
}

type WebhookEventTracker = Pick<
  WebhookEventService,
  "beginDelivery" | "markFailed" | "markIgnored" | "markQueued"
>;

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function buildChangeRequestId(
  repositoryId: string | undefined,
  pullNumber: number | undefined,
): string | undefined {
  if (!repositoryId || pullNumber === undefined) {
    return undefined;
  }

  return `${repositoryId}:${pullNumber}`;
}

function buildReviewStatusFields(
  event: Extract<GitHubNormalizedEvent, { kind: "review_requested" }>,
): {
  repositoryId: string;
  changeRequestId?: string;
} {
  const changeRequestId = buildChangeRequestId(
    event.repository.repositoryId,
    event.pullNumber,
  );

  return {
    repositoryId: event.repository.repositoryId,
    ...(changeRequestId ? { changeRequestId } : {}),
  };
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

export class GitHubWebhookService implements GitHubWebhookHandler {
  readonly #adapter: Pick<
    GitHubAdapter,
    "verifyWebhookSignature" | "normalizeWebhookEvent" | "reactToMention"
  >;
  readonly #queueScheduler: Pick<QueueScheduler, "enqueue">;
  readonly #logger: Logger;
  readonly #webhookEventService: WebhookEventTracker;

  constructor(
    adapter: Pick<
      GitHubAdapter,
      "verifyWebhookSignature" | "normalizeWebhookEvent" | "reactToMention"
    >,
    queueScheduler: Pick<QueueScheduler, "enqueue">,
    webhookEventService: WebhookEventTracker,
    logger: Logger = noopLogger,
  ) {
    this.#adapter = adapter;
    this.#queueScheduler = queueScheduler;
    this.#logger = logger.child({
      component: "github-webhook",
    });
    this.#webhookEventService = webhookEventService;
  }

  async verifySignature(rawBody: string, signature: string): Promise<boolean> {
    return await this.#adapter.verifyWebhookSignature(rawBody, signature);
  }

  async #updateWebhookEventStatus(
    deliveryId: string | undefined,
    status: "failed" | "ignored" | "queued",
    fields: {
      repositoryId?: string;
      changeRequestId?: string;
      errorMessage?: string;
    } = {},
  ): Promise<void> {
    if (!deliveryId) {
      return;
    }

    try {
      if (status === "failed") {
        await this.#webhookEventService.markFailed({
          deliveryId,
          errorMessage: fields.errorMessage ?? "Unknown webhook failure.",
        });
        return;
      }

      if (status === "ignored") {
        await this.#webhookEventService.markIgnored({
          deliveryId,
          ...(fields.repositoryId ? { repositoryId: fields.repositoryId } : {}),
          ...(fields.changeRequestId
            ? { changeRequestId: fields.changeRequestId }
            : {}),
        });
        return;
      }

      await this.#webhookEventService.markQueued({
        deliveryId,
        ...(fields.repositoryId ? { repositoryId: fields.repositoryId } : {}),
        ...(fields.changeRequestId
          ? { changeRequestId: fields.changeRequestId }
          : {}),
      });
    } catch (error) {
      this.#logger.error("Failed to persist GitHub webhook event status.", {
        deliveryId,
        status,
        alertable: true,
        monitoringKey: "webhook_event_persistence_failure",
        error:
          error instanceof Error
            ? error.message
            : "Unknown webhook event persistence failure.",
      });
    }
  }

  async handle(input: GitHubWebhookRequest): Promise<GitHubWebhookResult> {
    const parsed = webhookRequestSchema.parse(input);
    // Signature validation is async through the GitHub adapter and must stay awaited.
    const signatureValid = await this.verifySignature(
      parsed.rawBody,
      parsed.signature,
    );
    if (!signatureValid) {
      this.#logger.warn("Rejected GitHub webhook with invalid signature.", {
        eventName: parsed.eventName,
      });
      return {
        statusCode: 401,
        accepted: false,
        message: "Invalid GitHub webhook signature.",
      };
    }

    // Register the delivery before any reactions, normalization, or queue
    // work so duplicates are rejected before the handler produces side effects.
    const delivery = await this.#webhookEventService.beginDelivery({
      deliveryId: parsed.deliveryId,
      provider: "github",
      eventName: parsed.eventName,
      payload: parsed.payload,
    });

    if (delivery === "duplicate") {
      await this.#updateWebhookEventStatus(parsed.deliveryId, "ignored");
      this.#logger.warn("Ignored duplicate GitHub webhook delivery.", {
        deliveryId: parsed.deliveryId,
        eventName: parsed.eventName,
      });
      return {
        statusCode: 202,
        accepted: false,
        message: "Duplicate GitHub webhook delivery ignored.",
      };
    }

    try {
      const reaction = await Promise.resolve().then(() =>
        this.#adapter.reactToMention(parsed.eventName, parsed.payload),
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

    let normalized: ReturnType<GitHubAdapter["normalizeWebhookEvent"]>;
    try {
      normalized = this.#adapter.normalizeWebhookEvent(
        parsed.eventName,
        parsed.payload,
      );
    } catch (error) {
      await this.#updateWebhookEventStatus(parsed.deliveryId, "failed", {
        errorMessage: toErrorMessage(
          error,
          "Unknown webhook normalization failure.",
        ),
      });
      this.#logger.error("GitHub webhook event normalization failed.", {
        eventName: parsed.eventName,
        error: toErrorMessage(error, "Unknown webhook normalization failure."),
      });
      return {
        statusCode: 500,
        accepted: false,
        message: "Failed to process GitHub webhook event.",
      };
    }

    if (normalized.kind === "ignored") {
      await this.#updateWebhookEventStatus(parsed.deliveryId, "ignored");
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

    try {
      await this.#queueScheduler.enqueue(buildReviewJobInput(normalized));
      await this.#updateWebhookEventStatus(parsed.deliveryId, "queued", {
        ...buildReviewStatusFields(normalized),
      });
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
      await this.#updateWebhookEventStatus(parsed.deliveryId, "failed", {
        ...buildReviewStatusFields(normalized),
        errorMessage: toErrorMessage(
          error,
          "Unknown webhook queueing failure.",
        ),
      });
      this.#logger.error("GitHub webhook queueing failed.", {
        eventName: parsed.eventName,
        repositoryId: normalized.repository.repositoryId,
        pullNumber: normalized.pullNumber,
        error: toErrorMessage(error, "Unknown webhook queueing failure."),
      });
      return {
        statusCode: 500,
        accepted: false,
        message: "Failed to process GitHub webhook event.",
      };
    }
  }
}
