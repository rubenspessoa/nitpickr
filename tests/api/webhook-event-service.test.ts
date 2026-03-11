import { describe, expect, it } from "vitest";

import {
  WebhookEventAlreadyExistsError,
  type WebhookEventRecord,
  WebhookEventService,
  type WebhookEventStore,
} from "../../src/api/webhook-event-service.js";

class InMemoryWebhookEventStore implements WebhookEventStore {
  readonly events = new Map<string, WebhookEventRecord>();

  async getByDeliveryId(
    deliveryId: string,
  ): Promise<WebhookEventRecord | null> {
    return this.events.get(deliveryId) ?? null;
  }

  async createEvent(input: {
    deliveryId: string;
    provider: "github";
    eventName: string;
    status: WebhookEventRecord["status"];
    payload: unknown;
  }): Promise<void> {
    if (this.events.has(input.deliveryId)) {
      throw new WebhookEventAlreadyExistsError(input.deliveryId);
    }

    this.events.set(input.deliveryId, {
      deliveryId: input.deliveryId,
      provider: input.provider,
      eventName: input.eventName,
      status: input.status,
    });
  }

  async updateEvent(input: {
    deliveryId: string;
    status: WebhookEventRecord["status"];
  }): Promise<void> {
    const current = this.events.get(input.deliveryId);
    if (!current) {
      throw new Error(`Unknown delivery ${input.deliveryId}`);
    }

    this.events.set(input.deliveryId, {
      ...current,
      status: input.status,
    });
  }
}

describe("WebhookEventService", () => {
  it("records new deliveries and rejects duplicates", async () => {
    const service = new WebhookEventService(new InMemoryWebhookEventStore());

    await expect(
      service.beginDelivery({
        deliveryId: "delivery-1",
        provider: "github",
        eventName: "pull_request",
        payload: {},
      }),
    ).resolves.toBe("new");

    await expect(
      service.beginDelivery({
        deliveryId: "delivery-1",
        provider: "github",
        eventName: "pull_request",
        payload: {},
      }),
    ).resolves.toBe("duplicate");
  });

  it("treats duplicate insert races as duplicates", async () => {
    const service = new WebhookEventService({
      async getByDeliveryId() {
        throw new Error("should not be called");
      },
      async createEvent() {
        throw new WebhookEventAlreadyExistsError("delivery-race");
      },
      async updateEvent() {
        throw new Error("not needed");
      },
    });

    await expect(
      service.beginDelivery({
        deliveryId: "delivery-race",
        provider: "github",
        eventName: "pull_request",
        payload: {},
      }),
    ).resolves.toBe("duplicate");
  });

  it("updates delivery statuses", async () => {
    const store = new InMemoryWebhookEventStore();
    const service = new WebhookEventService(store);

    await service.beginDelivery({
      deliveryId: "delivery-2",
      provider: "github",
      eventName: "issue_comment",
      payload: {},
    });
    await service.markQueued({ deliveryId: "delivery-2" });
    expect(store.events.get("delivery-2")?.status).toBe("queued");

    await service.markFailed({
      deliveryId: "delivery-2",
      errorMessage: "boom",
    });
    expect(store.events.get("delivery-2")?.status).toBe("failed");
  });
});
