export interface WorkerHeartbeatStore {
  recordHeartbeat(input: {
    workerId: string;
    status: "idle" | "ready" | "setup_required";
    recordedAt: Date;
  }): Promise<void>;
  hasFreshHeartbeat(since: Date): Promise<boolean>;
  listFreshWorkerIds(since: Date): Promise<string[]>;
}

export class WorkerHeartbeatService {
  readonly #store: WorkerHeartbeatStore;

  constructor(store: WorkerHeartbeatStore) {
    this.#store = store;
  }

  async recordHeartbeat(input: {
    workerId: string;
    status: "idle" | "ready" | "setup_required";
    recordedAt?: Date;
  }): Promise<void> {
    await this.#store.recordHeartbeat({
      ...input,
      recordedAt: input.recordedAt ?? new Date(),
    });
  }

  async hasFreshHeartbeat(maxAgeMs: number): Promise<boolean> {
    return this.#store.hasFreshHeartbeat(new Date(Date.now() - maxAgeMs));
  }

  async listFreshWorkerIds(maxAgeMs: number): Promise<string[]> {
    return this.#store.listFreshWorkerIds(new Date(Date.now() - maxAgeMs));
  }
}
