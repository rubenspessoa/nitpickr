import { describe, expect, it } from "vitest";

import { MigrateCommand } from "../../src/cli/migrate-command.js";

class FakeSqlClient {
  readonly executed: string[] = [];

  async unsafe(query: string): Promise<unknown[]> {
    this.executed.push(query);
    return [];
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
});
