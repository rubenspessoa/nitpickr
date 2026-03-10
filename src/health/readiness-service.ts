import type {
  RuntimeConfigService,
  SetupStatus,
} from "../setup/runtime-config-service.js";
import type { WorkerHeartbeatService } from "./worker-heartbeat-service.js";

export interface ReadinessStatus {
  ok: boolean;
  state: "setup_required" | "ready";
  checks: {
    database: boolean;
    setup: boolean;
    worker: boolean;
  };
  reasons: string[];
}

export interface ReadinessServiceDependencies {
  runtimeConfigService: Pick<RuntimeConfigService, "getSetupStatus">;
  workerHeartbeatService: Pick<WorkerHeartbeatService, "hasFreshHeartbeat">;
  pingDatabase: () => Promise<void>;
  workerStaleAfterMs?: number;
}

function reasonsForSetupStatus(setupStatus: SetupStatus): string[] {
  if (setupStatus.state === "ready") {
    return [];
  }

  return ["Nitpickr setup is incomplete."];
}

export class ReadinessService {
  readonly #runtimeConfigService: ReadinessServiceDependencies["runtimeConfigService"];
  readonly #workerHeartbeatService: ReadinessServiceDependencies["workerHeartbeatService"];
  readonly #pingDatabase: ReadinessServiceDependencies["pingDatabase"];
  readonly #workerStaleAfterMs: number;

  constructor(input: ReadinessServiceDependencies) {
    this.#runtimeConfigService = input.runtimeConfigService;
    this.#workerHeartbeatService = input.workerHeartbeatService;
    this.#pingDatabase = input.pingDatabase;
    this.#workerStaleAfterMs = input.workerStaleAfterMs ?? 20_000;
  }

  async getStatus(): Promise<ReadinessStatus> {
    const reasons: string[] = [];
    let databaseReady = false;

    try {
      await this.#pingDatabase();
      databaseReady = true;
    } catch {
      reasons.push("Database connectivity check failed.");
    }

    const setupStatus = await this.#runtimeConfigService.getSetupStatus();
    if (setupStatus.state !== "ready") {
      reasons.push(...reasonsForSetupStatus(setupStatus));
    }

    const workerReady =
      setupStatus.state === "ready"
        ? await this.#workerHeartbeatService.hasFreshHeartbeat(
            this.#workerStaleAfterMs,
          )
        : false;

    if (setupStatus.state === "ready" && !workerReady) {
      reasons.push("No fresh worker heartbeat was observed.");
    }

    return {
      ok: databaseReady && setupStatus.state === "ready" && workerReady,
      state: setupStatus.state,
      checks: {
        database: databaseReady,
        setup: setupStatus.state === "ready",
        worker: workerReady,
      },
      reasons,
    };
  }
}
