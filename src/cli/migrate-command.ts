import { migrations } from "../db/migrations.js";

export interface SqlMigrationClient {
  unsafe(query: string): Promise<unknown[]>;
}

export interface SqlMigrationLockClient extends SqlMigrationClient {
  begin<T>(callback: (client: SqlMigrationClient) => Promise<T>): Promise<T>;
}

const migrationAdvisoryLockKey = 1_864_513_742;

export class MigrateCommand {
  readonly #client: SqlMigrationClient;

  constructor(client: SqlMigrationClient) {
    this.#client = client;
  }

  async run(): Promise<void> {
    for (const migration of migrations) {
      await this.#client.unsafe(migration);
    }
  }
}

export async function runMigrationsWithAdvisoryLock(
  client: SqlMigrationLockClient,
): Promise<void> {
  await client.begin(async (transaction) => {
    await transaction.unsafe(
      `select pg_advisory_xact_lock(${migrationAdvisoryLockKey})`,
    );

    const command = new MigrateCommand(transaction);
    await command.run();
  });
}
