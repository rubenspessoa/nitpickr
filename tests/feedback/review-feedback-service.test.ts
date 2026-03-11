import { describe, expect, it } from "vitest";

import { ReviewFeedbackService } from "../../src/feedback/review-feedback-service.js";

class InMemoryReviewFeedbackStore {
  entries: Array<Record<string, unknown>> = [];

  async save(entries: Array<Record<string, unknown>>): Promise<void> {
    for (const entry of entries) {
      const existingIndex = this.entries.findIndex(
        (candidate) =>
          candidate.repositoryId === entry.repositoryId &&
          candidate.scopeKey === entry.scopeKey,
      );
      if (existingIndex >= 0) {
        this.entries.splice(existingIndex, 1, entry);
      } else {
        this.entries.push(entry);
      }
    }
  }

  async listByRepository(input: {
    tenantId: string;
    repositoryId: string;
  }): Promise<Array<Record<string, unknown>>> {
    return this.entries.filter(
      (entry) =>
        entry.tenantId === input.tenantId &&
        entry.repositoryId === input.repositoryId,
    );
  }
}

describe("ReviewFeedbackService", () => {
  it("syncs reaction counts as passive ranking signals", async () => {
    const store = new InMemoryReviewFeedbackStore();
    const service = new ReviewFeedbackService(store as never, {
      now: () => new Date("2026-03-11T12:00:00.000Z"),
      createId: () => "feedback_1",
    });

    await service.syncCommentReactions({
      tenantId: "tenant_1",
      repositoryId: "repo_1",
      comments: [
        {
          providerCommentId: "comment_1",
          fingerprint: "src/api/server.ts:27:correctness:guard_the_parse",
          path: "src/api/server.ts",
          category: "correctness",
          findingType: "bug",
          positiveCount: 2,
          negativeCount: 1,
        },
      ],
    });

    const signals = await service.getSignals({
      tenantId: "tenant_1",
      repositoryId: "repo_1",
      paths: ["src/api/server.ts"],
      limit: 10,
    });

    expect(signals).toContainEqual(
      expect.objectContaining({
        fingerprint: "src/api/server.ts:27:correctness:guard_the_parse",
        path: "src/api/server.ts",
        category: "correctness",
        findingType: "bug",
        score: 1,
      }),
    );
    expect(store.entries.map((entry) => entry.scopeKey)).toEqual([
      "reaction_positive:comment_1",
      "reaction_negative:comment_1",
    ]);
  });

  it("turns resolved-without-code-change outcomes into suppression signals", async () => {
    const store = new InMemoryReviewFeedbackStore();
    const service = new ReviewFeedbackService(store as never, {
      now: () => new Date("2026-03-11T12:00:00.000Z"),
      createId: (() => {
        let count = 0;
        return () => `feedback_${++count}`;
      })(),
    });

    await service.recordOutcome({
      tenantId: "tenant_1",
      repositoryId: "repo_1",
      events: [
        {
          fingerprint: "src/api/server.ts:27:correctness:guard_the_parse",
          path: "src/api/server.ts",
          category: "correctness",
          findingType: "bug",
          kind: "resolved_without_code_change",
        },
      ],
    });

    const signals = await service.getSignals({
      tenantId: "tenant_1",
      repositoryId: "repo_1",
      paths: ["src/api/server.ts"],
      limit: 10,
    });

    expect(signals).toContainEqual(
      expect.objectContaining({
        fingerprint: "src/api/server.ts:27:correctness:guard_the_parse",
        suppress: true,
      }),
    );
  });

  it("keeps null-identity records from collapsing into the same signal", async () => {
    const store = new InMemoryReviewFeedbackStore();
    const service = new ReviewFeedbackService(store as never, {
      now: () => new Date("2026-03-11T12:00:00.000Z"),
      createId: (() => {
        let count = 0;
        return () => `feedback_${++count}`;
      })(),
    });

    await store.save([
      {
        id: "feedback_1",
        tenantId: "tenant_1",
        repositoryId: "repo_1",
        scopeKey: "ignored:src/api/server.ts:_:_",
        providerCommentId: null,
        fingerprint: null,
        path: "src/api/server.ts",
        category: null,
        findingType: null,
        kind: "ignored",
        count: 1,
        createdAt: "2026-03-11T12:00:00.000Z",
        updatedAt: "2026-03-11T12:00:00.000Z",
      },
      {
        id: "feedback_2",
        tenantId: "tenant_1",
        repositoryId: "repo_1",
        scopeKey: "resolved_without_code_change:fallback_2",
        providerCommentId: null,
        fingerprint: null,
        path: null,
        category: null,
        findingType: null,
        kind: "resolved_without_code_change",
        count: 1,
        createdAt: "2026-03-11T12:00:00.000Z",
        updatedAt: "2026-03-11T12:00:00.000Z",
      },
    ]);

    const signals = await service.getSignals({
      tenantId: "tenant_1",
      repositoryId: "repo_1",
      paths: ["src/api/server.ts"],
      limit: 10,
    });

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      path: "src/api/server.ts",
      suppress: true,
    });
  });
});
