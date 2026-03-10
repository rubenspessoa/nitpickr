import type { WorkerHeartbeatStore } from "./worker-heartbeat-service.js";

export interface PostgresWorkerHeartbeatClient {
  unsafe<T extends Record<string, unknown>>(
    query: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
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
  }

  async hasFreshHeartbeat(since: Date): Promise<boolean> {
    const rows = await this.#client.unsafe<{ worker_id: string }>(
      `
        select worker_id
        from worker_heartbeats
        where last_seen_at >= $1
        limit 1
      `,
      [since],
    );

    return rows.length > 0;
  }

  async listFreshWorkerIds(since: Date): Promise<string[]> {
    const rows = await this.#client.unsafe<{ worker_id: string }>(
      `
        select worker_id
        from worker_heartbeats
        where last_seen_at >= $1
      `,
      [since],
    );

    return rows.map((row) => row.worker_id);
  }
}
