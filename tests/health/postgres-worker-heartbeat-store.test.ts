import { describe, expect, it } from "vitest";

import { PostgresWorkerHeartbeatStore } from "../../src/health/postgres-worker-heartbeat-store.js";

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

  async unsafe<T extends Record<string, unknown>>(
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

describe("PostgresWorkerHeartbeatStore", () => {
  it("records worker heartbeats", async () => {
    const client = new FakePostgresClient();
    const store = new PostgresWorkerHeartbeatStore(client);

    await store.recordHeartbeat({
      workerId: "worker-1",
      status: "ready",
      recordedAt: new Date("2026-03-09T10:00:00.000Z"),
    });

    expect(client.calls[0]?.query).toContain("insert into worker_heartbeats");
  });

  it("checks and lists fresh worker heartbeats", async () => {
    const client = new FakePostgresClient();
    client.queueResponse([{ worker_id: "worker-1" }]);
    client.queueResponse([{ worker_id: "worker-1" }]);
    const store = new PostgresWorkerHeartbeatStore(client);

    await expect(
      store.hasFreshHeartbeat(new Date("2026-03-09T09:59:00.000Z")),
    ).resolves.toBe(true);
    await expect(
      store.listFreshWorkerIds(new Date("2026-03-09T09:59:00.000Z")),
    ).resolves.toEqual(["worker-1"]);
  });

  it("adds context when heartbeat persistence fails", async () => {
    const client = new FakePostgresClient();
    client.queueError(new Error("db unavailable"));
    const store = new PostgresWorkerHeartbeatStore(client);

    await expect(
      store.recordHeartbeat({
        workerId: "worker-1",
        status: "ready",
        recordedAt: new Date("2026-03-09T10:00:00.000Z"),
      }),
    ).rejects.toThrow(/record worker heartbeat/i);
  });

  it("adds context when heartbeat reads fail", async () => {
    const client = new FakePostgresClient();
    client.queueError(new Error("db unavailable"));
    const store = new PostgresWorkerHeartbeatStore(client);

    await expect(
      store.hasFreshHeartbeat(new Date("2026-03-09T09:59:00.000Z")),
    ).rejects.toThrow(/query worker heartbeat/i);
  });
});
