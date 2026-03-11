import { type ReviewRun, parseReviewTrigger } from "../domain/types.js";
import type { ReviewFeedbackService } from "../feedback/review-feedback-service.js";
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
import type { PromptOptimizationMode } from "../review/prompt-payload-optimizer.js";
import type {
  ReviewEngine,
  ReviewEngineResult,
} from "../review/review-engine.js";
import type { ReviewLifecycleService } from "../review/review-lifecycle-service.js";
import type { ReviewPlanner } from "../review/review-planner.js";
import {
  type ReviewerChatCommand,
  ReviewerChatService,
  parseInlineCommentContext,
} from "../review/reviewer-chat-service.js";

const REVIEW_DURATION_BUDGET_MS = 300_000;

function emptyPromptUsageSnapshot() {
  return {
    chunkCount: 0,
    primaryPatchChars: 0,
    contextPatchChars: 0,
    instructionChars: 0,
    memoryChars: 0,
    estimatedPromptTokens: 0,
  };
}

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

function determineReviewScope(
  trigger: ReturnType<typeof parseReviewTrigger>,
): ReviewRun["scope"] {
  return trigger.type === "pr_synchronized" ? "commit_delta" : "full_pr";
}

function isAutomaticTrigger(
  trigger: ReturnType<typeof parseReviewTrigger>,
): boolean {
  return (
    trigger.type === "pr_opened" ||
    trigger.type === "pr_ready_for_review" ||
    trigger.type === "pr_synchronized"
  );
}

function selectPublishableResult(
  result: ReviewEngineResult,
  trigger: ReturnType<typeof parseReviewTrigger>,
): ReviewEngineResult {
  if (!isAutomaticTrigger(trigger)) {
    return result;
  }

  return {
    ...result,
    findings: result.findings.filter(
      (finding) =>
        finding.findingType === "bug" ||
        finding.findingType === "safe_suggestion",
    ),
  };
}

async function enrichPublishedCommentsWithProviderMetadata(
  comments: Array<{
    path: string;
    line: number;
    body: string;
    fingerprint?: string | null;
    providerThreadId?: string | null;
    providerCommentId?: string | null;
    resolvedAt?: string | null;
  }>,
  threads: Array<{
    threadId: string;
    providerCommentId: string;
    path: string;
    line: number;
    fingerprint: string;
    isResolved: boolean;
  }>,
): Promise<
  Array<{
    path: string;
    line: number;
    body: string;
    providerThreadId: string | null;
    providerCommentId: string | null;
    fingerprint: string | null;
    resolvedAt: string | null;
  }>
> {
  return comments.map((comment) => {
    const thread =
      comment.fingerprint === undefined
        ? null
        : (threads.find(
            (candidate) => candidate.fingerprint === comment.fingerprint,
          ) ?? null);

    return {
      path: comment.path,
      line: comment.line,
      body: comment.body,
      providerThreadId: thread?.threadId ?? null,
      providerCommentId: thread?.providerCommentId ?? null,
      fingerprint: comment.fingerprint ?? null,
      resolvedAt: null,
    };
  });
}

function findStaleThreadIds(input: {
  comparedPaths: string[];
  currentFingerprints: Set<string>;
  threads: Array<{
    threadId: string;
    path: string;
    fingerprint: string;
    isResolved: boolean;
  }>;
}): string[] {
  const comparedPathSet = new Set(input.comparedPaths);

  return input.threads
    .filter(
      (thread) =>
        !thread.isResolved &&
        comparedPathSet.has(thread.path) &&
        !input.currentFingerprints.has(thread.fingerprint),
    )
    .map((thread) => thread.threadId);
}

