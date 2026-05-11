import { env } from "node:process";

import * as Sentry from "@sentry/node";

import { buildRuntime } from "../runtime/build-runtime.js";
import { createApiServer } from "./server.js";
import { createSetupAwareGitHubWebhookHandler } from "./setup-aware-webhook-handler.js";

async function main(): Promise<void> {
  const runtime = buildRuntime(env);
  const logger = runtime.logger.child({
    component: "api",
  });
  const githubWebhookService = createSetupAwareGitHubWebhookHandler({
    logger,
    runtime,
  });
  const server = createApiServer({
    logger,
    readinessService: runtime.readinessService,
    setupStatusService: runtime.runtimeConfigService,
    githubWebhookService,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("Shutting down API server.", { signal });
    try {
      await server.close();
    } catch (error) {
      logger.error("Error while closing API server.", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // Flush buffered Sentry events before exit.
    await Sentry.close(2000);
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

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
