import { parseAppConfig } from "../config/app-config.js";
import { GitHubInstructionBundleLoader } from "../instructions/github-instruction-bundle-loader.js";
import { createLogger } from "../logging/logger.js";
import { MemoryService } from "../memory/memory-service.js";
import { PostgresMemoryStore } from "../memory/postgres-memory-store.js";
import { GitHubAdapter } from "../providers/github/github-adapter.js";
import { GitHubAppAuth } from "../providers/github/github-app-auth.js";
import { GitHubRestClient } from "../providers/github/github-rest-client.js";
import { ReviewPublisher } from "../publisher/review-publisher.js";
import { ReviewStatusPublisher } from "../publisher/review-status-publisher.js";
import { PostgresJobStore } from "../queue/postgres-job-store.js";
import { QueueScheduler } from "../queue/queue-scheduler.js";
import { OpenAiReviewModel } from "../review/openai-review-model.js";
import { PostgresReviewLifecycleStore } from "../review/postgres-review-lifecycle-store.js";
import { ReviewEngine } from "../review/review-engine.js";
import { ReviewLifecycleService } from "../review/review-lifecycle-service.js";
import { ReviewPlanner } from "../review/review-planner.js";
import { createPostgresClient } from "./postgres.js";

export function buildRuntime(environment: Record<string, string | undefined>) {
  const config = parseAppConfig(environment);
  const logger = createLogger({
    level: config.logging.level,
    context: {
      service: "nitpickr",
    },
  });
  const sql = createPostgresClient(config.databaseUrl);
  const githubAuth = new GitHubAppAuth({
    appId: config.github.appId,
    privateKey: config.github.privateKey,
  });
  const githubRestClient = new GitHubRestClient(githubAuth, undefined, {
    baseUrl: config.github.apiBaseUrl,
  });
  const githubAdapter = new GitHubAdapter({
    apiClient: githubRestClient,
    appConfig: config.github,
  });
  const queueScheduler = new QueueScheduler(new PostgresJobStore(sql));
  const memoryService = new MemoryService(new PostgresMemoryStore(sql));
  const reviewLifecycle = new ReviewLifecycleService(
    new PostgresReviewLifecycleStore(sql),
  );
  const reviewPlanner = new ReviewPlanner();
  const reviewEngine = new ReviewEngine(
    new OpenAiReviewModel({
      apiKey: config.openAiApiKey,
      model: config.openAi.model,
      baseUrl: config.openAi.baseUrl,
    }),
  );
  const publisher = new ReviewPublisher({
    listPullRequestReviews: async ({
      installationId,
      repository,
      pullNumber,
    }) =>
      (
        await githubRestClient.listPullRequestReviews({
          installationId,
          owner: repository.owner,
          repo: repository.name,
          pullNumber,
        })
      ).map((review) => ({
        reviewId: String(review.id),
        body: review.body ?? "",
      })),
    publishPullRequestReview: ({
      installationId,
      repository,
      pullNumber,
      body,
      comments,
    }) =>
      githubRestClient.publishPullRequestReview({
        installationId,
        owner: repository.owner,
        repo: repository.name,
        pullNumber,
        body,
        comments,
      }),
  });
  const reviewStatusPublisher = new ReviewStatusPublisher({
    createCheckRun: ({
      installationId,
      repository,
      sha,
      name,
      externalId,
      status,
      conclusion,
      title,
      summary,
    }) =>
      githubRestClient.createCheckRun({
        installationId,
        owner: repository.owner,
        repo: repository.name,
        sha,
        name,
        externalId,
        status,
        ...(conclusion ? { conclusion } : {}),
        title,
        summary,
      }),
    updateCheckRun: ({
      installationId,
      repository,
      checkRunId,
      status,
      conclusion,
      title,
      summary,
    }) =>
      githubRestClient.updateCheckRun({
        installationId,
        owner: repository.owner,
        repo: repository.name,
        checkRunId,
        status,
        ...(conclusion ? { conclusion } : {}),
        title,
        summary,
      }),
  });
  const instructionBundleLoader = new GitHubInstructionBundleLoader(
    githubRestClient,
  );

  return {
    config,
    logger,
    sql,
    githubAdapter,
    queueScheduler,
    memoryService,
    reviewPlanner,
    reviewLifecycle,
    reviewEngine,
    publisher,
    reviewStatusPublisher,
    instructionBundleLoader,
  };
}