function categoryFromFingerprint(
  fingerprint: string,
): ReviewEngineResult["findings"][number]["category"] {
  const category = fingerprint.split(":")[2];

  switch (category) {
    case "correctness":
    case "performance":
    case "security":
    case "maintainability":
    case "testing":
    case "style":
      return category;
    default:
      return "maintainability";
  }
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

function parseInteractionJobPayload(payload: QueueJob["payload"]): {
  installationId: string;
  repository: {
    owner: string;
    name: string;
  };
  pullNumber: number;
  actorLogin: string;
  command: ReviewerChatCommand;
  replyTargetCommentId: number | null;
  source:
    | {
        kind: "issue_comment";
        commentId: number;
        body: string;
        argumentText: string | null;
      }
    | {
        kind: "review_comment";
        commentId: number;
        body: string;
        argumentText: string | null;
        path: string | null;
        line: number | null;
      };
} {
  const installationId = payload.installationId;
  const repository = payload.repository as Record<string, unknown> | undefined;
  const pullNumber = payload.pullNumber;
  const actorLogin = payload.actorLogin;
  const command = payload.command;
  const source = payload.source as Record<string, unknown> | undefined;

  if (
    typeof installationId !== "string" ||
    installationId.trim().length === 0
  ) {
    throw new Error("interaction job installationId must not be empty.");
  }
  if (
    typeof repository !== "object" ||
    repository === null ||
    typeof repository.owner !== "string" ||
    repository.owner.trim().length === 0 ||
    typeof repository.name !== "string" ||
    repository.name.trim().length === 0
  ) {
    throw new Error("interaction job repository must be present.");
  }
  if (
    typeof pullNumber !== "number" ||
    !Number.isInteger(pullNumber) ||
    pullNumber <= 0
  ) {
    throw new Error("interaction job pullNumber must be positive.");
  }
  if (typeof actorLogin !== "string" || actorLogin.trim().length === 0) {
    throw new Error("interaction job actorLogin must not be empty.");
  }
  if (
    command !== "why" &&
    command !== "teach" &&
    command !== "reconsider" &&
    command !== "fix" &&
    command !== "learn" &&
    command !== "status"
  ) {
    throw new Error("interaction job command is invalid.");
  }
  if (
    typeof source !== "object" ||
    source === null ||
    typeof source.kind !== "string"
  ) {
    throw new Error("interaction job source must be present.");
  }

  if (source.kind === "issue_comment") {
    if (
      typeof source.commentId !== "number" ||
      !Number.isInteger(source.commentId) ||
      source.commentId <= 0 ||
      typeof source.body !== "string"
    ) {
      throw new Error("interaction issue comment source is invalid.");
    }

    return {
      installationId,
      repository: {
        owner: repository.owner,
        name: repository.name,
      },
      pullNumber,
      actorLogin,
      command,
      replyTargetCommentId:
        typeof payload.replyTargetCommentId === "number" &&
        Number.isInteger(payload.replyTargetCommentId) &&
        payload.replyTargetCommentId > 0
          ? payload.replyTargetCommentId
          : null,
      source: {
        kind: "issue_comment",
        commentId: source.commentId,
        body: source.body,
        argumentText:
          typeof source.argumentText === "string" ? source.argumentText : null,
      },
    };
  }

  if (
    source.kind === "review_comment" &&
    typeof source.commentId === "number" &&
    Number.isInteger(source.commentId) &&
    source.commentId > 0 &&
    typeof source.body === "string"
  ) {
    return {
      installationId,
      repository: {
        owner: repository.owner,
        name: repository.name,
      },
      pullNumber,
      actorLogin,
      command,
      replyTargetCommentId:
        typeof payload.replyTargetCommentId === "number" &&
        Number.isInteger(payload.replyTargetCommentId) &&
        payload.replyTargetCommentId > 0
          ? payload.replyTargetCommentId
          : null,
      source: {
        kind: "review_comment",
        commentId: source.commentId,
        body: source.body,
        argumentText:
          typeof source.argumentText === "string" ? source.argumentText : null,
        path: typeof source.path === "string" ? source.path : null,
        line:
          typeof source.line === "number" &&
          Number.isInteger(source.line) &&
          source.line > 0
            ? source.line
            : null,
      },
    };
  }

  throw new Error("interaction job source is invalid.");
}

export interface InstructionBundleLoader {
  loadForReview(
    context: GitHubChangeRequestContext,
  ): Promise<InstructionBundle>;
}

export interface WorkerRunnerDependencies {
  logger?: Logger;
  promptOptimizationMode?: PromptOptimizationMode;
  queueScheduler: Pick<
    QueueScheduler,
    "claimNextJobs" | "cancelSupersededReviewJobs" | "completeJob" | "failJob"
  >;
  githubAdapter: Pick<GitHubAdapter, "fetchChangeRequestContext"> &
    Partial<
      Pick<
        GitHubAdapter,
        | "comparePullRequestRange"
        | "createIssueComment"
        | "listNitpickrReviewThreads"
        | "replyToReviewComment"
        | "resolveReviewThread"
      >
    >;
  instructionBundleLoader: InstructionBundleLoader;
  memoryService: Pick<
    MemoryService,
    "getRelevantMemories" | "ingestDiscussion"
  >;
  feedbackService?: Pick<
    ReviewFeedbackService,
    "getSignals" | "recordOutcome" | "syncCommentReactions"
  >;
  reviewPlanner: Pick<ReviewPlanner, "plan">;
  reviewerChatService?: Pick<ReviewerChatService, "respond">;
  reviewLifecycle: Pick<
    ReviewLifecycleService,
    "startReview" | "completeReview" | "failReview"
  > &
    Partial<
      Pick<
        ReviewLifecycleService,
        "getLatestCompletedReview" | "markPublishedCommentsResolved"
      >
    >;
  reviewEngine: Pick<ReviewEngine, "review"> &
    Partial<Pick<ReviewEngine, "reviewWithDiagnostics">>;
  publisher: Pick<ReviewPublisher, "buildInlineComments" | "publish">;
  statusPublisher?: Pick<
    ReviewStatusPublisher,
    "markFailed" | "markPending" | "markPublished" | "markSkipped"
  >;
}

export class WorkerRunner {
  readonly #logger: Logger;
  readonly #promptOptimizationMode: PromptOptimizationMode;
  readonly #queueScheduler: WorkerRunnerDependencies["queueScheduler"];
  readonly #githubAdapter: WorkerRunnerDependencies["githubAdapter"];
  readonly #instructionBundleLoader: WorkerRunnerDependencies["instructionBundleLoader"];
  readonly #memoryService: WorkerRunnerDependencies["memoryService"];
  readonly #feedbackService: WorkerRunnerDependencies["feedbackService"];
  readonly #reviewPlanner: WorkerRunnerDependencies["reviewPlanner"];
  readonly #reviewerChatService: Pick<ReviewerChatService, "respond">;
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
    this.#promptOptimizationMode = input.promptOptimizationMode ?? "balanced";
    this.#queueScheduler = input.queueScheduler;
    this.#githubAdapter = input.githubAdapter;
    this.#instructionBundleLoader = input.instructionBundleLoader;
    this.#memoryService = input.memoryService;
    this.#feedbackService = input.feedbackService;
    this.#reviewPlanner = input.reviewPlanner;
    this.#reviewerChatService =
      input.reviewerChatService ?? new ReviewerChatService();
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
      } else if (job.type === "interaction_requested") {
        await this.#processInteractionJob(job);
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
    let resolvedThreadCount = 0;

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
      const reviewScope = determineReviewScope(payload.trigger);
      const latestCompletedReview =
        reviewScope === "commit_delta" &&
        this.#reviewLifecycle.getLatestCompletedReview
          ? await this.#reviewLifecycle.getLatestCompletedReview(
              context.changeRequest.id,
            )
          : null;
      const comparedFromSha =
        latestCompletedReview &&
        latestCompletedReview.headSha !== context.changeRequest.headSha
          ? latestCompletedReview.headSha
          : null;
      const comparePullRequestRange =
        this.#githubAdapter.comparePullRequestRange?.bind(this.#githubAdapter);
      const reviewFiles =
        reviewScope === "commit_delta" &&
        comparedFromSha &&
        comparePullRequestRange
          ? await (async () => {
              try {
                return await comparePullRequestRange({
                  installationId: payload.installationId,
                  repository: payload.repository,
                  baseSha: comparedFromSha,
                  headSha: context.changeRequest.headSha,
                });
              } catch (error) {
                throw classifyReviewError("github", error);
              }
            })()
          : context.files;

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
        files: reviewFiles.map((file) => ({
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
        scope: reviewScope,
        optimizationMode: this.#promptOptimizationMode,
        comparedFromSha,
        reviewableFileCount: reviewPlan.files.length,
        summaryOnly: reviewPlan.summaryOnly,
      });

      const startedReviewRunId = await this.#reviewLifecycle.startReview({
        tenantId: job.tenantId,
        repositoryId: job.repositoryId,
        changeRequest: context.changeRequest,
        trigger: payload.trigger,
        mode: payload.mode,
        scope: reviewScope,
        comparedFromSha,
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
      const existingNitpickrThreads = this.#githubAdapter
        .listNitpickrReviewThreads
        ? await this.#githubAdapter.listNitpickrReviewThreads({
            installationId: payload.installationId,
            repository: payload.repository,
            pullNumber: payload.pullNumber,
          })
        : [];
      if (this.#feedbackService && existingNitpickrThreads.length > 0) {
        await this.#feedbackService.syncCommentReactions({
          tenantId: job.tenantId,
          repositoryId: job.repositoryId,
          comments: existingNitpickrThreads.map((thread) => ({
            providerCommentId: thread.providerCommentId,
            fingerprint: thread.fingerprint,
            path: thread.path,
            category: categoryFromFingerprint(thread.fingerprint),
            positiveCount: thread.reactionSummary.positiveCount,
            negativeCount: thread.reactionSummary.negativeCount,
          })),
        });
      }
      const feedbackSignals = this.#feedbackService
        ? await this.#feedbackService.getSignals({
            tenantId: job.tenantId,
            repositoryId: job.repositoryId,
            paths: reviewPlan.files.map((file) => file.path),
            limit: Math.max(reviewPlan.commentBudget * 2, 10),
          })
        : [];

      const diagnostics =
        reviewPlan.files.length === 0
          ? {
              result: {
                summary:
                  reviewPlan.skipReason ??
                  "No reviewable files matched the current repository configuration.",
                mermaid:
                  "flowchart TD\nA[Pull Request] --> B[No Reviewable Files]",
                findings: [],
              },
              rejectedFindings: [],
              promptUsage: {
                beforeCompaction: emptyPromptUsageSnapshot(),
                afterCompaction: emptyPromptUsageSnapshot(),
              },
            }
          : await (async () => {
              try {
                const reviewInput = {
                  changeRequest: {
                    title: context.changeRequest.title,
                    number: context.changeRequest.number,
                  },
                  files: reviewPlan.files,
                  scope: reviewScope,
                  optimizationMode: this.#promptOptimizationMode,
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
                  ...(feedbackSignals.length === 0 ? {} : { feedbackSignals }),
                  ...(isAutomaticTrigger(payload.trigger)
                    ? {
                        publishableFindingTypes: [
                          "bug" as const,
                          "safe_suggestion" as const,
                        ],
                      }
                    : {}),
                  ...(reviewScope === "commit_delta"
                    ? {
                        contextFiles: context.files.map((file) => ({
                          path: file.path,
                          additions: file.additions,
                          deletions: file.deletions,
                          patch: file.patch,
                        })),
                      }
                    : {}),
                };

                if (this.#reviewEngine.reviewWithDiagnostics) {
                  return await this.#reviewEngine.reviewWithDiagnostics(
                    reviewInput,
                  );
                }

                return {
                  result: await this.#reviewEngine.review(reviewInput),
                  rejectedFindings: [],
                  promptUsage: {
                    beforeCompaction: emptyPromptUsageSnapshot(),
                    afterCompaction: emptyPromptUsageSnapshot(),
                  },
                };
              } catch (error) {
                throw classifyReviewError("review", error);
              }
            })();
      const rawResult = diagnostics.result;
      const result = prependSummaryReason(
        reviewPlan.allowSuggestedChanges
          ? rawResult
          : stripSuggestedChanges(rawResult),
        reviewPlan.summaryOnlyReason,
      );
      const publishableResult = this.#reviewEngine.reviewWithDiagnostics
        ? result
        : selectPublishableResult(result, payload.trigger);

      if (diagnostics.rejectedFindings.length > 0) {
        this.#logger.info("Suppressed findings after evidence gating.", {
          jobId: job.id,
          reviewRunId: startedReviewRunId,
          suppressedFindingCount: diagnostics.rejectedFindings.length,
        });
      }

      this.#logger.info("Review prompt usage before compaction.", {
        jobId: job.id,
        reviewRunId: startedReviewRunId,
        scope: reviewScope,
        optimizationMode: this.#promptOptimizationMode,
        ...diagnostics.promptUsage.beforeCompaction,
      });
      this.#logger.info("Review prompt usage after compaction.", {
        jobId: job.id,
        reviewRunId: startedReviewRunId,
        scope: reviewScope,
        optimizationMode: this.#promptOptimizationMode,
        ...diagnostics.promptUsage.afterCompaction,
      });

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
          findingCount: publishableResult.findings.length,
        });
      }

      const draftPublishedComments = this.#publisher.buildInlineComments(
        publishableResult.findings,
        {
          files: reviewPlan.files.map((file) => ({
            path: file.path,
            patch: file.patch,
          })),
        },
      );
      if (reviewScope === "commit_delta") {
        const staleThreadIds = findStaleThreadIds({
          comparedPaths: reviewPlan.files.map((file) => file.path),
          currentFingerprints: new Set(
            draftPublishedComments.map((comment) => comment.fingerprint),
          ),
          threads: existingNitpickrThreads,
        });
        for (const threadId of staleThreadIds) {
          try {
            if (this.#githubAdapter.resolveReviewThread) {
              await this.#githubAdapter.resolveReviewThread({
                installationId: payload.installationId,
                threadId,
              });
              resolvedThreadCount += 1;
            }
          } catch (error) {
            this.#logger.warn(
              "Failed to resolve stale nitpickr review thread.",
              {
                jobId: job.id,
                reviewRunId: startedReviewRunId,
                threadId,
                error: toErrorMessage(error),
              },
            );
          }
        }
        if (resolvedThreadCount > 0) {
          await this.#reviewLifecycle.markPublishedCommentsResolved?.(
            staleThreadIds,
          );
          if (this.#feedbackService) {
            await this.#feedbackService.recordOutcome({
              tenantId: job.tenantId,
              repositoryId: job.repositoryId,
              events: existingNitpickrThreads
                .filter((thread) => staleThreadIds.includes(thread.threadId))
                .map((thread) => ({
                  fingerprint: thread.fingerprint,
                  path: thread.path,
                  category: categoryFromFingerprint(thread.fingerprint),
                  kind: "fixed_after_comment" as const,
                })),
            });
          }
        }
      }
      const publishedReview = await (async () => {
        try {
          return await this.#publisher.publish({
            reviewRunId: startedReviewRunId,
            installationId: payload.installationId,
            repository: payload.repository,
            pullNumber: payload.pullNumber,
            publishMode:
              reviewScope === "commit_delta" ? "commit_summary" : "pr_summary",
            reviewedCommitSha: context.changeRequest.headSha,
            commitSummaryCounts: {
              newFindings: publishableResult.findings.length,
              resolvedThreads: resolvedThreadCount,
              stillRelevantFindings: publishableResult.findings.length,
            },
            result: publishableResult as ReviewEngineResult,
            files: reviewPlan.files.map((file) => ({
              path: file.path,
              patch: file.patch,
            })),
          });
        } catch (error) {
          throw classifyReviewError("publish", error);
        }
      })();
      const nitpickrThreads = this.#githubAdapter.listNitpickrReviewThreads
        ? await this.#githubAdapter.listNitpickrReviewThreads({
            installationId: payload.installationId,
            repository: payload.repository,
            pullNumber: payload.pullNumber,
          })
        : [];
      const publishedComments =
        await enrichPublishedCommentsWithProviderMetadata(
          draftPublishedComments,
          nitpickrThreads,
        );

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
        findingCount: publishableResult.findings.length,
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

  async #processInteractionJob(job: QueueJob): Promise<void> {
    const payload = parseInteractionJobPayload(job.payload);
    const latestReview = this.#reviewLifecycle.getLatestCompletedReview
      ? await this.#reviewLifecycle.getLatestCompletedReview(
          job.changeRequestId ?? `${job.repositoryId}:${payload.pullNumber}`,
        )
      : null;
    const nitpickrThreads = this.#githubAdapter.listNitpickrReviewThreads
      ? await this.#githubAdapter.listNitpickrReviewThreads({
          installationId: payload.installationId,
          repository: payload.repository,
          pullNumber: payload.pullNumber,
        })
      : [];
    const referencedThread =
      payload.replyTargetCommentId === null
        ? null
        : (nitpickrThreads.find(
            (thread) =>
              thread.providerCommentId === String(payload.replyTargetCommentId),
          ) ?? null);
    const threadContext =
      referencedThread === null
        ? null
        : (() => {
            const parsed = parseInlineCommentContext(referencedThread.body);
            return {
              providerCommentId: referencedThread.providerCommentId,
              path: referencedThread.path,
              line: referencedThread.line,
              fingerprint: referencedThread.fingerprint,
              title: parsed.title,
              body: parsed.body,
              fixPrompt: parsed.fixPrompt,
            };
          })();

    const reply = await this.#reviewerChatService.respond({
      command: payload.command,
      actorLogin: payload.actorLogin,
      argumentText: payload.source.argumentText,
      latestReview,
      thread: threadContext,
    });

    if (reply.memoryDiscussions.length > 0) {
      await this.#memoryService.ingestDiscussion({
        tenantId: job.tenantId,
        repositoryId: job.repositoryId,
        discussions: reply.memoryDiscussions,
      });
    }
    if (this.#feedbackService && reply.feedbackEvents.length > 0) {
      await this.#feedbackService.recordOutcome({
        tenantId: job.tenantId,
        repositoryId: job.repositoryId,
        events: reply.feedbackEvents,
      });
    }

    if (payload.source.kind === "issue_comment") {
      if (!this.#githubAdapter.createIssueComment) {
        throw new Error("GitHub issue comment replies are unavailable.");
      }
      await this.#githubAdapter.createIssueComment({
        installationId: payload.installationId,
        repository: payload.repository,
        pullNumber: payload.pullNumber,
        body: reply.body,
      });
    } else {
      if (!this.#githubAdapter.replyToReviewComment) {
        throw new Error("GitHub review comment replies are unavailable.");
      }
      await this.#githubAdapter.replyToReviewComment({
        installationId: payload.installationId,
        repository: payload.repository,
        pullNumber: payload.pullNumber,
        commentId: payload.replyTargetCommentId ?? payload.source.commentId,
        body: reply.body,
      });
    }

    this.#logger.info("Processed reviewer interaction job.", {
      jobId: job.id,
      repositoryId: job.repositoryId,
      command: payload.command,
      sourceKind: payload.source.kind,
    });
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
