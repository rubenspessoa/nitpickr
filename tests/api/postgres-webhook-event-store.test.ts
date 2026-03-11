import { describe, expect, it } from "vitest";

import {
  PostgresWebhookEventStore,
  WebhookEventNotFoundError,
  WebhookEventStoreError,
} from "../../src/api/postgres-webhook-event-store.js";
import { WebhookEventAlreadyExistsError } from "../../src/api/webhook-event-service.js";

interface QueryCall {
  query: string;
  params: readonly unknown[] | undefined;
}

class FakePostgresClient {
  readonly calls: QueryCall[] = [];
  readonly responses: unknown[][] = [];
  readonly errors: Error[] = [];

  queueResponse(rows: unknown[]): void {
    this.responses.push(rows);
  }

  queueError(error: Error): void {
    this.errors.push(error);
  }

  async executeParameterized<T extends Record<string, unknown>>(
    query: string,
    params?: readonly unknown[],
  ): Promise<T[]> {
    const error = this.errors.shift();
    if (error) {
      throw error;
    }

    this.calls.push({ query, params });
    return (this.responses.shift() ?? []) as T[];
  }
}

describe("PostgresWebhookEventStore", () => {
  it("loads a webhook event by delivery id", async () => {
    const client = new FakePostgresClient();
    client.queueResponse([
      {
        delivery_id: "delivery-1",
        provider: "github",
        event_name: "pull_request",
        status: "queued",
      },
    ]);
    const store = new PostgresWebhookEventStore(client);

    const event = await store.getByDeliveryId("delivery-1");

    expect(event).toEqual({
      deliveryId: "delivery-1",
      provider: "github",
      eventName: "pull_request",
      status: "queued",
    });
  });

  it("rejects unsupported provider values from persisted rows", async () => {
    const client = new FakePostgresClient();
    client.queueResponse([
      {
        delivery_id: "delivery-unsupported",
        provider: "gitlab",
        event_name: "pull_request",
        status: "queued",
      },
    ]);
    const store = new PostgresWebhookEventStore(client);

    await expect(() =>
      store.getByDeliveryId("delivery-unsupported"),
    ).rejects.toThrow(/unsupported webhook event provider/i);
  });

  it("rejects unsupported status values from persisted rows", async () => {
    const client = new FakePostgresClient();
    client.queueResponse([
      {
        delivery_id: "delivery-bad-status-row",
        provider: "github",
        event_name: "pull_request",
        status: "bogus",
      },
    ]);
    const store = new PostgresWebhookEventStore(client);

    await expect(() =>
      store.getByDeliveryId("delivery-bad-status-row"),
    ).rejects.toThrow(/unsupported webhook event status/i);
  });

  it("supports all configured webhook providers", async () => {
    const client = new FakePostgresClient();
    client.queueResponse([
      {
        delivery_id: "delivery-github",
        provider: "github",
        event_name: "pull_request",
        status: "queued",
      },
    ]);
    const store = new PostgresWebhookEventStore(client);

    await expect(store.getByDeliveryId("delivery-github")).resolves.toEqual({
      deliveryId: "delivery-github",
      provider: "github",
      eventName: "pull_request",
      status: "queued",
    });
  });

  it("creates and updates webhook events", async () => {
    const client = new FakePostgresClient();
    const store = new PostgresWebhookEventStore(client);

    await store.createEvent({
      deliveryId: "delivery-2",
      provider: "github",
      eventName: "issue_comment",
      status: "received",
      payload: { action: "created" },
    });
    client.queueResponse([{ delivery_id: "delivery-2" }]);
    await store.updateEvent({
      deliveryId: "delivery-2",
      status: "queued",
      repositoryId: "github:99",
    });

    expect(client.calls[0]?.query).toContain("insert into webhook_events");
    expect(client.calls[0]?.params?.[1]).toBe("github");
    expect(client.calls[1]?.query).toContain("update webhook_events");
  });

  it("throws when updateEvent targets an unknown delivery id", async () => {
    const client = new FakePostgresClient();
    client.queueResponse([]);
    const store = new PostgresWebhookEventStore(client);

    await expect(() =>
      store.updateEvent({
        deliveryId: "missing-delivery",
        status: "queued",
      }),
    ).rejects.toBeInstanceOf(WebhookEventNotFoundError);
  });

  it("rejects empty identifiers before querying", async () => {
    const client = new FakePostgresClient();
    const store = new PostgresWebhookEventStore(client);

    await expect(() => store.getByDeliveryId("")).rejects.toThrow(
      /deliveryId/i,
    );
    await expect(() =>
      store.createEvent({
        deliveryId: "delivery-3",
        provider: "github",
        eventName: "",
        status: "received",
        payload: {},
      }),
    ).rejects.toThrow(/eventName/i);
    await expect(() =>
      store.updateEvent({
        deliveryId: "delivery-3",
        status: "queued",
        repositoryId: "",
      }),
    ).rejects.toThrow(/repositoryId/i);
  });

  it("rejects unsupported webhook event statuses before writing", async () => {
    const client = new FakePostgresClient();
    const store = new PostgresWebhookEventStore(client);

    await expect(() =>
      store.createEvent({
        deliveryId: "delivery-bad-status",
        provider: "github",
        eventName: "pull_request",
        status: "bogus" as never,
        payload: {},
      }),
    ).rejects.toThrow(/unsupported webhook event status/i);

    await expect(() =>
      store.updateEvent({
        deliveryId: "delivery-bad-status",
        status: "bogus" as never,
      }),
    ).rejects.toThrow(/unsupported webhook event status/i);
  });

  it("adds context when database writes fail", async () => {
    const client = new FakePostgresClient();
    client.queueError(new Error("db unavailable"));
    const store = new PostgresWebhookEventStore(client);

    const writeAttempt = store.createEvent({
      deliveryId: "delivery-4",
      provider: "github",
      eventName: "pull_request",
      status: "received",
      payload: {},
    });

    await expect(writeAttempt).rejects.toThrow(/create webhook event/i);
    await expect(writeAttempt).rejects.toBeInstanceOf(WebhookEventStoreError);
  });

  it("maps duplicate key violations to a typed already-exists error", async () => {
    const client = new FakePostgresClient();
    client.queueError(
      Object.assign(
        new Error("duplicate key value violates unique constraint"),
        {
          code: "23505",
        },
      ),
    );
    const store = new PostgresWebhookEventStore(client);

    await expect(() =>
      store.createEvent({
        deliveryId: "delivery-duplicate",
        provider: "github",
        eventName: "pull_request",
        status: "received",
        payload: {},
      }),
    ).rejects.toBeInstanceOf(WebhookEventAlreadyExistsError);
  });

  it("does not leak raw database error details to callers", async () => {
    const client = new FakePostgresClient();
    client.queueError(new Error("password authentication failed for user"));
    const store = new PostgresWebhookEventStore(client);

    await expect(() =>
      store.createEvent({
        deliveryId: "delivery-4b",
        provider: "github",
        eventName: "pull_request",
        status: "received",
        payload: {},
      }),
    ).rejects.toThrow(/^Failed to create webhook event$/);
  });

  it("adds context when database updates fail", async () => {
    const client = new FakePostgresClient();
    client.queueError(new Error("db unavailable"));
    const store = new PostgresWebhookEventStore(client);

    await expect(() =>
      store.updateEvent({
        deliveryId: "delivery-5",
        status: "failed",
        errorMessage: "boom",
      }),
    ).rejects.toThrow(/update webhook event/i);
  });
});
