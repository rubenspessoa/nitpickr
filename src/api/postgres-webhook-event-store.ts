import type {
  WebhookEventRecord,
  WebhookEventStatus,
  WebhookEventStore,
} from "./webhook-event-service.js";

export interface PostgresWebhookEventClient {
  // The client must execute placeholder-based parameterized SQL. Callers pass
  // the SQL text and arguments separately and never interpolate user input.
  executeParameterized<T extends Record<string, unknown>>(
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

function wrapWebhookEventStoreError(message: string, error: unknown): Error {
  const cause =
    error instanceof Error ? error.message : "Unknown database error.";
  return new Error(`${message}: ${cause}`);
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

    let rows: Array<Record<string, unknown>>;
    try {
      rows = await this.#client.executeParameterized<Record<string, unknown>>(
        `
          select delivery_id, provider, event_name, status
          from webhook_events
          where delivery_id = $1
          limit 1
        `,
        [deliveryId],
      );
    } catch (error) {
      throw wrapWebhookEventStoreError(
        "Failed to load webhook event by delivery id",
        error,
      );
    }

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

    try {
      await this.#client.executeParameterized(
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
    } catch (error) {
      throw wrapWebhookEventStoreError("Failed to create webhook event", error);
    }
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

    try {
      const rows = await this.#client.executeParameterized<{
        delivery_id: string;
      }>(
        `
          update webhook_events
          set status = $2,
              repository_id = coalesce($3, repository_id),
              change_request_id = coalesce($4, change_request_id),
              error_message = $5,
              payload = coalesce($6::jsonb, payload),
              updated_at = now()
          where delivery_id = $1
          returning delivery_id
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

      if (rows.length === 0) {
        throw new Error(
          `Webhook event with deliveryId ${input.deliveryId} was not found.`,
        );
      }
    } catch (error) {
      throw wrapWebhookEventStoreError("Failed to update webhook event", error);
    }
  }
}
