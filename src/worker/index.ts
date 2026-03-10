import { env } from "node:process";

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
  const workerId = `worker-${process.pid}`;

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
      await runtime.workerHeartbeatService.recordHeartbeat({
        workerId,
        status: "setup_required",
      });
      logger.info("Worker is idle until nitpickr setup completes.", {
        workerId,
      });
      await sleep(runtime.config.worker.pollIntervalMs);
      continue;
    }

    await runtime.workerHeartbeatService.recordHeartbeat({
      workerId,
      status: "ready",
    });
    const runner = new WorkerRunner({
      logger,
      queueScheduler: runtime.queueScheduler,
      githubAdapter: operationalRuntime.githubAdapter,
      instructionBundleLoader: operationalRuntime.instructionBundleLoader,
      memoryService: runtime.memoryService,
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
