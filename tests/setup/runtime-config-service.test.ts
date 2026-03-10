import { describe, expect, it } from "vitest";

import type { RuntimeSecrets } from "../../src/config/app-config.js";
import {
  RuntimeConfigService,
  type RuntimeConfigStore,
} from "../../src/setup/runtime-config-service.js";

class InMemoryRuntimeConfigStore implements RuntimeConfigStore {
  runtimeSecrets: RuntimeSecrets | null = null;

  async loadRuntimeSecrets() {
    return this.runtimeSecrets;
  }

  async saveRuntimeSecrets(input: NonNullable<typeof this.runtimeSecrets>) {
    this.runtimeSecrets = input;
  }
}

describe("RuntimeConfigService", () => {
  it("reports setup_required when no runtime secrets are available", async () => {
    const service = new RuntimeConfigService(new InMemoryRuntimeConfigStore());

    await expect(service.getSetupStatus()).resolves.toEqual({
      state: "setup_required",
      openAiConfigured: false,
      githubAppConfigured: false,
      ready: false,
    });
  });

  it("stores and reloads runtime secrets", async () => {
    const store = new InMemoryRuntimeConfigStore();
    const service = new RuntimeConfigService(store);

    await service.saveRuntimeSecrets({
      openAiApiKey: "sk-test-key",
      githubAppId: 123456,
      githubPrivateKey:
        "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      githubWebhookSecret: "webhook-secret",
      githubBotLogins: ["getnitpickr"],
    });

    await expect(service.loadRuntimeSecrets()).resolves.toEqual({
      openAiApiKey: "sk-test-key",
      githubAppId: 123456,
      githubPrivateKey:
        "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      githubWebhookSecret: "webhook-secret",
      githubBotLogins: ["getnitpickr"],
    });

    await expect(service.getSetupStatus()).resolves.toEqual({
      state: "ready",
      openAiConfigured: true,
      githubAppConfigured: true,
      ready: true,
    });
  });
});
