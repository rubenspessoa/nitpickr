import Fastify, { type FastifyInstance } from "fastify";

import { type Logger, noopLogger } from "../logging/logger.js";
import type { GitHubWebhookService } from "./github-webhook-service.js";

export function createApiServer(input: {
  logger?: Logger;
  githubWebhookService: Pick<GitHubWebhookService, "handle">;
}): FastifyInstance {
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

  server.post("/webhooks/github", async (request, reply) => {
    const rawBody = typeof request.body === "string" ? request.body : "";
    const payload = rawBody.length === 0 ? {} : JSON.parse(rawBody);
    const eventName = String(request.headers["x-github-event"] ?? "");
    const signature = String(request.headers["x-hub-signature-256"] ?? "");

    const result = await input.githubWebhookService.handle({
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
