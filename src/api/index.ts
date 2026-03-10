import { env } from "node:process";

import { buildRuntime } from "../runtime/build-runtime.js";
import { GitHubWebhookService } from "./github-webhook-service.js";
import { createApiServer } from "./server.js";

async function main(): Promise<void> {
  const runtime = buildRuntime(env);
  const logger = runtime.logger.child({
    component: "api",
  });
  const server = createApiServer({
    logger,
    readinessService: runtime.readinessService,
    setupStatusService: runtime.runtimeConfigService,
    githubWebhookService: {
      handle: async (input) => {
        const operationalRuntime = await runtime.getOperationalRuntime();
        if (!operationalRuntime) {
          return {
            statusCode: 503,
            accepted: false,
            message: "Nitpickr setup is incomplete.",
          };
        }

        const githubWebhookService = new GitHubWebhookService(
          operationalRuntime.githubAdapter,
          runtime.queueScheduler,
          logger,
          runtime.webhookEventService,
        );

        return githubWebhookService.handle(input);
      },
    },
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
