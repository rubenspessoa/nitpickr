import { describe, expect, it } from "vitest";

import {
  WorkerHeartbeatService,
  type WorkerHeartbeatStore,
} from "../../src/health/worker-heartbeat-service.js";

class InMemoryWorkerHeartbeatStore implements WorkerHeartbeatStore {
  readonly calls: Array<{
    workerId: string;
    status: "idle" | "ready" | "setup_required";
    recordedAt: Date;
  }> = [];

  async recordHeartbeat(input: {
    workerId: string;
    status: "idle" | "ready" | "setup_required";
    recordedAt: Date;
  }): Promise<void> {
    this.calls.push(input);
  }

  async hasFreshHeartbeat(): Promise<boolean> {
    return true;
  }

  async listFreshWorkerIds(): Promise<string[]> {
    return ["worker-1"];
  }
}

describe("WorkerHeartbeatService", () => {
  it("records heartbeats and lists fresh workers", async () => {
    const store = new InMemoryWorkerHeartbeatStore();
    const service = new WorkerHeartbeatService(store);

    await service.recordHeartbeat({
      workerId: "worker-1",
      status: "ready",
      recordedAt: new Date("2026-03-09T10:00:00.000Z"),
    });

    await expect(service.hasFreshHeartbeat(20_000)).resolves.toBe(true);
    await expect(service.listFreshWorkerIds(20_000)).resolves.toEqual([
      "worker-1",
    ]);
    expect(store.calls).toHaveLength(1);
  });
});
