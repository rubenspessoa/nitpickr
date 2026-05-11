import { describe, expect, it } from "vitest";

import { PostgresMemoryStore } from "../../src/memory/postgres-memory-store.js";

class FakePostgresClient {
  readonly calls: Array<{
    query: string;
    params: readonly unknown[] | undefined;
  }> = [];
  readonly responses: unknown[][] = [];

  queueResponse(rows: unknown[]): void {
    this.responses.push(rows);
  }

  async unsafe<T extends Record<string, unknown>>(
    query: string,
    params?: readonly unknown[],
  ): Promise<T[]> {
    this.calls.push({ query, params });
    return (this.responses.shift() ?? []) as T[];
  }
}

describe("PostgresMemoryStore", () => {
  it("saves memory entries", async () => {
    const client = new FakePostgresClient();
    const store = new PostgresMemoryStore(client);

    await store.save([
      {
        id: "memory_1",
        tenantId: "tenant_1",
        repositoryId: "repo_1",
        kind: "preferred_pattern",
        summary: "Prefer stable ordering.",
        path: "src/queue",
        tags: [],
        globs: [],
        confidence: 0.8,
        usageCount: 0,
        lastUsedAt: null,
        embedding: null,
        supersededBy: null,
        source: "discussion",
        createdAt: "2026-03-09T10:00:00.000Z",
        updatedAt: "2026-03-09T10:00:00.000Z",
      },
    ]);

    expect(client.calls[0]?.query).toContain("insert into memories");
  });

  it("lists repository-scoped memory entries", async () => {
    const client = new FakePostgresClient();
    client.queueResponse([
      {
        id: "memory_1",
        tenant_id: "tenant_1",
        repository_id: "repo_1",
        kind: "preferred_pattern",
        summary: "Prefer stable ordering.",
        path: "src/queue",
        confidence: 0.8,
        created_at: "2026-03-09T10:00:00.000Z",
        updated_at: "2026-03-09T10:00:00.000Z",
      },
    ]);
    const store = new PostgresMemoryStore(client);

    const entries = await store.listByRepository({
      tenantId: "tenant_1",
      repositoryId: "repo_1",
    });

    expect(entries[0]?.summary).toContain("stable ordering");
  });
});
