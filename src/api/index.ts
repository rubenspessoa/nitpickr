import { env } from "node:process";

import { initSentry } from "../observability/sentry.js";
import { buildRuntime } from "../runtime/build-runtime.js";
import { createApiServer } from "./server.js";
import { createSetupAwareGitHubWebhookHandler } from "./setup-aware-webhook-handler.js";

async function main(): Promise<void> {
  const runtime = buildRuntime(env);
  const logger = runtime.logger.child({
    component: "api",
  });
  initSentry({
    dsn: runtime.config.sentry.dsn,
    environment: runtime.config.nodeEnv,
    tracesSampleRate: runtime.config.sentry.tracesSampleRate,
    logger,
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
