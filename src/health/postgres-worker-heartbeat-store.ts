import type { WorkerHeartbeatStore } from "./worker-heartbeat-service.js";

export interface PostgresWorkerHeartbeatClient {
  unsafe<T extends Record<string, unknown>>(
    query: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
}

function wrapWorkerHeartbeatError(message: string, error: unknown): Error {
  const cause =
    error instanceof Error ? error.message : "Unknown database error.";
  return new Error(`${message}: ${cause}`);
}

export class PostgresWorkerHeartbeatStore implements WorkerHeartbeatStore {
  readonly #client: PostgresWorkerHeartbeatClient;

  constructor(client: PostgresWorkerHeartbeatClient) {
    this.#client = client;
  }

  async recordHeartbeat(input: {
    workerId: string;
    status: "idle" | "ready" | "setup_required";
    recordedAt: Date;
  }): Promise<void> {
    try {
      await this.#client.unsafe(
        `
          insert into worker_heartbeats (
            worker_id,
            status,
            last_seen_at,
            updated_at
          )
          values ($1, $2, $3, $3)
          on conflict (worker_id) do update set
            status = excluded.status,
            last_seen_at = excluded.last_seen_at,
            updated_at = excluded.updated_at
        `,
        [input.workerId, input.status, input.recordedAt],
      );
    } catch (error) {
      throw wrapWorkerHeartbeatError(
        "Failed to record worker heartbeat",
        error,
      );
    }
  }

  async hasFreshHeartbeat(since: Date): Promise<boolean> {
    let rows: Array<{ worker_id: string }>;
    try {
      rows = await this.#client.unsafe<{ worker_id: string }>(
        `
          select worker_id
          from worker_heartbeats
          where last_seen_at >= $1
          limit 1
        `,
        [since],
      );
    } catch (error) {
      throw wrapWorkerHeartbeatError("Failed to query worker heartbeat", error);
    }

    return rows.length > 0;
  }

  async listFreshWorkerIds(since: Date): Promise<string[]> {
    let rows: Array<{ worker_id: string }>;
    try {
      rows = await this.#client.unsafe<{ worker_id: string }>(
        `
          select worker_id
          from worker_heartbeats
          where last_seen_at >= $1
        `,
        [since],
      );
    } catch (error) {
      throw wrapWorkerHeartbeatError("Failed to query worker heartbeat", error);
    }

    return rows.map((row) => row.worker_id);
  }
}
