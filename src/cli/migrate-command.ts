import { type MigrationOptions, buildMigrations } from "../db/migrations.js";

export interface SqlMigrationClient {
  unsafe(query: string): Promise<unknown[]>;
}

export interface SqlMigrationLockClient extends SqlMigrationClient {
  begin<T>(callback: (client: SqlMigrationClient) => Promise<T>): Promise<T>;
}

const migrationAdvisoryLockKey = 1_864_513_742;

export class MigrateCommand {
  readonly #client: SqlMigrationClient;
  readonly #migrations: string[];

  constructor(client: SqlMigrationClient, options: MigrationOptions = {}) {
    this.#client = client;
    this.#migrations = buildMigrations(options);
  }

  async run(): Promise<void> {
    for (const migration of this.#migrations) {
      await this.#client.unsafe(migration);
    }
  }
}

export async function runMigrationsWithAdvisoryLock(
  client: SqlMigrationLockClient,
  options: MigrationOptions = {},
): Promise<void> {
  await client.begin(async (transaction) => {
    await transaction.unsafe(
      `select pg_advisory_xact_lock(${migrationAdvisoryLockKey})`,
    );

    const command = new MigrateCommand(transaction, options);
    await command.run();
  });
}
