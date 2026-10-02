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

  it("uses the configured embedding dimension and re-shapes on change", async () => {
    const client = new FakeSqlClient();

    await new MigrateCommand(client, { embeddingDimensions: 768 }).run();

    const joined = client.executed.join("\n");
    expect(joined).toContain("embedding vector(768)");
    expect(joined).not.toContain("vector(1536)");
    expect(joined).toContain("atttypmod <> 768");
    expect(joined).toContain(
      "alter column embedding type vector(768) using null",
    );
  });

  it("defaults to 1536-dimension embeddings", async () => {
    const client = new FakeSqlClient();

    await new MigrateCommand(client).run();

    expect(client.executed.join("\n")).toContain("embedding vector(1536)");
  });

  it("rejects invalid embedding dimensions", () => {
    expect(
      () => new MigrateCommand(new FakeSqlClient(), { embeddingDimensions: 0 }),
    ).toThrow(/positive integer/);
  });
});
