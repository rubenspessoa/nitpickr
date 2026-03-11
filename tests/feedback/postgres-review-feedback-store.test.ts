import { describe, expect, it } from "vitest";

import { PostgresReviewFeedbackStore } from "../../src/feedback/postgres-review-feedback-store.js";

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

describe("PostgresReviewFeedbackStore", () => {
  it("saves feedback records", async () => {
    const client = new FakePostgresClient();
    const store = new PostgresReviewFeedbackStore(client);

    await store.save([
      {
        id: "feedback_1",
        tenantId: "tenant_1",
        repositoryId: "repo_1",
        scopeKey: "comment_1",
        providerCommentId: "comment_1",
        fingerprint: "src/api/server.ts:27:correctness:guard_the_parse",
        path: "src/api/server.ts",
        category: "correctness",
        findingType: "bug",
        kind: "reaction_positive",
        count: 2,
        createdAt: "2026-03-11T12:00:00.000Z",
        updatedAt: "2026-03-11T12:00:00.000Z",
      },
      {
        id: "feedback_2",
        tenantId: "tenant_1",
        repositoryId: "repo_1",
        scopeKey: "reaction_negative:comment_1",
        providerCommentId: "comment_1",
        fingerprint: "src/api/server.ts:27:correctness:guard_the_parse",
        path: "src/api/server.ts",
        category: "correctness",
        findingType: "bug",
        kind: "reaction_negative",
        count: 1,
        createdAt: "2026-03-11T12:00:00.000Z",
        updatedAt: "2026-03-11T12:00:00.000Z",
      },
    ]);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.query).toContain(
      "insert into review_feedback_events",
    );
    expect(client.calls[0]?.query).toContain("values ($1, $2, $3");
    expect(client.calls[0]?.query).toContain("($14, $15, $16");
    expect(client.calls[0]?.query).toContain(
      "on conflict (repository_id, scope_key) do update set",
    );
    expect(client.calls[0]?.query).toContain("kind = excluded.kind");
    expect(client.calls[0]?.params).toHaveLength(26);
  });

  it("lists repository-scoped feedback records", async () => {
    const client = new FakePostgresClient();
    client.queueResponse([
      {
        id: "feedback_1",
        tenant_id: "tenant_1",
        repository_id: "repo_1",
        scope_key: "comment_1",
        provider_comment_id: "comment_1",
        fingerprint: "src/api/server.ts:27:correctness:guard_the_parse",
        path: "src/api/server.ts",
        category: "correctness",
        finding_type: "bug",
        kind: "reaction_positive",
        count: 2,
        created_at: "2026-03-11T12:00:00.000Z",
        updated_at: "2026-03-11T12:00:00.000Z",
      },
    ]);
    const store = new PostgresReviewFeedbackStore(client);

    const records = await store.listByRepository({
      tenantId: "tenant_1",
      repositoryId: "repo_1",
    });

    expect(records[0]?.fingerprint).toBe(
      "src/api/server.ts:27:correctness:guard_the_parse",
    );
  });
});
