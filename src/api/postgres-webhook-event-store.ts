import type {
  WebhookEventRecord,
  WebhookEventStatus,
  WebhookEventStore,
} from "./webhook-event-service.js";

export interface PostgresWebhookEventClient {
  unsafe<T extends Record<string, unknown>>(
    query: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
}

export class PostgresWebhookEventStore implements WebhookEventStore {
  readonly #client: PostgresWebhookEventClient;

  constructor(client: PostgresWebhookEventClient) {
    this.#client = client;
  }

  async getByDeliveryId(
    deliveryId: string,
  ): Promise<WebhookEventRecord | null> {
    const rows = await this.#client.unsafe<Record<string, unknown>>(
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
      provider: "github",
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
    await this.#client.unsafe(
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
        JSON.stringify(input.payload),
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
    await this.#client.unsafe(
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
        input.payload === undefined ? null : JSON.stringify(input.payload),
      ],
    );
  }
}
