import { type Logger, noopLogger } from "../logging/logger.js";
import type { buildRuntime } from "../runtime/build-runtime.js";
import {
  type GitHubWebhookResult,
  GitHubWebhookService,
} from "./github-webhook-service.js";

type AppRuntime = ReturnType<typeof buildRuntime>;
type OperationalRuntime = Awaited<
  ReturnType<AppRuntime["getOperationalRuntime"]>
>;

export function createSetupAwareGitHubWebhookHandler(input: {
  logger?: Logger;
  runtime: Pick<
    AppRuntime,
    "getOperationalRuntime" | "queueScheduler" | "webhookEventService"
  >;
  createWebhookService?: (
    operationalRuntime: NonNullable<OperationalRuntime>,
  ) => Pick<GitHubWebhookService, "handle">;
}): Pick<GitHubWebhookService, "handle"> {
  const logger = (input.logger ?? noopLogger).child({
    component: "setup-aware-webhook-handler",
  });
  let cachedService: Pick<GitHubWebhookService, "handle"> | null = null;

  const createWebhookService =
    input.createWebhookService ??
    ((operationalRuntime) =>
      new GitHubWebhookService(
        operationalRuntime.githubAdapter,
        input.runtime.queueScheduler,
        logger,
        input.runtime.webhookEventService,
      ));

  return {
    async handle(request) {
      if (cachedService) {
        return cachedService.handle(request);
      }

      const operationalRuntime = await input.runtime.getOperationalRuntime();
      if (!operationalRuntime) {
        return {
          statusCode: 503,
          accepted: false,
          message: "Nitpickr setup is incomplete.",
        };
      }

      cachedService = createWebhookService(operationalRuntime);
      return cachedService.handle(request);
    },
  };
}
