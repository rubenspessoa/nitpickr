import { type ReviewRun, parseReviewTrigger } from "../domain/types.js";
import type { InstructionBundle } from "../instructions/instruction-loader.js";
import { type Logger, noopLogger } from "../logging/logger.js";
import type { MemoryEntry, MemoryService } from "../memory/memory-service.js";
import type {
  GitHubAdapter,
  GitHubChangeRequestContext,
} from "../providers/github/github-adapter.js";
import type { ReviewPublisher } from "../publisher/review-publisher.js";
import type { ReviewStatusPublisher } from "../publisher/review-status-publisher.js";
import type { QueueJob, QueueScheduler } from "../queue/queue-scheduler.js";
import type {
  ReviewEngine,
  ReviewEngineResult,
} from "../review/review-engine.js";
import type { ReviewLifecycleService } from "../review/review-lifecycle-service.js";
import type { ReviewPlanner } from "../review/review-planner.js";

const REVIEW_DURATION_BUDGET_MS = 300_000;

type ReviewFailureClass =
  | "config_setup"
  | "github_api"
  | "openai_model_output"
  | "publish_failure"
  | "internal_processing";

class ReviewJobError extends Error {
  readonly failureClass: ReviewFailureClass;
  readonly retryable: boolean;

  constructor(
    failureClass: ReviewFailureClass,
    retryable: boolean,
    message: string,
  ) {
    super(message);
    this.failureClass = failureClass;
    this.retryable = retryable;
  }
}

