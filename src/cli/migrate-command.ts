import { migrations } from "../db/migrations.js";

export interface SqlMigrationClient {
  unsafe(query: string): Promise<unknown[]>;
}

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
