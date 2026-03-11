import { describe, expect, it } from "vitest";

import { defaultRepositoryConfig } from "../../src/config/repository-config-loader.js";
import type { QueueJob } from "../../src/queue/queue-scheduler.js";
import type { PersistedReviewRun } from "../../src/review/review-lifecycle-service.js";
import { WorkerRunner } from "../../src/worker/worker-runner.js";

class FakeLogger {
  readonly entries: Array<{
    level: string;
    message: string;
    fields: Record<string, unknown>;
  }> = [];

  debug(message: string, fields: Record<string, unknown> = {}) {
    this.entries.push({ level: "debug", message, fields });
  }

  info(message: string, fields: Record<string, unknown> = {}) {
    this.entries.push({ level: "info", message, fields });
  }

  warn(message: string, fields: Record<string, unknown> = {}) {
    this.entries.push({ level: "warn", message, fields });
  }

  error(message: string, fields: Record<string, unknown> = {}) {
    this.entries.push({ level: "error", message, fields });
  }

  child(fields: Record<string, unknown>) {
    return {
      debug: (message: string, entryFields: Record<string, unknown> = {}) =>
        this.debug(message, { ...fields, ...entryFields }),
      info: (message: string, entryFields: Record<string, unknown> = {}) =>
        this.info(message, { ...fields, ...entryFields }),
      warn: (message: string, entryFields: Record<string, unknown> = {}) =>
        this.warn(message, { ...fields, ...entryFields }),
      error: (message: string, entryFields: Record<string, unknown> = {}) =>
        this.error(message, { ...fields, ...entryFields }),
      child: (childFields: Record<string, unknown>) =>
        this.child({ ...fields, ...childFields }),
    };
  }
}

class FakeQueueScheduler {
  readonly completed: string[] = [];
  readonly failed: Array<{ jobId: string; error: string }> = [];
  nextJobs: QueueJob[] = [];

  async claimNextJobs(): Promise<QueueJob[]> {
    return this.nextJobs;
  }

  async cancelSupersededReviewJobs() {
    return 0;
  }

  async completeJob(jobId: string): Promise<QueueJob> {
    this.completed.push(jobId);
    const job = this.nextJobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      throw new Error(`Unknown job ${jobId}`);
    }

    return {
      ...job,
      status: "completed",
      completedAt: new Date("2026-03-09T10:10:00.000Z"),
    };
  }

  async failJob(jobId: string, error: string): Promise<QueueJob> {
    this.failed.push({ jobId, error });
    const job = this.nextJobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      throw new Error(`Unknown job ${jobId}`);
    }

    return {
      ...job,
      status: "failed",
      lastError: error,
    };
  }
}

class FakeReviewLifecycleService {
  readonly started: Array<Record<string, unknown>> = [];
  readonly completed: Array<Record<string, unknown>> = [];
  readonly failed: Array<Record<string, unknown>> = [];
  readonly resolvedComments: string[][] = [];
  reviewRunId = "review_run_1";

  async startReview(input: Record<string, unknown>): Promise<string> {
    this.started.push(input);
    return this.reviewRunId;
  }

  async completeReview(input: Record<string, unknown>): Promise<void> {
    this.completed.push(input);
  }

  async failReview(input: Record<string, unknown>): Promise<void> {
    this.failed.push(input);
  }

  async getLatestCompletedReview(): Promise<PersistedReviewRun | null> {
    return null;
  }

  async markPublishedCommentsResolved(
    providerThreadIds: string[],
  ): Promise<number> {
    this.resolvedComments.push(providerThreadIds);
    return providerThreadIds.length;
  }
}

class FakeReviewPlanner {
  plan(input: {
    files: Array<{
      path: string;
      additions: number;
      deletions: number;
      patch: string | null;
    }>;
  }): {
    files: Array<{
      path: string;
      additions: number;
      deletions: number;
      patch: string | null;
    }>;
    summaryOnly: boolean;
    commentBudget: number;
    allowSuggestedChanges: boolean;
    skipReason: string | null;
    summaryOnlyReason: string | null;
  } {
    return {
      files: input.files,
      summaryOnly: false,
      commentBudget: 5,
      allowSuggestedChanges: true,
      skipReason: null,
      summaryOnlyReason: null,
    };
  }
}

const testRepositoryConfig = {
  ...defaultRepositoryConfig,
  source: null,
};

