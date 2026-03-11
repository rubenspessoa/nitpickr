export const supportedWebhookProviders = ["github"] as const;
export type WebhookProvider = (typeof supportedWebhookProviders)[number];

export function isWebhookProvider(value: unknown): value is WebhookProvider {
  return (
    typeof value === "string" &&
    supportedWebhookProviders.includes(value as WebhookProvider)
  );
}

export type WebhookEventStatus =
  | "received"
  | "ignored"
  | "queued"
  | "processed"
  | "failed";

export const supportedWebhookEventStatuses = [
  "received",
  "ignored",
  "queued",
  "processed",
  "failed",
] as const;

export function isWebhookEventStatus(
  value: unknown,
): value is WebhookEventStatus {
  return (
    typeof value === "string" &&
    supportedWebhookEventStatuses.includes(value as WebhookEventStatus)
  );
}

export interface WebhookEventRecord {
  deliveryId: string;
  provider: WebhookProvider;
  eventName: string;
  status: WebhookEventStatus;
}

export interface WebhookEventStore {
  getByDeliveryId(deliveryId: string): Promise<WebhookEventRecord | null>;
  createEvent(input: {
    deliveryId: string;
    provider: WebhookProvider;
    eventName: string;
    status: WebhookEventStatus;
    payload: unknown;
  }): Promise<void>;
  updateEvent(input: {
    deliveryId: string;
    status: WebhookEventStatus;
    repositoryId?: string;
    changeRequestId?: string;
    errorMessage?: string;
    payload?: unknown;
  }): Promise<void>;
}

export class WebhookEventAlreadyExistsError extends Error {
  constructor(deliveryId: string) {
    super(`Webhook event with deliveryId ${deliveryId} already exists.`);
    this.name = "WebhookEventAlreadyExistsError";
  }
}

export class WebhookEventService {
  readonly #store: WebhookEventStore;

  constructor(store: WebhookEventStore) {
    this.#store = store;
  }

  async beginDelivery(input: {
    deliveryId: string;
    provider: WebhookProvider;
    eventName: string;
    payload: unknown;
  }): Promise<"new" | "duplicate"> {
    try {
      await this.#store.createEvent({
        deliveryId: input.deliveryId,
        provider: input.provider,
        eventName: input.eventName,
        status: "received",
        payload: input.payload,
      });
      return "new";
    } catch (error) {
      if (error instanceof WebhookEventAlreadyExistsError) {
        return "duplicate";
      }

      throw error;
    }
  }

  async markIgnored(input: {
    deliveryId: string;
    repositoryId?: string;
    changeRequestId?: string;
  }): Promise<void> {
    await this.#store.updateEvent({
      ...input,
      status: "ignored",
    });
  }

  async markQueued(input: {
    deliveryId: string;
    repositoryId?: string;
    changeRequestId?: string;
  }): Promise<void> {
    await this.#store.updateEvent({
      ...input,
      status: "queued",
    });
  }

  async markFailed(input: {
    deliveryId: string;
    errorMessage: string;
  }): Promise<void> {
    await this.#store.updateEvent({
      deliveryId: input.deliveryId,
      status: "failed",
      errorMessage: input.errorMessage,
    });
  }
}
