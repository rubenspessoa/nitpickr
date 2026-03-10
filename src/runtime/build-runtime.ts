import type postgres from "postgres";

import { PostgresWebhookEventStore } from "../api/postgres-webhook-event-store.js";
import { WebhookEventService } from "../api/webhook-event-service.js";
import {
  type AppConfig,
  buildAppConfig,
  parseBootstrapConfig,
  parseRuntimeSecretsFromEnvironment,
} from "../config/app-config.js";
import { PostgresWorkerHeartbeatStore } from "../health/postgres-worker-heartbeat-store.js";
import { ReadinessService } from "../health/readiness-service.js";
import { WorkerHeartbeatService } from "../health/worker-heartbeat-service.js";
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
import { PostgresRuntimeConfigStore } from "../setup/postgres-runtime-config-store.js";
import { RuntimeConfigService } from "../setup/runtime-config-service.js";
import { SecretCrypto } from "../setup/secret-crypto.js";
import { createPostgresClient } from "./postgres.js";

interface OperationalRuntime {
  config: AppConfig;
  githubAdapter: GitHubAdapter;
  reviewEngine: ReviewEngine;
  publisher: ReviewPublisher;
  reviewStatusPublisher: ReviewStatusPublisher;
  instructionBundleLoader: GitHubInstructionBundleLoader;
}

export interface AppRuntime {
  config: ReturnType<typeof parseBootstrapConfig>;
  logger: ReturnType<typeof createLogger>;
  sql: ReturnType<typeof createPostgresClient>;
  queueScheduler: QueueScheduler;
  memoryService: MemoryService;
  reviewPlanner: ReviewPlanner;
  reviewLifecycle: ReviewLifecycleService;
  runtimeConfigService: RuntimeConfigService;
  webhookEventService: WebhookEventService;
  workerHeartbeatService: WorkerHeartbeatService;
  readinessService: ReadinessService;
  getOperationalRuntime(): Promise<OperationalRuntime | null>;
}

export function buildRuntime(
  environment: Record<string, string | undefined>,
): AppRuntime {
  const config = parseBootstrapConfig(environment);
  const logger = createLogger({
    level: config.logging.level,
    context: {
      service: "nitpickr",
    },
  });
  const sql = createPostgresClient(config.databaseUrl);
  const queueScheduler = new QueueScheduler(new PostgresJobStore(sql));
  const memoryService = new MemoryService(new PostgresMemoryStore(sql));
  const reviewLifecycle = new ReviewLifecycleService(
    new PostgresReviewLifecycleStore(sql),
  );
  const reviewPlanner = new ReviewPlanner();
  const webhookEventService = new WebhookEventService(
    new PostgresWebhookEventStore({
      query: (query, params) =>
        sql.unsafe(
          query,
          params
            ? ([...params] as postgres.ParameterOrJSON<never>[])
            : undefined,
        ),
    }),
  );
  const runtimeConfigService = new RuntimeConfigService(
    config.secretKey
      ? new PostgresRuntimeConfigStore(sql, new SecretCrypto(config.secretKey))
      : null,
  );
  const workerHeartbeatService = new WorkerHeartbeatService(
    new PostgresWorkerHeartbeatStore(sql),
  );
  const readinessService = new ReadinessService({
    runtimeConfigService,
    workerHeartbeatService,
    pingDatabase: async () => {
      await sql.unsafe("select 1 as ok");
    },
    workerStaleAfterMs: config.ready.workerStaleAfterMs,
  });

  let cachedOperationalRuntime: {
    signature: string;
    runtime: OperationalRuntime;
  } | null = null;

  async function getOperationalRuntime(): Promise<OperationalRuntime | null> {
    const environmentSecrets = parseRuntimeSecretsFromEnvironment(environment);
    const source =
      environmentSecrets !== null ? "environment" : "persisted_store";
    const secrets =
      environmentSecrets ?? (await runtimeConfigService.loadRuntimeSecrets());

    if (!secrets) {
      return null;
    }

    const signature = JSON.stringify({
      source,
      secrets,
    });
    if (cachedOperationalRuntime?.signature === signature) {
      return cachedOperationalRuntime.runtime;
    }

    const operationalConfig = buildAppConfig(config, secrets, source);
    const githubAuth = new GitHubAppAuth({
      appId: operationalConfig.github.appId,
      privateKey: operationalConfig.github.privateKey,
    });
    const githubRestClient = new GitHubRestClient(githubAuth, undefined, {
      baseUrl: operationalConfig.github.apiBaseUrl,
    });
    const githubAdapter = new GitHubAdapter({
      apiClient: githubRestClient,
      appConfig: operationalConfig.github,
    });
    const reviewEngine = new ReviewEngine(
      new OpenAiReviewModel({
        apiKey: operationalConfig.openAiApiKey,
        model: operationalConfig.openAi.model,
        baseUrl: operationalConfig.openAi.baseUrl,
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

    cachedOperationalRuntime = {
      signature,
      runtime: {
        config: operationalConfig,
        githubAdapter,
        reviewEngine,
        publisher,
        reviewStatusPublisher,
        instructionBundleLoader,
      },
    };

    return cachedOperationalRuntime.runtime;
  }

  return {
    config,
    logger,
    sql,
    queueScheduler,
    memoryService,
    reviewPlanner,
    reviewLifecycle,
    runtimeConfigService,
    webhookEventService,
    workerHeartbeatService,
    readinessService,
    getOperationalRuntime,
  };
}
