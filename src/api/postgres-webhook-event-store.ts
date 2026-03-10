import type {
  WebhookEventRecord,
  WebhookEventStatus,
  WebhookEventStore,
} from "./webhook-event-service.js";

export interface PostgresWebhookEventClient {
  query<T extends Record<string, unknown>>(
    query: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }
}

function toJsonPayload(value: unknown): string {
  return JSON.stringify(value);
}

export class PostgresWebhookEventStore implements WebhookEventStore {
  readonly #client: PostgresWebhookEventClient;

  constructor(client: PostgresWebhookEventClient) {
    this.#client = client;
  }

  async getByDeliveryId(
    deliveryId: string,
  ): Promise<WebhookEventRecord | null> {
    assertNonEmpty(deliveryId, "deliveryId");

    const rows = await this.#client.query<Record<string, unknown>>(
      `
        select delivery_id, provider, event_name, status
        from webhook_events
        where delivery_id = $1
        limit 1
      `,
      [deliveryId],
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      deliveryId: String(row.delivery_id),
      provider: String(row.provider) as "github",
      eventName: String(row.event_name),
      status: String(row.status) as WebhookEventStatus,
    };
  }

  async createEvent(input: {
    deliveryId: string;
    provider: "github";
    eventName: string;
    status: WebhookEventStatus;
    payload: unknown;
  }): Promise<void> {
    assertNonEmpty(input.deliveryId, "deliveryId");
    assertNonEmpty(input.eventName, "eventName");

    await this.#client.query(
      `
        insert into webhook_events (
          delivery_id,
          provider,
          event_name,
          status,
          payload,
          received_at,
          updated_at
        )
        values ($1, $2, $3, $4, $5::jsonb, now(), now())
      `,
      [
        input.deliveryId,
        input.provider,
        input.eventName,
        input.status,
        toJsonPayload(input.payload),
      ],
    );
  }

  async updateEvent(input: {
    deliveryId: string;
    status: WebhookEventStatus;
    repositoryId?: string;
    changeRequestId?: string;
    errorMessage?: string;
    payload?: unknown;
  }): Promise<void> {
    assertNonEmpty(input.deliveryId, "deliveryId");
    if (input.repositoryId !== undefined) {
      assertNonEmpty(input.repositoryId, "repositoryId");
    }
    if (input.changeRequestId !== undefined) {
      assertNonEmpty(input.changeRequestId, "changeRequestId");
    }

    await this.#client.query(
      `
        update webhook_events
        set status = $2,
            repository_id = coalesce($3, repository_id),
            change_request_id = coalesce($4, change_request_id),
            error_message = $5,
            payload = coalesce($6::jsonb, payload),
            updated_at = now()
        where delivery_id = $1
      `,
      [
        input.deliveryId,
        input.status,
        input.repositoryId ?? null,
        input.changeRequestId ?? null,
        input.errorMessage ?? null,
        input.payload === undefined ? null : toJsonPayload(input.payload),
      ],
    );
  }
}
