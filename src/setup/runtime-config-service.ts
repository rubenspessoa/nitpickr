import type { RuntimeSecrets } from "../config/app-config.js";

export interface SetupStatus {
  state: "setup_required" | "ready";
  modelConfigured: boolean;
  githubAppConfigured: boolean;
  ready: boolean;
}

export interface RuntimeConfigStore {
  loadRuntimeSecrets(): Promise<RuntimeSecrets | null>;
  saveRuntimeSecrets(input: RuntimeSecrets): Promise<void>;
}

export class RuntimeConfigService {
  readonly #store: RuntimeConfigStore | null;
  readonly #environmentSecrets: RuntimeSecrets | null;
  readonly #modelConfigured: boolean;

  constructor(
    store: RuntimeConfigStore | null,
    environmentSecrets: RuntimeSecrets | null = null,
    options: { modelConfigured?: boolean } = {},
  ) {
    this.#store = store;
    this.#environmentSecrets = environmentSecrets;
    this.#modelConfigured = options.modelConfigured ?? true;
  }

  async loadRuntimeSecrets(): Promise<RuntimeSecrets | null> {
    if (this.#environmentSecrets) {
      return this.#environmentSecrets;
    }

    if (!this.#store) {
      return null;
    }

    return this.#store.loadRuntimeSecrets();
  }

  async saveRuntimeSecrets(input: RuntimeSecrets): Promise<void> {
    if (!this.#store) {
      throw new Error(
        "Runtime config persistence is unavailable because NITPICKR_SECRET_KEY is not configured.",
      );
    }

    await this.#store.saveRuntimeSecrets(input);
  }

  async getSetupStatus(): Promise<SetupStatus> {
    const secrets = await this.loadRuntimeSecrets();
    const modelConfigured = this.#modelConfigured;
    const githubAppConfigured = Boolean(
      secrets?.githubAppId &&
        secrets.githubPrivateKey &&
        secrets.githubWebhookSecret,
    );
    const ready = modelConfigured && githubAppConfigured;

    return {
      state: ready ? "ready" : "setup_required",
      modelConfigured,
      githubAppConfigured,
      ready,
    };
  }
}
