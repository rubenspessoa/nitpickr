import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z } from "zod";

import type { ReadinessStatus } from "../health/readiness-service.js";
import { type Logger, noopLogger } from "../logging/logger.js";
import type { SetupStatus } from "../setup/runtime-config-service.js";
import type { GitHubWebhookHandler } from "./github-webhook-service.js";
import {
  InMemoryWebhookRateLimiter,
  type WebhookRateLimiter,
} from "./webhook-rate-limiter.js";

const webhookPayloadSchema = z.custom<Record<string, unknown>>(
  (value): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value),
  "GitHub webhook payload must be a JSON object.",
);
const githubWebhookHeadersSchema = z.object({
  eventName: z.string().min(1),
  signature: z.string().min(1),
  deliveryId: z.string().min(1),
});
const invalidWebhookPayloadMessage = "Invalid GitHub webhook payload.";
const invalidWebhookHeadersMessage = "Missing required GitHub webhook headers.";
const invalidWebhookContentTypeMessage =
  "GitHub webhooks must use Content-Type: application/json.";

function buildDefaultSetupStatus(): SetupStatus {
  return {
    state: "ready",
    openAiConfigured: true,
    githubAppConfigured: true,
    ready: true,
  };
}

function hasJsonContentType(
  headerValue: string | string[] | undefined,
): boolean {
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!header) {
    return false;
  }

  return header.split(";")[0]?.trim().toLowerCase() === "application/json";
}

export function normalizeRawWebhookBody(body: unknown): string {
  return typeof body === "string"
    ? body
    : JSON.stringify(body === undefined ? {} : body);
}

export function parseWebhookPayload(body: unknown): {
  rawBody: string;
  payload: Record<string, unknown>;
} {
  if (
    body !== undefined &&
    typeof body !== "string" &&
    (typeof body !== "object" || body === null || Array.isArray(body))
  ) {
    throw new Error("Invalid GitHub webhook payload.");
  }

  let rawBody: string;
  try {
    rawBody = normalizeRawWebhookBody(body);
  } catch {
    throw new Error("Invalid GitHub webhook payload.");
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = rawBody.trim().length === 0 ? {} : JSON.parse(rawBody);
  } catch {
    throw new Error("Invalid GitHub webhook payload.");
  }

  let payload: Record<string, unknown>;
  try {
    payload = webhookPayloadSchema.parse(parsedPayload);
  } catch {
    throw new Error("Invalid GitHub webhook payload.");
  }

  return {
    rawBody,
    payload,
  };
}

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

function sendClientWebhookError(
  reply: FastifyReply,
  statusCode: number,
  message: string,
) {
  return reply.status(statusCode).send({
    accepted: false,
    message,
  });
}

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
  webhookRateLimiter?: WebhookRateLimiter;
}

export function createApiServer(input: ApiServerDependencies): FastifyInstance {
  const githubWebhookService = input.githubWebhookService;
  const readinessService = input.readinessService;
  const setupStatusService = input.setupStatusService;
  const webhookRateLimiter =
    input.webhookRateLimiter ?? new InMemoryWebhookRateLimiter();
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
      : buildDefaultSetupStatus();

    return reply
      .type("text/html; charset=utf-8")
      .status(200)
      .send(renderSetupPage(setupStatus));
  });

  server.get("/setup/status", async () => {
    if (!setupStatusService) {
      return buildDefaultSetupStatus();
    }

    return setupStatusService.getSetupStatus();
  });

  server.post("/webhooks/github", async (request, reply) => {
    const webhookHandler = githubWebhookService;
    if (!webhookHandler) {
      return reply.status(503).send({
        accepted: false,
        message: "Nitpickr setup is incomplete.",
      });
    }

    if (!hasJsonContentType(request.headers["content-type"])) {
      // Reject malformed client input without logging headers or payloads.
      return sendClientWebhookError(
        reply,
        415,
        invalidWebhookContentTypeMessage,
      );
    }

    const rateLimit = await webhookRateLimiter.consume(request.ip);
    if (!rateLimit.allowed) {
      if (rateLimit.retryAfterSeconds !== undefined) {
        void reply.header("retry-after", String(rateLimit.retryAfterSeconds));
      }

      return reply.status(429).send({
        accepted: false,
        message: "GitHub webhook rate limit exceeded.",
      });
    }

    let rawBody: string;
    let payload: Record<string, unknown>;
    try {
      const parsedPayload = parseWebhookPayload(request.body);
      rawBody = parsedPayload.rawBody;
      payload = parsedPayload.payload;
    } catch {
      // Reject malformed client input without logging headers or payloads.
      return sendClientWebhookError(reply, 400, invalidWebhookPayloadMessage);
    }
    const headerResult = githubWebhookHeadersSchema.safeParse({
      deliveryId: request.headers["x-github-delivery"],
      eventName: request.headers["x-github-event"],
      signature: request.headers["x-hub-signature-256"],
    });

    if (!headerResult.success) {
      // Reject malformed client input without logging headers or payloads.
      return sendClientWebhookError(reply, 400, invalidWebhookHeadersMessage);
    }

    const signatureValid = await webhookHandler.verifySignature(
      rawBody,
      headerResult.data.signature,
    );

    if (signatureValid === "setup_required") {
      return reply.status(503).send({
        accepted: false,
        message: "Nitpickr setup is incomplete.",
      });
    }

    if (!signatureValid) {
      return reply.status(401).send({
        accepted: false,
        message: "Invalid GitHub webhook signature.",
      });
    }

    const result = await webhookHandler.handle({
      deliveryId: headerResult.data.deliveryId,
      eventName: headerResult.data.eventName,
      signature: headerResult.data.signature,
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
