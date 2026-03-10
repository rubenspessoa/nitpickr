import { env } from "node:process";

import { buildRuntime } from "../runtime/build-runtime.js";
import { GitHubWebhookService } from "./github-webhook-service.js";
import { createApiServer } from "./server.js";

async function main(): Promise<void> {
  const runtime = buildRuntime(env);
  const logger = runtime.logger.child({
    component: "api",
  });
  const githubWebhookService = new GitHubWebhookService(
    runtime.githubAdapter,
    runtime.queueScheduler,
    logger,
  );
  const server = createApiServer({
    logger,
    githubWebhookService,
  });

  logger.info("Starting API server.", {
    port: runtime.config.port,
  });
  await server.listen({
    host: "0.0.0.0",
    port: runtime.config.port,
  });
  logger.info("API server listening.", {
    port: runtime.config.port,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
