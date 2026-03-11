import { describe, expect, it } from "vitest";

import {
  MigrateCommand,
  runMigrationsWithAdvisoryLock,
} from "../../src/cli/migrate-command.js";

class FakeSqlClient {
  readonly executed: string[] = [];

  async unsafe(query: string): Promise<unknown[]> {
    this.executed.push(query);
    return [];
  }
}

class FakeTransactionalSqlClient extends FakeSqlClient {
  beginCalls = 0;

  async begin<T>(callback: (client: FakeSqlClient) => Promise<T>): Promise<T> {
    this.beginCalls += 1;
    return callback(this);
  }
}

describe("MigrateCommand", () => {
  it("applies migrations in order", async () => {
    const client = new FakeSqlClient();
    const command = new MigrateCommand(client);

    await command.run();

    expect(client.executed[0]).toContain("create table if not exists jobs");
    expect(client.executed[1]).toContain("create table if not exists memories");
  });

  it("runs migrations inside a transaction-scoped advisory lock", async () => {
    const client = new FakeTransactionalSqlClient();

    await runMigrationsWithAdvisoryLock(client);

    expect(client.beginCalls).toBe(1);
    expect(client.executed[0]).toContain("select pg_advisory_xact_lock(");
    expect(client.executed[1]).toContain("create table if not exists jobs");
  });
});