function extractStatusCode(message: string): number | null {
  const match = /status\s+(\d{3})/i.exec(message);
  if (!match?.[1]) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function isRetryableHttpError(message: string): boolean {
  const statusCode = extractStatusCode(message);
  return statusCode === 429 || (statusCode !== null && statusCode >= 500);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown worker error.";
}

function classifyReviewError(
  stage: "config" | "github" | "review" | "publish",
  error: unknown,
): ReviewJobError {
  if (error instanceof ReviewJobError) {
    return error;
  }

  const message = toErrorMessage(error);
  if (stage === "config") {
    return new ReviewJobError("config_setup", false, message);
  }
  if (stage === "github") {
    return new ReviewJobError(
      "github_api",
      isRetryableHttpError(message),
      message,
    );
  }
  if (stage === "review") {
    return new ReviewJobError(
      "openai_model_output",
      isRetryableHttpError(message),
      message,
    );
  }

  return new ReviewJobError(
    "publish_failure",
    isRetryableHttpError(message),
    message,
  );
}

function stripSuggestedChanges(result: ReviewEngineResult): ReviewEngineResult {
  return {
    ...result,
    findings: result.findings.map((finding) => ({
      ...finding,
      suggestedChange: undefined,
    })),
  };
}

function prependSummaryReason(
  result: ReviewEngineResult,
  summaryOnlyReason: string | null,
): ReviewEngineResult {
  if (!summaryOnlyReason) {
    return result;
  }

  return {
    ...result,
    summary: `${summaryOnlyReason}\n\n${result.summary}`.trim(),
  };
}

type ReviewStatusPhase = "pending" | "published" | "skipped" | "failed";

const noopStatusPublisher: Pick<
  ReviewStatusPublisher,
  "markFailed" | "markPending" | "markPublished" | "markSkipped"
> = {
  async markFailed() {
    return undefined;
  },
  async markPending() {
    return "noop-check-run";
  },
  async markPublished() {},
  async markSkipped() {},
};

function parseReviewJobPayload(payload: QueueJob["payload"]): {
  installationId: string;
  repository: {
    owner: string;
    name: string;
  };
  pullNumber: number;
  mode: ReviewRun["mode"];
  trigger: ReturnType<typeof parseReviewTrigger>;
} {
  const installationId = payload.installationId;
  const repository = payload.repository as Record<string, unknown> | undefined;
  const pullNumber = payload.pullNumber;
  const mode = payload.mode;

  if (
    typeof installationId !== "string" ||
    installationId.trim().length === 0
  ) {
    throw new Error("review job installationId must not be empty.");
  }
  if (
    typeof repository !== "object" ||
    repository === null ||
    typeof repository.owner !== "string" ||
    repository.owner.trim().length === 0 ||
    typeof repository.name !== "string" ||
    repository.name.trim().length === 0
  ) {
    throw new Error("review job repository must be present.");
  }
  if (
    typeof pullNumber !== "number" ||
    !Number.isInteger(pullNumber) ||
    pullNumber <= 0
  ) {
    throw new Error("review job pullNumber must be positive.");
  }
  if (mode !== "quick" && mode !== "full" && mode !== "summary") {
    throw new Error("review job mode is invalid.");
  }

  return {
    installationId,
    repository: {
      owner: repository.owner,
      name: repository.name,
    },
    pullNumber,
    mode,
    trigger: parseReviewTrigger(payload.trigger),
  };
}

function parseMemoryJobPayload(payload: QueueJob["payload"]): {
  discussions: Array<{
    authorLogin: string;
    body: string;
    path: string | null;
  }>;
} {
  const discussions = payload.discussions;

  if (!Array.isArray(discussions)) {
    throw new Error("memory job discussions must be an array.");
  }

  return {
    discussions: discussions.map((discussion) => {
      if (
        typeof discussion !== "object" ||
        discussion === null ||
        typeof discussion.authorLogin !== "string" ||
        discussion.authorLogin.trim().length === 0 ||
        typeof discussion.body !== "string" ||
        discussion.body.trim().length === 0
      ) {
        throw new Error("memory job discussion is invalid.");
      }

      return {
        authorLogin: discussion.authorLogin,
        body: discussion.body,
        path:
          typeof discussion.path === "string"
            ? discussion.path
            : (discussion.path ?? null),
      };
    }),
  };
}

export interface InstructionBundleLoader {
  loadForReview(
    context: GitHubChangeRequestContext,
  ): Promise<InstructionBundle>;
}

export interface WorkerRunnerDependencies {
  logger?: Logger;
  queueScheduler: Pick<
    QueueScheduler,
    "claimNextJobs" | "cancelSupersededReviewJobs" | "completeJob" | "failJob"
  >;
  githubAdapter: Pick<GitHubAdapter, "fetchChangeRequestContext">;
  instructionBundleLoader: InstructionBundleLoader;
  memoryService: Pick<
    MemoryService,
    "getRelevantMemories" | "ingestDiscussion"
  >;
  reviewPlanner: Pick<ReviewPlanner, "plan">;
  reviewLifecycle: Pick<
    ReviewLifecycleService,
    "startReview" | "completeReview" | "failReview"
  >;
  reviewEngine: Pick<ReviewEngine, "review">;
  publisher: Pick<ReviewPublisher, "buildInlineComments" | "publish">;
  statusPublisher?: Pick<
    ReviewStatusPublisher,
    "markFailed" | "markPending" | "markPublished" | "markSkipped"
  >;
}

export class WorkerRunner {
  readonly #logger: Logger;
  readonly #queueScheduler: WorkerRunnerDependencies["queueScheduler"];
  readonly #githubAdapter: WorkerRunnerDependencies["githubAdapter"];
  readonly #instructionBundleLoader: WorkerRunnerDependencies["instructionBundleLoader"];
  readonly #memoryService: WorkerRunnerDependencies["memoryService"];
  readonly #reviewPlanner: WorkerRunnerDependencies["reviewPlanner"];
  readonly #reviewLifecycle: WorkerRunnerDependencies["reviewLifecycle"];
  readonly #reviewEngine: WorkerRunnerDependencies["reviewEngine"];
  readonly #publisher: WorkerRunnerDependencies["publisher"];
  readonly #statusPublisher: Pick<
    ReviewStatusPublisher,
    "markFailed" | "markPending" | "markPublished" | "markSkipped"
  >;

  constructor(input: WorkerRunnerDependencies) {
    this.#logger = (input.logger ?? noopLogger).child({
      component: "worker-runner",
    });
    this.#queueScheduler = input.queueScheduler;
    this.#githubAdapter = input.githubAdapter;
    this.#instructionBundleLoader = input.instructionBundleLoader;
    this.#memoryService = input.memoryService;
    this.#reviewPlanner = input.reviewPlanner;
    this.#reviewLifecycle = input.reviewLifecycle;
    this.#reviewEngine = input.reviewEngine;
    this.#publisher = input.publisher;
    this.#statusPublisher = input.statusPublisher ?? noopStatusPublisher;
  }

  async runOnce(input: {
    workerId: string;
    perTenantCap: number;
  }): Promise<boolean> {
    const jobs = await this.#queueScheduler.claimNextJobs({
      limit: 1,
      perTenantCap: input.perTenantCap,
      workerId: input.workerId,
    });

    const job = jobs[0];
    if (!job) {
      this.#logger.debug("No jobs available for worker iteration.", {
        workerId: input.workerId,
      });
      return false;
    }

    this.#logger.info("Claimed worker job.", {
      workerId: input.workerId,
      jobId: job.id,
      jobType: job.type,
      tenantId: job.tenantId,
      repositoryId: job.repositoryId,
    });

    try {
      if (job.type === "memory_ingest") {
        await this.#processMemoryJob(job);
      } else {
        await this.#processReviewJob(job);
      }

      await this.#queueScheduler.completeJob(job.id);
      this.#logger.info("Completed worker job.", {
        jobId: job.id,
        jobType: job.type,
      });
      return true;
    } catch (error) {
      this.#logger.error("Worker job failed.", {
        jobId: job.id,
        jobType: job.type,
        failureClass:
          error instanceof ReviewJobError
            ? error.failureClass
            : "internal_processing",
        error: toErrorMessage(error),
      });
      await this.#queueScheduler.failJob(job.id, toErrorMessage(error), {
        retryable: error instanceof ReviewJobError ? error.retryable : false,
      });
      return true;
    }
  }

  async #processReviewJob(job: QueueJob): Promise<void> {
    let payload: ReturnType<typeof parseReviewJobPayload>;
    try {
      payload = parseReviewJobPayload(job.payload);
    } catch (error) {
      throw classifyReviewError("config", error);
    }

    let reviewRunId: string | null = null;
    let checkRunId: string | null = null;
    let statusChecksEnabled = false;
    let changeRequestContext: GitHubChangeRequestContext | null = null;

    try {
      let context: GitHubChangeRequestContext;
      try {
        context = await this.#githubAdapter.fetchChangeRequestContext({
          installationId: payload.installationId,
          repository: payload.repository,
          pullNumber: payload.pullNumber,
          tenantId: job.tenantId,
          repositoryId: job.repositoryId,
        });
      } catch (error) {
        throw classifyReviewError("github", error);
      }
      changeRequestContext = context;

      const supersededCount =
        await this.#queueScheduler.cancelSupersededReviewJobs({
          repositoryId: job.repositoryId,
          changeRequestId:
            job.changeRequestId ?? `${job.repositoryId}:${payload.pullNumber}`,
          headSha: context.changeRequest.headSha,
        });
      if (supersededCount > 0) {
        this.#logger.info("Superseded queued review jobs for newer head SHA.", {
          jobId: job.id,
          repositoryId: job.repositoryId,
          changeRequestId:
            job.changeRequestId ?? `${job.repositoryId}:${payload.pullNumber}`,
          supersededCount,
        });
      }

      let instructionBundle: InstructionBundle;
      try {
        instructionBundle =
          await this.#instructionBundleLoader.loadForReview(context);
      } catch (error) {
        throw classifyReviewError("github", error);
      }
      statusChecksEnabled = instructionBundle.config.statusChecks.enabled;
      const reviewPlan = this.#reviewPlanner.plan({
        mode: payload.mode,
        config: instructionBundle.config,
        files: context.files.map((file) => ({
          path: file.path,
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
        })),
      });

      this.#logger.info("Planned review job.", {
        jobId: job.id,
        repositoryId: job.repositoryId,
        mode: payload.mode,
        reviewableFileCount: reviewPlan.files.length,
        summaryOnly: reviewPlan.summaryOnly,
      });

      const startedReviewRunId = await this.#reviewLifecycle.startReview({
        tenantId: job.tenantId,
        repositoryId: job.repositoryId,
        changeRequest: context.changeRequest,
        trigger: payload.trigger,
        mode: payload.mode,
        budgets: {
          maxFiles: reviewPlan.files.length,
          maxHunks: instructionBundle.config.review.maxHunks,
          maxTokens: instructionBundle.config.review.maxTokens,
          maxComments: reviewPlan.commentBudget,
          maxDurationMs: REVIEW_DURATION_BUDGET_MS,
        },
        discussionSnapshot: context.comments.map((comment) => ({
          authorLogin: comment.authorLogin,
          body: comment.body,
          path: comment.path,
          line: comment.line,
          providerCreatedAt: comment.createdAt,
        })),
      });
      reviewRunId = startedReviewRunId;

      if (statusChecksEnabled) {
        const pendingCheckRunId = await this.#publishReviewStatus(
          "pending",
          {
            jobId: job.id,
            reviewRunId: startedReviewRunId,
            repositoryId: job.repositoryId,
            sha: context.changeRequest.headSha,
          },
          () =>
            this.#statusPublisher.markPending({
              installationId: payload.installationId,
              repository: payload.repository,
              sha: context.changeRequest.headSha,
              reviewRunId: startedReviewRunId,
              description: "nitpickr review is running.",
            }),
        );
        if (pendingCheckRunId) {
          checkRunId = pendingCheckRunId;
          this.#logger.info("Published pending review status.", {
            jobId: job.id,
            reviewRunId: startedReviewRunId,
            checkRunId,
            repositoryId: job.repositoryId,
            sha: context.changeRequest.headSha,
          });
        } else {
          statusChecksEnabled = false;
        }
      }

      const memories = await this.#memoryService.getRelevantMemories({
        tenantId: job.tenantId,
        repositoryId: job.repositoryId,
        paths: reviewPlan.files.map((file) => file.path),
        limit: Math.max(reviewPlan.commentBudget, 1),
      });

      const rawResult =
        reviewPlan.files.length === 0
          ? {
              summary:
                reviewPlan.skipReason ??
                "No reviewable files matched the current repository configuration.",
              mermaid:
                "flowchart TD\nA[Pull Request] --> B[No Reviewable Files]",
              findings: [],
            }
          : await (async () => {
              try {
                return await this.#reviewEngine.review({
                  changeRequest: {
                    title: context.changeRequest.title,
                    number: context.changeRequest.number,
                  },
                  files: reviewPlan.files,
                  instructionText: this.#renderInstructionText(
                    instructionBundle,
                    memories,
                  ),
                  memory: memories.map((entry) =>
                    entry.path
                      ? {
                          summary: entry.summary,
                          path: entry.path,
                        }
                      : {
                          summary: entry.summary,
                        },
                  ),
                  commentBudget: reviewPlan.commentBudget,
                });
              } catch (error) {
                throw classifyReviewError("review", error);
              }
            })();
      const result = prependSummaryReason(
        reviewPlan.allowSuggestedChanges
          ? rawResult
          : stripSuggestedChanges(rawResult),
        reviewPlan.summaryOnlyReason,
      );

      if (reviewPlan.files.length === 0) {
        this.#logger.info(
          "Skipping inline review; no reviewable files remained after planning.",
          {
            jobId: job.id,
            repositoryId: job.repositoryId,
          },
        );
      } else {
        this.#logger.info("Generated review result.", {
          jobId: job.id,
          reviewRunId: startedReviewRunId,
          findingCount: result.findings.length,
        });
      }

      const publishedComments = this.#publisher.buildInlineComments(
        result.findings,
        {
          files: reviewPlan.files.map((file) => ({
            path: file.path,
            patch: file.patch,
          })),
        },
      );
      const publishedReview = await (async () => {
        try {
          return await this.#publisher.publish({
            reviewRunId: startedReviewRunId,
            installationId: payload.installationId,
            repository: payload.repository,
            pullNumber: payload.pullNumber,
            result: result as ReviewEngineResult,
            files: reviewPlan.files.map((file) => ({
              path: file.path,
              patch: file.patch,
            })),
          });
        } catch (error) {
          throw classifyReviewError("publish", error);
        }
      })();

      await this.#reviewLifecycle.completeReview({
        reviewRunId: startedReviewRunId,
        repositoryId: job.repositoryId,
        status: reviewPlan.files.length === 0 ? "skipped" : "published",
        publishedReviewId: publishedReview.reviewId,
        result,
        publishedComments,
      });
      if (statusChecksEnabled) {
        const description =
          reviewPlan.files.length === 0
            ? "nitpickr skipped inline review for this change."
            : reviewPlan.summaryOnly
              ? "nitpickr published a summary-only review."
              : "nitpickr review completed successfully.";
        if (reviewPlan.files.length === 0) {
          const published = await this.#publishReviewStatus(
            "skipped",
            {
              jobId: job.id,
              reviewRunId: startedReviewRunId,
              checkRunId,
              repositoryId: job.repositoryId,
              sha: context.changeRequest.headSha,
            },
            () =>
              this.#statusPublisher.markSkipped({
                checkRunId: checkRunId ?? "missing-check-run",
                installationId: payload.installationId,
                repository: payload.repository,
                sha: context.changeRequest.headSha,
                reviewRunId: startedReviewRunId,
                description,
                summary: result.summary,
              }),
          );
          if (published !== null) {
            this.#logger.info("Published final review status.", {
              jobId: job.id,
              reviewRunId: startedReviewRunId,
              checkRunId,
              repositoryId: job.repositoryId,
              sha: context.changeRequest.headSha,
              summaryOnly: reviewPlan.summaryOnly,
            });
          }
        } else {
          const published = await this.#publishReviewStatus(
            "published",
            {
              jobId: job.id,
              reviewRunId: startedReviewRunId,
              checkRunId,
              repositoryId: job.repositoryId,
              sha: context.changeRequest.headSha,
            },
            () =>
              this.#statusPublisher.markPublished({
                checkRunId: checkRunId ?? "missing-check-run",
                installationId: payload.installationId,
                repository: payload.repository,
                sha: context.changeRequest.headSha,
                reviewRunId: startedReviewRunId,
                description,
                summary: result.summary,
              }),
          );
          if (published !== null) {
            this.#logger.info("Published final review status.", {
              jobId: job.id,
              reviewRunId: startedReviewRunId,
              checkRunId,
              repositoryId: job.repositoryId,
              sha: context.changeRequest.headSha,
              summaryOnly: reviewPlan.summaryOnly,
            });
          }
        }
      }
      this.#logger.info("Published review result.", {
        jobId: job.id,
        reviewRunId: startedReviewRunId,
        publishedReviewId: publishedReview.reviewId,
        findingCount: result.findings.length,
      });
    } catch (error) {
      if (reviewRunId !== null) {
        await this.#reviewLifecycle.failReview({
          reviewRunId,
          errorMessage:
            error instanceof ReviewJobError
              ? `${error.failureClass}: ${error.message}`
              : toErrorMessage(error),
        });
      }
      if (
        statusChecksEnabled &&
        changeRequestContext !== null &&
        error instanceof ReviewJobError
      ) {
        const failureContext = changeRequestContext;
        const published = await this.#publishReviewStatus(
          "failed",
          {
            jobId: job.id,
            reviewRunId,
            checkRunId,
            repositoryId: job.repositoryId,
            sha: failureContext.changeRequest.headSha,
            failureClass: error.failureClass,
            retryable: error.retryable,
          },
          () =>
            this.#statusPublisher.markFailed({
              installationId: payload.installationId,
              repository: payload.repository,
              sha: failureContext.changeRequest.headSha,
              reviewRunId: reviewRunId ?? `failed:${job.id}`,
              description: `nitpickr ${error.failureClass.replace(/_/g, " ")}.`,
              summary: error.message,
              retryable: error.retryable,
              ...(checkRunId ? { checkRunId } : {}),
            }),
        );
        if (published !== null) {
          this.#logger.info("Published failed review status.", {
            jobId: job.id,
            reviewRunId,
            checkRunId,
            repositoryId: job.repositoryId,
            sha: failureContext.changeRequest.headSha,
            failureClass: error.failureClass,
            retryable: error.retryable,
          });
        }
      }

      throw error;
    }
  }

  async #processMemoryJob(job: QueueJob): Promise<void> {
    const payload = parseMemoryJobPayload(job.payload);
    await this.#memoryService.ingestDiscussion({
      tenantId: job.tenantId,
      repositoryId: job.repositoryId,
      discussions: payload.discussions,
    });
    this.#logger.info("Processed memory ingestion job.", {
      jobId: job.id,
      discussionCount: payload.discussions.length,
    });
  }

  #renderInstructionText(
    instructionBundle: InstructionBundle,
    memories: MemoryEntry[],
  ): string {
    if (memories.length === 0) {
      return instructionBundle.combinedText;
    }

    return [
      instructionBundle.combinedText,
      "",
      "Retrieved memory:",
      ...memories.map((entry) =>
        entry.path ? `${entry.path}: ${entry.summary}` : entry.summary,
      ),
    ].join("\n");
  }

  async #publishReviewStatus<T>(
    phase: ReviewStatusPhase,
    fields: Record<string, unknown>,
    publish: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await publish();
    } catch (error) {
      this.#logger.warn("Review status update failed.", {
        ...fields,
        statusPhase: phase,
        error: toErrorMessage(error),
      });
      return null;
    }
  }
}
