import { describe, expect, it } from "vitest";

import type { ChangeRequest, ReviewTrigger } from "../../src/domain/types.js";
import {
  type PersistedDiscussionEvent,
  type PersistedReviewRun,
  ReviewLifecycleService,
  type ReviewLifecycleStore,
} from "../../src/review/review-lifecycle-service.js";

class FakeReviewLifecycleStore implements ReviewLifecycleStore {
  readonly changeRequests: ChangeRequest[] = [];
  readonly reviewRuns: PersistedReviewRun[] = [];
  readonly completedRuns: Array<Record<string, unknown>> = [];
  readonly failedRuns: Array<Record<string, unknown>> = [];
  readonly discussionEvents: PersistedDiscussionEvent[] = [];
  readonly supersededRuns: Array<Record<string, unknown>> = [];

  async upsertChangeRequest(changeRequest: ChangeRequest): Promise<void> {
    this.changeRequests.push(changeRequest);
  }

  async createReviewRun(reviewRun: PersistedReviewRun): Promise<void> {
    this.reviewRuns.push(reviewRun);
  }

  async supersedePreviousRuns(input: Record<string, unknown>): Promise<number> {
    this.supersededRuns.push(input);
    return 1;
  }

  async completeReviewRun(input: Record<string, unknown>): Promise<void> {
    this.completedRuns.push(input);
  }

  async failReviewRun(input: Record<string, unknown>): Promise<void> {
    this.failedRuns.push(input);
  }

  async saveDiscussionEvents(
    events: PersistedDiscussionEvent[],
  ): Promise<void> {
    this.discussionEvents.push(...events);
  }
}

const changeRequest: ChangeRequest = {
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
};

const trigger: ReviewTrigger = {
  type: "manual_command",
  command: "review",
  actorLogin: "ruben",
};

describe("ReviewLifecycleService", () => {
  it("starts a running review and snapshots discussion inputs", async () => {
    const store = new FakeReviewLifecycleStore();
    const service = new ReviewLifecycleService(store, {
      now: () => new Date("2026-03-09T10:00:00.000Z"),
      createId: (() => {
        const ids = ["review_run_1", "discussion_1", "discussion_2"];
        return () => ids.shift() ?? "generated_id";
      })(),
    });

    const reviewRunId = await service.startReview({
      tenantId: changeRequest.tenantId,
      repositoryId: changeRequest.repositoryId,
      changeRequest,
      trigger,
      mode: "quick",
      budgets: {
        maxFiles: 50,
        maxHunks: 200,
        maxTokens: 120000,
        maxComments: 20,
        maxDurationMs: 300000,
      },
      discussionSnapshot: [
        {
          authorLogin: "maintainer",
          body: "Please keep stable ordering here.",
          path: "src/queue/queue-scheduler.ts",
          line: 12,
          providerCreatedAt: "2026-03-09T09:59:00.000Z",
        },
      ],
    });

    expect(reviewRunId).toBe("review_run_1");
    expect(store.changeRequests).toEqual([changeRequest]);
    expect(store.reviewRuns[0]).toMatchObject({
      id: "review_run_1",
      tenantId: changeRequest.tenantId,
      repositoryId: changeRequest.repositoryId,
      changeRequestId: changeRequest.id,
      trigger,
      mode: "quick",
      headSha: changeRequest.headSha,
      status: "running",
    });
    expect(store.supersededRuns[0]).toMatchObject({
      changeRequestId: changeRequest.id,
      reviewRunId: "review_run_1",
    });
    expect(store.discussionEvents[0]).toMatchObject({
      id: "discussion_1",
      tenantId: changeRequest.tenantId,
      repositoryId: changeRequest.repositoryId,
      changeRequestId: changeRequest.id,
      authorLogin: "maintainer",
      path: "src/queue/queue-scheduler.ts",
      line: 12,
      body: "Please keep stable ordering here.",
      source: "review_snapshot",
      providerCreatedAt: "2026-03-09T09:59:00.000Z",
    });
  });

  it("completes reviews and persists findings and published comments", async () => {
    const store = new FakeReviewLifecycleStore();
    const service = new ReviewLifecycleService(store, {
      now: () => new Date("2026-03-09T10:05:00.000Z"),
      createId: (() => {
        const ids = ["finding_1", "comment_1"];
        return () => ids.shift() ?? "generated_id";
      })(),
    });

    await service.completeReview({
      reviewRunId: "review_run_1",
      repositoryId: changeRequest.repositoryId,
      status: "published",
      publishedReviewId: "github_review_1",
      result: {
        summary: "Queue fairness improved.",
        mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
        findings: [
          {
            path: "src/queue/queue-scheduler.ts",
            line: 24,
            severity: "medium",
            category: "performance",
            title: "Avoid rescanning running jobs",
            body: "The scheduler recomputes tenant load on every pass.",
            fixPrompt: "Use a cached tenant count map during claim selection.",
            suggestedChange:
              "const tenantCounts = buildTenantCountMap(runningJobs);",
          },
        ],
      },
      publishedComments: [
        {
          path: "src/queue/queue-scheduler.ts",
          line: 24,
          body: "**Avoid rescanning running jobs**",
        },
      ],
    });

    expect(store.completedRuns[0]).toMatchObject({
      reviewRunId: "review_run_1",
      status: "published",
      publishedReviewId: "github_review_1",
      summary: "Queue fairness improved.",
      mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
      completedAt: "2026-03-09T10:05:00.000Z",
    });
    expect(store.completedRuns[0]?.findings).toEqual([
      {
        id: "finding_1",
        reviewRunId: "review_run_1",
        repositoryId: changeRequest.repositoryId,
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
    ]);
    expect(store.completedRuns[0]?.publishedComments).toEqual([
      {
        id: "comment_1",
        reviewRunId: "review_run_1",
        publishedReviewId: "github_review_1",
        path: "src/queue/queue-scheduler.ts",
        line: 24,
        body: "**Avoid rescanning running jobs**",
        createdAt: "2026-03-09T10:05:00.000Z",
      },
    ]);
  });

  it("marks failed reviews with an error message", async () => {
    const store = new FakeReviewLifecycleStore();
    const service = new ReviewLifecycleService(store, {
      now: () => new Date("2026-03-09T10:06:00.000Z"),
    });

    await service.failReview({
      reviewRunId: "review_run_1",
      errorMessage: "boom",
    });

    expect(store.failedRuns).toEqual([
      {
        reviewRunId: "review_run_1",
        errorMessage: "boom",
        completedAt: "2026-03-09T10:06:00.000Z",
      },
    ]);
  });
});
