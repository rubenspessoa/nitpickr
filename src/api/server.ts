import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

import type { ReadinessStatus } from "../health/readiness-service.js";
import { type Logger, noopLogger } from "../logging/logger.js";
import type { SetupStatus } from "../setup/runtime-config-service.js";
import type { GitHubWebhookService } from "./github-webhook-service.js";

const webhookPayloadSchema = z.record(z.string(), z.unknown());

function renderSetupPage(setupStatus: SetupStatus): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>nitpickr setup</title>
  </head>
  <body>
    <main>
      <h1>nitpickr setup</h1>
      <p>State: <strong>${setupStatus.state}</strong></p>
      <ul>
        <li>OpenAI configured: ${setupStatus.openAiConfigured ? "yes" : "no"}</li>
        <li>GitHub App configured: ${setupStatus.githubAppConfigured ? "yes" : "no"}</li>
      </ul>
    </main>
  </body>
</html>`;
}

type GitHubWebhookHandler = Pick<GitHubWebhookService, "handle">;

export interface ApiServerDependencies {
  logger?: Logger;
  // This stays optional while nitpickr is in setup_required mode.
  // In that state the API still serves health/setup endpoints, but webhook
  // requests are rejected with 503 until onboarding finishes.
  githubWebhookService?: GitHubWebhookHandler;
  readinessService?: {
    getStatus(): Promise<ReadinessStatus>;
  };
  setupStatusService?: {
    getSetupStatus(): Promise<SetupStatus>;
  };
}

export function createApiServer(input: ApiServerDependencies): FastifyInstance {
  const githubWebhookService = input.githubWebhookService;
  const readinessService = input.readinessService;
  const setupStatusService = input.setupStatusService;
  const server = Fastify({
    logger: false,
  });
  const logger = (input.logger ?? noopLogger).child({
    component: "api-server",
  });

  server.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    },
  );

  server.get("/healthz", async () => ({
    ok: true,
  }));

  server.get("/readyz", async (_request, reply) => {
    if (!readinessService) {
      return {
        ok: true,
        state: "ready",
        checks: {
          database: true,
          setup: true,
          worker: true,
        },
        reasons: [],
      };
    }

    const status = await readinessService.getStatus();
    return reply.status(status.ok ? 200 : 503).send(status);
  });

  server.get("/setup", async (_request, reply) => {
    const setupStatus = setupStatusService
      ? await setupStatusService.getSetupStatus()
      : {
          state: "ready" as const,
          openAiConfigured: true,
          githubAppConfigured: true,
          ready: true,
        };

    return reply
      .type("text/html; charset=utf-8")
      .status(200)
      .send(renderSetupPage(setupStatus));
  });

  server.get("/setup/status", async () => {
    if (!setupStatusService) {
      return {
        state: "ready" as const,
        openAiConfigured: true,
        githubAppConfigured: true,
        ready: true,
      };
    }

    return setupStatusService.getSetupStatus();
  });

  server.post("/webhooks/github", async (request, reply) => {
    if (!githubWebhookService) {
      return reply.status(503).send({
        accepted: false,
        message: "Nitpickr setup is incomplete.",
      });
    }

    const rawBody = typeof request.body === "string" ? request.body : "";
    let payload: Record<string, unknown>;
    try {
      payload = webhookPayloadSchema.parse(
        rawBody.length === 0 ? {} : JSON.parse(rawBody),
      );
    } catch {
      return reply.status(400).send({
        accepted: false,
        message: "Invalid GitHub webhook payload.",
      });
    }
    const deliveryId = request.headers["x-github-delivery"];
    const eventName = String(request.headers["x-github-event"] ?? "");
    const signature = String(request.headers["x-hub-signature-256"] ?? "");

    const result = await githubWebhookService.handle({
      ...(typeof deliveryId === "string" && deliveryId.trim().length > 0
        ? { deliveryId }
        : {}),
      eventName,
      signature,
      rawBody,
      payload,
    });

    return reply.status(result.statusCode).send({
      accepted: result.accepted,
      message: result.message,
    });
  });

  server.setErrorHandler((error, request, reply) => {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown API error.";
    logger.error("API request failed.", {
      method: request.method,
      url: request.url,
      error: errorMessage,
    });

    void reply.status(500).send({
      accepted: false,
      message: "Internal server error.",
    });
  });

  return server;
}
