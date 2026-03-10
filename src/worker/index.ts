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
  const runner = new WorkerRunner({
    logger,
    queueScheduler: runtime.queueScheduler,
    githubAdapter: runtime.githubAdapter,
    instructionBundleLoader: runtime.instructionBundleLoader,
    memoryService: runtime.memoryService,
    reviewPlanner: runtime.reviewPlanner,
    reviewLifecycle: runtime.reviewLifecycle,
    reviewEngine: runtime.reviewEngine,
    publisher: runtime.publisher,
    statusPublisher: runtime.reviewStatusPublisher,
  });

  logger.info("Starting worker loop.", {
    pollIntervalMs: runtime.config.worker.pollIntervalMs,
    perTenantCap: runtime.config.worker.concurrency,
  });
  for (;;) {
    const processed = await runner.runOnce({
      workerId: `worker-${process.pid}`,
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
