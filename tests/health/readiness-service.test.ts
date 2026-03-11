import { describe, expect, it } from "vitest";

import { ReadinessService } from "../../src/health/readiness-service.js";

describe("ReadinessService", () => {
  it("reports setup_required while onboarding is incomplete", async () => {
    const service = new ReadinessService({
      runtimeConfigService: {
        async getSetupStatus() {
          return {
            state: "setup_required" as const,
            openAiConfigured: false,
            githubAppConfigured: false,
            ready: false,
          };
        },
      },
      workerHeartbeatService: {
        async hasFreshHeartbeat() {
          return false;
        },
      },
      pingDatabase: async () => undefined,
    });

    await expect(service.getStatus()).resolves.toEqual({
      ok: false,
      state: "setup_required",
      checks: {
        database: true,
        setup: false,
        worker: false,
      },
      reasons: ["Nitpickr setup is incomplete."],
    });
  });

  it("reports ready only when the database, setup, and worker heartbeat are healthy", async () => {
    const service = new ReadinessService({
      runtimeConfigService: {
        async getSetupStatus() {
          return {
            state: "ready" as const,
            openAiConfigured: true,
            githubAppConfigured: true,
            ready: true,
          };
        },
      },
      workerHeartbeatService: {
        async hasFreshHeartbeat() {
          return true;
        },
      },
      pingDatabase: async () => undefined,
    });

    await expect(service.getStatus()).resolves.toEqual({
      ok: true,
      state: "ready",
      checks: {
        database: true,
        setup: true,
        worker: true,
      },
      reasons: [],
    });
  });
});
