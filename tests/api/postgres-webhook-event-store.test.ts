import { describe, expect, it } from "vitest";

import { PostgresWebhookEventStore } from "../../src/api/postgres-webhook-event-store.js";

interface QueryCall {
  query: string;
  params: readonly unknown[] | undefined;
}

class FakePostgresClient {
  readonly calls: QueryCall[] = [];
  readonly responses: unknown[][] = [];

  queueResponse(rows: unknown[]): void {
    this.responses.push(rows);
  }

  async unsafe<T extends Record<string, unknown>>(
    query: string,
    params?: readonly unknown[],
  ): Promise<T[]> {
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
    await store.updateEvent({
      deliveryId: "delivery-2",
      status: "queued",
      repositoryId: "github:99",
    });

    expect(client.calls[0]?.query).toContain("insert into webhook_events");
    expect(client.calls[1]?.query).toContain("update webhook_events");
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
});
