import type { RuntimeSecrets } from "../config/app-config.js";
import type { RuntimeConfigStore } from "./runtime-config-service.js";
import type { SecretCrypto } from "./secret-crypto.js";

export interface PostgresRuntimeConfigClient {
  unsafe<T extends Record<string, unknown>>(
    query: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
}

export class PostgresRuntimeConfigStore implements RuntimeConfigStore {
  readonly #client: PostgresRuntimeConfigClient;
  readonly #crypto: SecretCrypto;

  constructor(client: PostgresRuntimeConfigClient, crypto: SecretCrypto) {
    this.#client = client;
    this.#crypto = crypto;
  }

  async loadRuntimeSecrets(): Promise<RuntimeSecrets | null> {
    const rows = await this.#client.unsafe<Record<string, unknown>>(
      `
        select encrypted_runtime_secrets
        from app_runtime_config
        where singleton_key = 'default'
        limit 1
      `,
    );

    const encryptedValue = rows[0]?.encrypted_runtime_secrets;
    const encrypted =
      typeof encryptedValue === "string" ? encryptedValue : null;
    if (encrypted === null) {
      return null;
    }

    return this.#crypto.decryptJson<RuntimeSecrets>(encrypted);
  }

  async saveRuntimeSecrets(input: RuntimeSecrets): Promise<void> {
    await this.#client.unsafe(
      `
        insert into app_runtime_config (
          singleton_key,
          encrypted_runtime_secrets,
          updated_at
        )
        values ('default', $1, now())
        on conflict (singleton_key) do update set
          encrypted_runtime_secrets = excluded.encrypted_runtime_secrets,
          updated_at = now()
      `,
      [this.#crypto.encryptJson(input)],
    );
  }
}
