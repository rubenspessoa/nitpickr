import { describe, expect, it } from "vitest";

import {
  type MemoryEntry,
  MemoryService,
  type MemoryStore,
} from "../../src/memory/memory-service.js";

class InMemoryMemoryStore implements MemoryStore {
  readonly entries: MemoryEntry[] = [];

  async save(entries: MemoryEntry[]): Promise<void> {
    this.entries.push(...entries);
  }

  async listByRepository(input: {
    tenantId: string;
    repositoryId: string;
  }): Promise<MemoryEntry[]> {
    return this.entries.filter(
      (entry) =>
        entry.tenantId === input.tenantId &&
        entry.repositoryId === input.repositoryId,
    );
  }
}

describe("MemoryService", () => {
  it("extracts durable preferences from discussion comments", async () => {
    const store = new InMemoryMemoryStore();
    const service = new MemoryService(store, {
      now: () => new Date("2026-03-09T10:00:00.000Z"),
      createId: () => "memory_1",
    });

    await service.ingestDiscussion({
      tenantId: "tenant_1",
      repositoryId: "repo_1",
      discussions: [
        {
          authorLogin: "maintainer",
          body: "Prefer stable ordering in queue implementations under src/queue.",
          path: "src/queue/queue-scheduler.ts",
        },
      ],
    });

    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]?.kind).toBe("preferred_pattern");
    expect(store.entries[0]?.summary).toContain("Prefer stable ordering");
  });

  it("extracts false positive feedback", async () => {
    const store = new InMemoryMemoryStore();
    const service = new MemoryService(store, {
      now: () => new Date("2026-03-09T10:00:00.000Z"),
      createId: () => "memory_1",
    });

    await service.ingestDiscussion({
      tenantId: "tenant_1",
      repositoryId: "repo_1",
      discussions: [
        {
          authorLogin: "maintainer",
          body: "This is a false positive; this path intentionally allows unstable ordering.",
          path: "src/queue/queue-scheduler.ts",
        },
      ],
    });

    expect(store.entries[0]?.kind).toBe("false_positive");
  });

  it("retrieves only path-relevant memories", async () => {
    const store = new InMemoryMemoryStore();
    store.entries.push(
      {
        id: "memory_1",
        tenantId: "tenant_1",
        repositoryId: "repo_1",
        kind: "preferred_pattern",
        summary: "Prefer stable ordering.",
        path: "src/queue",
        confidence: 0.9,
        createdAt: "2026-03-09T10:00:00.000Z",
        updatedAt: "2026-03-09T10:00:00.000Z",
      },
      {
        id: "memory_2",
        tenantId: "tenant_1",
        repositoryId: "repo_1",
        kind: "preferred_pattern",
        summary: "Use typed HTTP clients.",
        path: "src/api",
        confidence: 0.6,
        createdAt: "2026-03-09T10:00:00.000Z",
        updatedAt: "2026-03-09T10:00:00.000Z",
      },
    );
    const service = new MemoryService(store);

    const relevant = await service.getRelevantMemories({
      tenantId: "tenant_1",
      repositoryId: "repo_1",
      paths: ["src/queue/queue-scheduler.ts"],
      limit: 5,
    });

    expect(relevant).toHaveLength(1);
    expect(relevant[0]?.id).toBe("memory_1");
  });

  it("ignores non-durable discussion comments", async () => {
    const store = new InMemoryMemoryStore();
    const service = new MemoryService(store, {
      now: () => new Date("2026-03-09T10:00:00.000Z"),
      createId: () => "memory_1",
    });

    await service.ingestDiscussion({
      tenantId: "tenant_1",
      repositoryId: "repo_1",
      discussions: [
        {
          authorLogin: "maintainer",
          body: "Thanks, looks good.",
          path: null,
        },
      ],
    });

    expect(store.entries).toEqual([]);
  });
});