describe("WorkerRunner", () => {
  it("processes review jobs end to end", async () => {
    const queue = new FakeQueueScheduler();
    const lifecycle = new FakeReviewLifecycleService();
    const planner = new FakeReviewPlanner();
    const logger = new FakeLogger();
    const statusCalls: Array<Record<string, unknown>> = [];
    const publishCalls: Array<Record<string, unknown>> = [];
    queue.nextJobs = [
      {
        id: "job_1",
        type: "review_requested",
        tenantId: "github-installation:123456",
        repositoryId: "github:99",
        changeRequestId: "github:99:42",
        dedupeKey: "github:99:42:quick",
        priority: 100,
        status: "running",
        attempts: 0,
        maxAttempts: 3,
        payload: {
          installationId: "123456",
          repository: {
            owner: "rubenspessoa",
            name: "nitpickr",
          },
          pullNumber: 42,
          mode: "quick",
          trigger: {
            type: "manual_command",
            command: "review",
            actorLogin: "ruben",
          },
        },
        createdAt: new Date("2026-03-09T10:00:00.000Z"),
        scheduledAt: new Date("2026-03-09T10:00:00.000Z"),
        startedAt: new Date("2026-03-09T10:00:01.000Z"),
        completedAt: null,
        workerId: "worker_1",
        lastError: null,
      },
    ];

    const runner = new WorkerRunner({
      logger,
      queueScheduler: queue,
      githubAdapter: {
        async fetchChangeRequestContext() {
          return {
            tenantId: "github-installation:123456",
            installationId: "123456",
            repositoryId: "github:99",
            repository: {
              owner: "rubenspessoa",
              name: "nitpickr",
            },
            changeRequest: {
              id: "github:99:42",
              tenantId: "github-installation:123456",
              installationId: "123456",
              repositoryId: "github:99",
              provider: "github" as const,
              number: 42,
              title: "Improve queue fairness",
              baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              status: "open" as const,
              authorLogin: "ruben",
            },
            files: [
              {
                path: "src/queue/queue-scheduler.ts",
                additions: 10,
                deletions: 2,
                status: "modified" as const,
                patch: "@@ -1 +1 @@\n+stable ordering",
                previousPath: null,
              },
            ],
            comments: [],
          };
        },
      },
      instructionBundleLoader: {
        async loadForReview() {
          return {
            config: {
              ...testRepositoryConfig,
              review: {
                ...testRepositoryConfig.review,
                maxComments: 5,
                maxAutoComments: 5,
                focusAreas: ["queue fairness"],
              },
            },
            documents: [],
            combinedText: "strictness: balanced",
          };
        },
      },
      memoryService: {
        async getRelevantMemories() {
          return [];
        },
        async ingestDiscussion() {},
      },
      reviewPlanner: planner,
      reviewLifecycle: lifecycle,
      reviewEngine: {
        async review() {
          return {
            summary: "Queue fairness improved.",
            mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
            findings: [],
          };
        },
      },
      publisher: {
        buildInlineComments(findings) {
          publishCalls.push({
            type: "build_inline_comments",
            findings,
          });
          return [];
        },
        async publish(input) {
          publishCalls.push({
            type: "publish",
            ...input,
          });
          return { reviewId: "review_1" };
        },
      },
      statusPublisher: {
        async markPending(input) {
          statusCalls.push({
            type: "pending",
            ...input,
          });
          return "check-run-1";
        },
        async markPublished(input) {
          statusCalls.push({
            type: "published",
            ...input,
          });
        },
        async markSkipped() {},
        async markFailed() {
          return undefined;
        },
      },
    });

    const processed = await runner.runOnce({
      workerId: "worker_1",
      perTenantCap: 1,
    });

    expect(processed).toBe(true);
    expect(queue.completed).toEqual(["job_1"]);
    expect(lifecycle.started[0]).toMatchObject({
      tenantId: "github-installation:123456",
      repositoryId: "github:99",
      mode: "quick",
      scope: "full_pr",
      comparedFromSha: null,
      trigger: {
        type: "manual_command",
        command: "review",
        actorLogin: "ruben",
      },
    });
    expect(lifecycle.completed[0]).toMatchObject({
      reviewRunId: "review_run_1",
      repositoryId: "github:99",
      status: "published",
      publishedReviewId: "review_1",
    });
    expect(publishCalls).toContainEqual(
      expect.objectContaining({
        type: "publish",
        publishMode: "pr_summary",
      }),
    );
    expect(statusCalls).toEqual([
      {
        type: "pending",
        installationId: "123456",
        repository: {
          owner: "rubenspessoa",
          name: "nitpickr",
        },
        sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        reviewRunId: "review_run_1",
        description: "nitpickr review is running.",
      },
      {
        type: "published",
        checkRunId: "check-run-1",
        installationId: "123456",
        repository: {
          owner: "rubenspessoa",
          name: "nitpickr",
        },
        sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        reviewRunId: "review_run_1",
        description: "nitpickr review completed successfully.",
        summary: "Queue fairness improved.",
      },
    ]);
    expect(logger.entries).toContainEqual({
      level: "info",
      message: "Published review result.",
      fields: {
        component: "worker-runner",
        jobId: "job_1",
        reviewRunId: "review_run_1",
        publishedReviewId: "review_1",
        findingCount: 0,
      },
    });
  });

  it("publishes commit summaries for synchronize runs and suppresses advisory-only findings", async () => {
    const queue = new FakeQueueScheduler();
    const lifecycle = new FakeReviewLifecycleService();
    const planner = new FakeReviewPlanner();
    const logger = new FakeLogger();
    const publishCalls: Array<Record<string, unknown>> = [];
    const resolvedThreadIds: string[] = [];
    lifecycle.getLatestCompletedReview = async () => ({
      id: "review_run_previous",
      tenantId: "github-installation:123456",
      repositoryId: "github:99",
      changeRequestId: "github:99:42",
      trigger: {
        type: "pr_opened",
        actorLogin: "ruben",
      },
      mode: "quick",
      scope: "full_pr",
      headSha: "cccccccccccccccccccccccccccccccccccccccc",
      comparedFromSha: null,
      status: "published",
      budgets: {
        maxFiles: 5,
        maxHunks: 20,
        maxTokens: 20000,
        maxComments: 5,
        maxDurationMs: 300000,
      },
      createdAt: "2026-03-09T09:50:00.000Z",
      updatedAt: "2026-03-09T09:52:00.000Z",
      completedAt: "2026-03-09T09:52:00.000Z",
    });
    queue.nextJobs = [
      {
        id: "job_sync",
        type: "review_requested",
        tenantId: "github-installation:123456",
        repositoryId: "github:99",
        changeRequestId: "github:99:42",
        dedupeKey: "github:99:42:quick",
        priority: 100,
        status: "running",
        attempts: 0,
        maxAttempts: 3,
        payload: {
          installationId: "123456",
          repository: {
            owner: "rubenspessoa",
            name: "nitpickr",
          },
          pullNumber: 42,
          mode: "quick",
          trigger: {
            type: "pr_synchronized",
            actorLogin: "ruben",
          },
        },
        createdAt: new Date("2026-03-09T10:00:00.000Z"),
        scheduledAt: new Date("2026-03-09T10:00:00.000Z"),
        startedAt: new Date("2026-03-09T10:00:01.000Z"),
        completedAt: null,
        workerId: "worker_1",
        lastError: null,
      },
    ];

    const runner = new WorkerRunner({
      logger,
      queueScheduler: queue,
      githubAdapter: {
        async fetchChangeRequestContext() {
          return {
            tenantId: "github-installation:123456",
            installationId: "123456",
            repositoryId: "github:99",
            repository: {
              owner: "rubenspessoa",
              name: "nitpickr",
            },
            changeRequest: {
              id: "github:99:42",
              tenantId: "github-installation:123456",
              installationId: "123456",
              repositoryId: "github:99",
              provider: "github" as const,
              number: 42,
              title: "Improve queue fairness",
              baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              status: "open" as const,
              authorLogin: "ruben",
            },
            files: [
              {
                path: "src/queue/queue-scheduler.ts",
                additions: 10,
                deletions: 2,
                status: "modified" as const,
                patch: "@@ -1 +1 @@\n+stable ordering",
                previousPath: null,
              },
            ],
            comments: [],
          };
        },
        async comparePullRequestRange() {
          return [
            {
              path: "src/queue/queue-scheduler.ts",
              additions: 2,
              deletions: 1,
              status: "modified" as const,
              patch: "@@ -17,1 +17,2 @@\n+stable ordering",
              previousPath: null,
            },
          ];
        },
        async listNitpickrReviewThreads() {
          return [
            {
              threadId: "thread_old",
              providerCommentId: "comment_old",
              path: "src/queue/queue-scheduler.ts",
              line: 14,
              fingerprint: "old_fp",
              isResolved: false,
            },
          ];
        },
        async resolveReviewThread(input) {
          resolvedThreadIds.push(input.threadId);
        },
      },
      instructionBundleLoader: {
        async loadForReview() {
          return {
            config: {
              ...testRepositoryConfig,
              review: {
                ...testRepositoryConfig.review,
                maxComments: 5,
                maxAutoComments: 5,
                focusAreas: ["queue fairness"],
              },
            },
            documents: [],
            combinedText: "strictness: balanced",
          };
        },
      },
      memoryService: {
        async getRelevantMemories() {
          return [];
        },
        async ingestDiscussion() {},
      },
      reviewPlanner: planner,
      reviewLifecycle: lifecycle,
      reviewEngine: {
        async review() {
          return {
            summary: "This push tightens queue ordering checks.",
            mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
            findings: [
              {
                path: "src/queue/queue-scheduler.ts",
                line: 12,
                findingType: "question" as const,
                severity: "medium" as const,
                category: "testing" as const,
                title: "Consider another regression test",
                body: "A regression test could make the change easier to verify.",
                fixPrompt:
                  "Add a regression test for the equal-priority branch.",
              },
              {
                path: "src/queue/queue-scheduler.ts",
                line: 18,
                findingType: "bug" as const,
                severity: "high" as const,
                category: "correctness" as const,
                title: "Stable ordering still breaks",
                body: "Equal priorities can still reorder existing items.",
                fixPrompt:
                  "Preserve insertion order for equal priorities in src/queue/queue-scheduler.ts around line 18.",
              },
            ],
          };
        },
      },
      publisher: {
        buildInlineComments(findings) {
          publishCalls.push({
            type: "build_inline_comments",
            findings,
          });
          return [
            {
              path: "src/queue/queue-scheduler.ts",
              line: 18,
              side: "RIGHT" as const,
              body: "comment",
              fingerprint:
                "src/queue/queue-scheduler.ts:18:correctness:stable_ordering_still_breaks",
            },
          ];
        },
        async publish(input) {
          publishCalls.push({
            type: "publish",
            ...input,
          });
          return { reviewId: "review_2" };
        },
      },
      statusPublisher: {
        async markPending() {
          return "check-run-2";
        },
        async markPublished() {},
        async markSkipped() {},
        async markFailed() {
          return undefined;
        },
      },
    });

    const processed = await runner.runOnce({
      workerId: "worker_1",
      perTenantCap: 1,
    });

    expect(processed).toBe(true);
    expect(lifecycle.started[0]).toMatchObject({
      scope: "commit_delta",
      comparedFromSha: "cccccccccccccccccccccccccccccccccccccccc",
      trigger: {
        type: "pr_synchronized",
        actorLogin: "ruben",
      },
    });
    expect(publishCalls).toContainEqual(
      expect.objectContaining({
        type: "build_inline_comments",
        findings: [
          expect.objectContaining({
            title: "Stable ordering still breaks",
            findingType: "bug",
          }),
        ],
      }),
    );
    expect(publishCalls).toContainEqual(
      expect.objectContaining({
        type: "publish",
        publishMode: "commit_summary",
        reviewedCommitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        commitSummaryCounts: {
          newFindings: 1,
          resolvedThreads: 1,
          stillRelevantFindings: 1,
        },
        result: expect.objectContaining({
          findings: [
            expect.objectContaining({
              title: "Stable ordering still breaks",
            }),
          ],
        }),
      }),
    );
    expect(resolvedThreadIds).toEqual(["thread_old"]);
    expect(lifecycle.resolvedComments).toEqual([["thread_old"]]);
  });

  it("processes memory ingestion jobs", async () => {
    const queue = new FakeQueueScheduler();
    const lifecycle = new FakeReviewLifecycleService();
    const planner = new FakeReviewPlanner();
    const logger = new FakeLogger();
    queue.nextJobs = [
      {
        id: "job_2",
        type: "memory_ingest",
        tenantId: "github-installation:123456",
        repositoryId: "github:99",
        changeRequestId: "github:99:42",
        dedupeKey: "github:99:42:memory",
        priority: 10,
        status: "running",
        attempts: 0,
        maxAttempts: 3,
        payload: {
          discussions: [
            {
              authorLogin: "maintainer",
              body: "Prefer stable ordering in queue implementations.",
              path: "src/queue/queue-scheduler.ts",
            },
          ],
        },
        createdAt: new Date("2026-03-09T10:00:00.000Z"),
        scheduledAt: new Date("2026-03-09T10:00:00.000Z"),
        startedAt: new Date("2026-03-09T10:00:01.000Z"),
        completedAt: null,
        workerId: "worker_1",
        lastError: null,
      },
    ];

    let ingested = false;
    const runner = new WorkerRunner({
      logger,
      queueScheduler: queue,
      githubAdapter: {
        async fetchChangeRequestContext() {
          throw new Error("not used");
        },
      },
      instructionBundleLoader: {
        async loadForReview() {
          throw new Error("not used");
        },
      },
      memoryService: {
        async getRelevantMemories() {
          return [];
        },
        async ingestDiscussion() {
          ingested = true;
        },
      },
      reviewPlanner: planner,
      reviewLifecycle: lifecycle,
      reviewEngine: {
        async review() {
          throw new Error("not used");
        },
      },
      publisher: {
        buildInlineComments() {
          throw new Error("not used");
        },
        async publish() {
          throw new Error("not used");
        },
      },
    });

    const processed = await runner.runOnce({
      workerId: "worker_1",
      perTenantCap: 1,
    });

    expect(processed).toBe(true);
    expect(ingested).toBe(true);
    expect(queue.completed).toEqual(["job_2"]);
    expect(logger.entries).toContainEqual({
      level: "info",
      message: "Processed memory ingestion job.",
      fields: {
        component: "worker-runner",
        jobId: "job_2",
        discussionCount: 1,
      },
    });
  });

  it("fails jobs when processing throws", async () => {
    const queue = new FakeQueueScheduler();
    const lifecycle = new FakeReviewLifecycleService();
    const planner = new FakeReviewPlanner();
    const logger = new FakeLogger();
    queue.nextJobs = [
      {
        id: "job_3",
        type: "review_requested",
        tenantId: "github-installation:123456",
        repositoryId: "github:99",
        changeRequestId: "github:99:42",
        dedupeKey: "github:99:42:quick",
        priority: 100,
        status: "running",
        attempts: 0,
        maxAttempts: 3,
        payload: {
          installationId: "123456",
          repository: {
            owner: "rubenspessoa",
            name: "nitpickr",
          },
          pullNumber: 42,
          mode: "quick",
          trigger: {
            type: "pr_opened",
            actorLogin: "ruben",
          },
        },
        createdAt: new Date("2026-03-09T10:00:00.000Z"),
        scheduledAt: new Date("2026-03-09T10:00:00.000Z"),
        startedAt: new Date("2026-03-09T10:00:01.000Z"),
        completedAt: null,
        workerId: "worker_1",
        lastError: null,
      },
    ];

    const runner = new WorkerRunner({
      logger,
      queueScheduler: queue,
      githubAdapter: {
        async fetchChangeRequestContext() {
          return {
            tenantId: "github-installation:123456",
            installationId: "123456",
            repositoryId: "github:99",
            repository: {
              owner: "rubenspessoa",
              name: "nitpickr",
            },
            changeRequest: {
              id: "github:99:42",
              tenantId: "github-installation:123456",
              installationId: "123456",
              repositoryId: "github:99",
              provider: "github" as const,
              number: 42,
              title: "Improve queue fairness",
              baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              status: "open" as const,
              authorLogin: "ruben",
            },
            files: [
              {
                path: "src/queue/queue-scheduler.ts",
                additions: 10,
                deletions: 2,
                status: "modified" as const,
                patch: "@@ -1 +1 @@\n+stable ordering",
                previousPath: null,
              },
            ],
            comments: [],
          };
        },
      },
      instructionBundleLoader: {
        async loadForReview() {
          return {
            config: {
              ...testRepositoryConfig,
              review: {
                ...testRepositoryConfig.review,
                maxComments: 5,
                maxAutoComments: 5,
                focusAreas: ["queue fairness"],
              },
            },
            documents: [],
            combinedText: "strictness: balanced",
          };
        },
      },
      memoryService: {
        async getRelevantMemories() {
          return [];
        },
        async ingestDiscussion() {},
      },
      reviewPlanner: planner,
      reviewLifecycle: lifecycle,
      reviewEngine: {
        async review() {
          throw new Error("boom");
        },
      },
      publisher: {
        buildInlineComments() {
          return [];
        },
        async publish() {
          throw new Error("not used");
        },
      },
    });

    const processed = await runner.runOnce({
      workerId: "worker_1",
      perTenantCap: 1,
    });

    expect(processed).toBe(true);
    expect(queue.failed).toEqual([{ jobId: "job_3", error: "boom" }]);
    expect(lifecycle.failed).toEqual([
      {
        errorMessage: "openai_model_output: boom",
        reviewRunId: "review_run_1",
      },
    ]);
    expect(logger.entries).toContainEqual({
      level: "error",
      message: "Worker job failed.",
      fields: {
        component: "worker-runner",
        jobId: "job_3",
        jobType: "review_requested",
        failureClass: "openai_model_output",
        error: "boom",
      },
    });
  });

  it("publishes a summary-only result when repo config filters out all files", async () => {
    const queue = new FakeQueueScheduler();
    const lifecycle = new FakeReviewLifecycleService();
    const logger = new FakeLogger();
    queue.nextJobs = [
      {
        id: "job_4",
        type: "review_requested",
        tenantId: "github-installation:123456",
        repositoryId: "github:99",
        changeRequestId: "github:99:42",
        dedupeKey: "github:99:42:quick",
        priority: 100,
        status: "running",
        attempts: 0,
        maxAttempts: 3,
        payload: {
          installationId: "123456",
          repository: {
            owner: "rubenspessoa",
            name: "nitpickr",
          },
          pullNumber: 42,
          mode: "quick",
          trigger: {
            type: "pr_opened",
            actorLogin: "ruben",
          },
        },
        createdAt: new Date("2026-03-09T10:00:00.000Z"),
        scheduledAt: new Date("2026-03-09T10:00:00.000Z"),
        startedAt: new Date("2026-03-09T10:00:01.000Z"),
        completedAt: null,
        workerId: "worker_1",
        lastError: null,
      },
    ];

    let reviewEngineCalled = false;
    let publishedSummary = "";
    const runner = new WorkerRunner({
      logger,
      queueScheduler: queue,
      githubAdapter: {
        async fetchChangeRequestContext() {
          return {
            tenantId: "github-installation:123456",
            installationId: "123456",
            repositoryId: "github:99",
            repository: {
              owner: "rubenspessoa",
              name: "nitpickr",
            },
            changeRequest: {
              id: "github:99:42",
              tenantId: "github-installation:123456",
              installationId: "123456",
              repositoryId: "github:99",
              provider: "github" as const,
              number: 42,
              title: "Ignore generated files",
              baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              status: "open" as const,
              authorLogin: "ruben",
            },
            files: [
              {
                path: "dist/generated.js",
                additions: 10,
                deletions: 2,
                status: "modified" as const,
                patch: "@@ -1 +1 @@\n+generated",
                previousPath: null,
              },
            ],
            comments: [],
          };
        },
      },
      instructionBundleLoader: {
        async loadForReview() {
          return {
            config: {
              ...testRepositoryConfig,
              review: {
                ...testRepositoryConfig.review,
                ignorePaths: ["dist/**"],
                maxComments: 5,
                maxAutoComments: 5,
                focusAreas: [],
              },
            },
            documents: [],
            combinedText: "strictness: balanced",
          };
        },
      },
      memoryService: {
        async getRelevantMemories() {
          return [];
        },
        async ingestDiscussion() {},
      },
      reviewPlanner: {
        plan() {
          return {
            files: [],
            summaryOnly: true,
            commentBudget: 0,
            allowSuggestedChanges: true,
            skipReason:
              "No reviewable files matched the current repository configuration.",
            summaryOnlyReason: null,
          };
        },
      },
      reviewLifecycle: lifecycle,
      reviewEngine: {
        async review() {
          reviewEngineCalled = true;
          throw new Error("not used");
        },
      },
      publisher: {
        buildInlineComments() {
          return [];
        },
        async publish(input) {
          publishedSummary = input.result.summary;
          return { reviewId: "review_4" };
        },
      },
    });

    const processed = await runner.runOnce({
      workerId: "worker_1",
      perTenantCap: 1,
    });

    expect(processed).toBe(true);
    expect(reviewEngineCalled).toBe(false);
    expect(publishedSummary).toMatch(/no reviewable files/i);
    expect(queue.completed).toEqual(["job_4"]);
    expect(logger.entries).toContainEqual({
      level: "info",
      message:
        "Skipping inline review; no reviewable files remained after planning.",
      fields: {
        component: "worker-runner",
        jobId: "job_4",
        repositoryId: "github:99",
      },
    });
  });

  it("continues publishing the review when pending check-run creation fails", async () => {
    const queue = new FakeQueueScheduler();
    const lifecycle = new FakeReviewLifecycleService();
    const planner = new FakeReviewPlanner();
    const logger = new FakeLogger();
    let publishCalled = false;
    queue.nextJobs = [
      {
        id: "job_5",
        type: "review_requested",
        tenantId: "github-installation:123456",
        repositoryId: "github:99",
        changeRequestId: "github:99:42",
        dedupeKey: "github:99:42:quick",
        priority: 100,
        status: "running",
        attempts: 0,
        maxAttempts: 3,
        payload: {
          installationId: "123456",
          repository: {
            owner: "rubenspessoa",
            name: "nitpickr",
          },
          pullNumber: 42,
          mode: "quick",
          trigger: {
            type: "manual_command",
            command: "review",
            actorLogin: "ruben",
          },
        },
        createdAt: new Date("2026-03-09T10:00:00.000Z"),
        scheduledAt: new Date("2026-03-09T10:00:00.000Z"),
        startedAt: new Date("2026-03-09T10:00:01.000Z"),
        completedAt: null,
        workerId: "worker_1",
        lastError: null,
      },
    ];

    const runner = new WorkerRunner({
      logger,
      queueScheduler: queue,
      githubAdapter: {
        async fetchChangeRequestContext() {
          return {
            tenantId: "github-installation:123456",
            installationId: "123456",
            repositoryId: "github:99",
            repository: {
              owner: "rubenspessoa",
              name: "nitpickr",
            },
            changeRequest: {
              id: "github:99:42",
              tenantId: "github-installation:123456",
              installationId: "123456",
              repositoryId: "github:99",
              provider: "github" as const,
              number: 42,
              title: "Improve queue fairness",
              baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              status: "open" as const,
              authorLogin: "ruben",
            },
            files: [
              {
                path: "src/queue/queue-scheduler.ts",
                additions: 10,
                deletions: 2,
                status: "modified" as const,
                patch: "@@ -1 +1 @@\n+stable ordering",
                previousPath: null,
              },
            ],
            comments: [],
          };
        },
      },
      instructionBundleLoader: {
        async loadForReview() {
          return {
            config: {
              ...testRepositoryConfig,
              statusChecks: {
                enabled: true,
              },
              review: {
                ...testRepositoryConfig.review,
                maxComments: 5,
                maxAutoComments: 5,
                focusAreas: ["queue fairness"],
              },
            },
            documents: [],
            combinedText: "strictness: balanced",
          };
        },
      },
      memoryService: {
        async getRelevantMemories() {
          return [];
        },
        async ingestDiscussion() {},
      },
      reviewPlanner: planner,
      reviewLifecycle: lifecycle,
      reviewEngine: {
        async review() {
          return {
            summary: "Queue fairness improved.",
            mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
            findings: [],
          };
        },
      },
      publisher: {
        buildInlineComments() {
          return [];
        },
        async publish() {
          publishCalled = true;
          return { reviewId: "review_5" };
        },
      },
      statusPublisher: {
        async markPending() {
          throw new Error(
            'GitHub request failed with status 403: {"message":"Resource not accessible by integration"}',
          );
        },
        async markPublished() {},
        async markSkipped() {},
        async markFailed() {
          return undefined;
        },
      },
    });

    const processed = await runner.runOnce({
      workerId: "worker_1",
      perTenantCap: 1,
    });

    expect(processed).toBe(true);
    expect(publishCalled).toBe(true);
    expect(queue.completed).toEqual(["job_5"]);
    expect(lifecycle.completed[0]).toMatchObject({
      reviewRunId: "review_run_1",
      repositoryId: "github:99",
      status: "published",
      publishedReviewId: "review_5",
    });
    expect(logger.entries).toContainEqual({
      level: "warn",
      message: "Review status update failed.",
      fields: {
        component: "worker-runner",
        jobId: "job_5",
        reviewRunId: "review_run_1",
        repositoryId: "github:99",
        sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        statusPhase: "pending",
        error:
          'GitHub request failed with status 403: {"message":"Resource not accessible by integration"}',
      },
    });
  });

  it("preserves the original review failure when failed status publishing also fails", async () => {
    const queue = new FakeQueueScheduler();
    const lifecycle = new FakeReviewLifecycleService();
    const planner = new FakeReviewPlanner();
    const logger = new FakeLogger();
    queue.nextJobs = [
      {
        id: "job_6",
        type: "review_requested",
        tenantId: "github-installation:123456",
        repositoryId: "github:99",
        changeRequestId: "github:99:42",
        dedupeKey: "github:99:42:quick",
        priority: 100,
        status: "running",
        attempts: 0,
        maxAttempts: 3,
        payload: {
          installationId: "123456",
          repository: {
            owner: "rubenspessoa",
            name: "nitpickr",
          },
          pullNumber: 42,
          mode: "quick",
          trigger: {
            type: "pr_opened",
            actorLogin: "ruben",
          },
        },
        createdAt: new Date("2026-03-09T10:00:00.000Z"),
        scheduledAt: new Date("2026-03-09T10:00:00.000Z"),
        startedAt: new Date("2026-03-09T10:00:01.000Z"),
        completedAt: null,
        workerId: "worker_1",
        lastError: null,
      },
    ];

    const runner = new WorkerRunner({
      logger,
      queueScheduler: queue,
      githubAdapter: {
        async fetchChangeRequestContext() {
          return {
            tenantId: "github-installation:123456",
            installationId: "123456",
            repositoryId: "github:99",
            repository: {
              owner: "rubenspessoa",
              name: "nitpickr",
            },
            changeRequest: {
              id: "github:99:42",
              tenantId: "github-installation:123456",
              installationId: "123456",
              repositoryId: "github:99",
              provider: "github" as const,
              number: 42,
              title: "Improve queue fairness",
              baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              status: "open" as const,
              authorLogin: "ruben",
            },
            files: [
              {
                path: "src/queue/queue-scheduler.ts",
                additions: 10,
                deletions: 2,
                status: "modified" as const,
                patch: "@@ -1 +1 @@\n+stable ordering",
                previousPath: null,
              },
            ],
            comments: [],
          };
        },
      },
      instructionBundleLoader: {
        async loadForReview() {
          return {
            config: {
              ...testRepositoryConfig,
              statusChecks: {
                enabled: true,
              },
              review: {
                ...testRepositoryConfig.review,
                maxComments: 5,
                maxAutoComments: 5,
                focusAreas: ["queue fairness"],
              },
            },
            documents: [],
            combinedText: "strictness: balanced",
          };
        },
      },
      memoryService: {
        async getRelevantMemories() {
          return [];
        },
        async ingestDiscussion() {},
      },
      reviewPlanner: planner,
      reviewLifecycle: lifecycle,
      reviewEngine: {
        async review() {
          throw new Error("boom");
        },
      },
      publisher: {
        buildInlineComments() {
          return [];
        },
        async publish() {
          throw new Error("not used");
        },
      },
      statusPublisher: {
        async markPending() {
          return "check-run-6";
        },
        async markPublished() {},
        async markSkipped() {},
        async markFailed() {
          throw new Error(
            'GitHub request failed with status 403: {"message":"Resource not accessible by integration"}',
          );
        },
      },
    });

    const processed = await runner.runOnce({
      workerId: "worker_1",
      perTenantCap: 1,
    });

    expect(processed).toBe(true);
    expect(queue.failed).toEqual([{ jobId: "job_6", error: "boom" }]);
    expect(lifecycle.failed).toEqual([
      {
        errorMessage: "openai_model_output: boom",
        reviewRunId: "review_run_1",
      },
    ]);
    expect(logger.entries).toContainEqual({
      level: "warn",
      message: "Review status update failed.",
      fields: {
        component: "worker-runner",
        jobId: "job_6",
        reviewRunId: "review_run_1",
        checkRunId: "check-run-6",
        repositoryId: "github:99",
        sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        failureClass: "openai_model_output",
        retryable: false,
        statusPhase: "failed",
        error:
          'GitHub request failed with status 403: {"message":"Resource not accessible by integration"}',
      },
    });
    expect(logger.entries).toContainEqual({
      level: "error",
      message: "Worker job failed.",
      fields: {
        component: "worker-runner",
        jobId: "job_6",
        jobType: "review_requested",
        failureClass: "openai_model_output",
        error: "boom",
      },
    });
  });
});
