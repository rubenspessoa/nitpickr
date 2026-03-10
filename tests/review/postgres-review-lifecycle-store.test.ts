import { describe, expect, it } from "vitest";

import { PostgresReviewLifecycleStore } from "../../src/review/postgres-review-lifecycle-store.js";

class FakePostgresClient {
  readonly calls: Array<{
    query: string;
    params: readonly unknown[] | undefined;
  }> = [];

  async unsafe<T extends Record<string, unknown>>(
    query: string,
    params?: readonly unknown[],
  ): Promise<T[]> {
    this.calls.push({ query, params });
    return [];
  }
}

describe("PostgresReviewLifecycleStore", () => {
  it("upserts change requests", async () => {
    const client = new FakePostgresClient();
    const store = new PostgresReviewLifecycleStore(client);

    await store.upsertChangeRequest({
      id: "github:99:42",
      tenantId: "github-installation:123456",
      installationId: "123456",
      repositoryId: "github:99",
      provider: "github",
      number: 42,
      title: "Improve queue fairness",
      baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      status: "open",
      authorLogin: "ruben",
    });

    expect(client.calls[0]?.query).toContain("insert into change_requests");
  });

  it("creates review runs", async () => {
    const client = new FakePostgresClient();
    const store = new PostgresReviewLifecycleStore(client);

    await store.createReviewRun({
      id: "review_run_1",
      tenantId: "github-installation:123456",
      repositoryId: "github:99",
      changeRequestId: "github:99:42",
      trigger: {
        type: "pr_opened",
        actorLogin: "ruben",
      },
      mode: "quick",
      headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      status: "running",
      budgets: {
        maxFiles: 50,
        maxHunks: 200,
        maxTokens: 120000,
        maxComments: 20,
        maxDurationMs: 300000,
      },
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
      completedAt: null,
    });

    expect(client.calls[0]?.query).toContain("insert into review_runs");
  });

  it("completes review runs and stores findings and comments", async () => {
    const client = new FakePostgresClient();
    const store = new PostgresReviewLifecycleStore(client);

    await store.completeReviewRun({
      reviewRunId: "review_run_1",
      status: "published",
      publishedReviewId: "github_review_1",
      summary: "Queue fairness improved.",
      mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
      completedAt: "2026-03-09T10:05:00.000Z",
      findings: [
        {
          id: "finding_1",
          reviewRunId: "review_run_1",
          repositoryId: "github:99",
          path: "src/queue/queue-scheduler.ts",
          line: 24,
          severity: "medium",
          category: "performance",
          title: "Avoid rescanning running jobs",
          body: "The scheduler recomputes tenant load on every pass.",
          fixPrompt: "Use a cached tenant count map during claim selection.",
          suggestedChange:
            "const tenantCounts = buildTenantCountMap(runningJobs);",
          createdAt: "2026-03-09T10:05:00.000Z",
        },
      ],
      publishedComments: [
        {
          id: "comment_1",
          reviewRunId: "review_run_1",
          publishedReviewId: "github_review_1",
          path: "src/queue/queue-scheduler.ts",
          line: 24,
          body: "**Avoid rescanning running jobs**",
          createdAt: "2026-03-09T10:05:00.000Z",
        },
      ],
    });

    expect(client.calls[0]?.query).toContain("update review_runs");
    expect(client.calls[1]?.query).toContain("insert into review_findings");
    expect(client.calls[1]?.query).toContain("suggested_change");
    expect(client.calls[2]?.query).toContain("insert into published_comments");
  });

  it("supersedes previous review runs for the same change request", async () => {
    const client = new FakePostgresClient();
    const store = new PostgresReviewLifecycleStore(client);

    const superseded = await store.supersedePreviousRuns({
      changeRequestId: "github:99:42",
      reviewRunId: "review_run_2",
      completedAt: "2026-03-09T10:06:00.000Z",
    });

    expect(superseded).toBe(0);
    expect(client.calls[0]?.query).toContain("update review_runs");
    expect(client.calls[0]?.query).toContain("status = 'superseded'");
  });

  it("marks review runs as failed", async () => {
    const client = new FakePostgresClient();
    const store = new PostgresReviewLifecycleStore(client);

    await store.failReviewRun({
      reviewRunId: "review_run_1",
      errorMessage: "boom",
      completedAt: "2026-03-09T10:06:00.000Z",
    });

    expect(client.calls[0]?.query).toContain("update review_runs");
    expect(client.calls[0]?.params).toContain("failed");
  });

  it("saves discussion events", async () => {
    const client = new FakePostgresClient();
    const store = new PostgresReviewLifecycleStore(client);

    await store.saveDiscussionEvents([
      {
        id: "discussion_1",
        tenantId: "github-installation:123456",
        repositoryId: "github:99",
        changeRequestId: "github:99:42",
        authorLogin: "maintainer",
        body: "Please keep stable ordering here.",
        path: "src/queue/queue-scheduler.ts",
        line: 12,
        source: "review_snapshot",
        providerCreatedAt: "2026-03-09T09:59:00.000Z",
        createdAt: "2026-03-09T10:00:00.000Z",
      },
    ]);

    expect(client.calls[0]?.query).toContain("insert into discussion_events");
  });
});
