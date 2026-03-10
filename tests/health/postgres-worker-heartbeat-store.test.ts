import { describe, expect, it } from "vitest";

import { PostgresWorkerHeartbeatStore } from "../../src/health/postgres-worker-heartbeat-store.js";

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
});
