import { env } from "node:process";

import { initSentry } from "../observability/sentry.js";
import { buildRuntime } from "../runtime/build-runtime.js";
import { WorkerRunner } from "./worker-runner.js";

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function main(): Promise<void> {
  const runtime = buildRuntime(env);
  const logger = runtime.logger.child({
    component: "worker",
  });
  initSentry({
    dsn: runtime.config.sentry.dsn,
    environment: runtime.config.nodeEnv,
    tracesSampleRate: runtime.config.sentry.tracesSampleRate,
    logger,
  });
  const workerId = `worker-${process.pid}`;
  let previousSetupStatusSignature: string | null = null;

  logger.info("Starting worker loop.", {
    pollIntervalMs: runtime.config.worker.pollIntervalMs,
    perTenantCap: runtime.config.worker.concurrency,
  });
  for (;;) {
    const freshWorkerIds =
      await runtime.workerHeartbeatService.listFreshWorkerIds(
        runtime.config.ready.workerStaleAfterMs,
      );
    const recoveredJobs = await runtime.queueScheduler.recoverStaleRunningJobs({
      activeWorkerIds: freshWorkerIds,
      staleStartedBefore: new Date(
        Date.now() - runtime.config.jobs.staleAfterMs,
      ),
    });
    if (recoveredJobs > 0) {
      logger.warn("Recovered stale worker jobs.", {
        workerId,
        recoveredJobs,
      });
    }

    const operationalRuntime = await runtime.getOperationalRuntime();
    if (!operationalRuntime) {
      const setupStatus = await runtime.runtimeConfigService.getSetupStatus();
      const setupStatusSignature = JSON.stringify(setupStatus);
      await runtime.workerHeartbeatService.recordHeartbeat({
        workerId,
        status: "setup_required",
      });
      if (previousSetupStatusSignature !== setupStatusSignature) {
        previousSetupStatusSignature = setupStatusSignature;
        logger.warn("Worker is idle until nitpickr setup completes.", {
          workerId,
          setupState: setupStatus.state,
          openAiConfigured: setupStatus.openAiConfigured,
          githubAppConfigured: setupStatus.githubAppConfigured,
        });
      } else {
        logger.debug("Worker remains idle while setup is incomplete.", {
          workerId,
          setupState: setupStatus.state,
        });
      }
      await sleep(runtime.config.worker.pollIntervalMs);
      continue;
    }

    if (previousSetupStatusSignature !== null) {
      previousSetupStatusSignature = null;
      logger.info("Worker resumed after setup completion.", {
        workerId,
      });
    }

    await runtime.workerHeartbeatService.recordHeartbeat({
      workerId,
      status: "ready",
    });
    const runner = new WorkerRunner({
      logger,
      promptOptimizationMode:
        operationalRuntime.config.review.promptOptimizationMode,
      queueScheduler: runtime.queueScheduler,
      githubAdapter: operationalRuntime.githubAdapter,
      instructionBundleLoader: operationalRuntime.instructionBundleLoader,
      memoryService: runtime.memoryService,
      discussionAcknowledgmentStore: runtime.discussionAcknowledgmentStore,
      feedbackService: runtime.feedbackService,
      reviewPlanner: runtime.reviewPlanner,
      reviewLifecycle: runtime.reviewLifecycle,
      reviewEngine: operationalRuntime.reviewEngine,
      publisher: operationalRuntime.publisher,
      statusPublisher: operationalRuntime.reviewStatusPublisher,
    });
    const processed = await runner.runOnce({
      workerId,
      perTenantCap: runtime.config.worker.concurrency,
    });

    if (!processed) {
      await sleep(runtime.config.worker.pollIntervalMs);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
