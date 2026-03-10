import { describe, expect, it } from "vitest";

import { createApiServer } from "../../src/api/server.js";

class FakeLogger {
  readonly entries: Array<{
    level: string;
    message: string;
    fields: Record<string, unknown>;
  }> = [];

  debug(message: string, fields: Record<string, unknown> = {}) {
    this.entries.push({ level: "debug", message, fields });
  }

  info(message: string, fields: Record<string, unknown> = {}) {
    this.entries.push({ level: "info", message, fields });
  }

  warn(message: string, fields: Record<string, unknown> = {}) {
    this.entries.push({ level: "warn", message, fields });
  }

  error(message: string, fields: Record<string, unknown> = {}) {
    this.entries.push({ level: "error", message, fields });
  }

  child(fields: Record<string, unknown>) {
    return {
      debug: (message: string, entryFields: Record<string, unknown> = {}) =>
        this.debug(message, { ...fields, ...entryFields }),
      info: (message: string, entryFields: Record<string, unknown> = {}) =>
        this.info(message, { ...fields, ...entryFields }),
      warn: (message: string, entryFields: Record<string, unknown> = {}) =>
        this.warn(message, { ...fields, ...entryFields }),
      error: (message: string, entryFields: Record<string, unknown> = {}) =>
        this.error(message, { ...fields, ...entryFields }),
      child: (childFields: Record<string, unknown>) =>
        this.child({ ...fields, ...childFields }),
    };
  }
}

describe("createApiServer", () => {
  it("accepts GitHub webhooks through Fastify", async () => {
    const server = createApiServer({
      githubWebhookService: {
        async handle() {
          return {
            statusCode: 202,
            accepted: true,
            message: "queued",
          };
        },
      },
    });

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": "sha256=test",
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        action: "opened",
      }),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      accepted: true,
      message: "queued",
    });
  });

  it("returns readiness and setup status", async () => {
    const server = createApiServer({
      githubWebhookService: {
        async handle() {
          return {
            statusCode: 202,
            accepted: true,
            message: "queued",
          };
        },
      },
      readinessService: {
        async getStatus() {
          return {
            ok: false,
            state: "setup_required" as const,
            checks: {
              database: true,
              setup: false,
              worker: false,
            },
            reasons: ["Nitpickr setup is incomplete."],
          };
        },
      },
      setupStatusService: {
        async getSetupStatus() {
          return {
            state: "setup_required" as const,
            openAiConfigured: false,
            githubAppConfigured: false,
            ready: false,
          };
        },
      },
    });

    const readiness = await server.inject({
      method: "GET",
      url: "/readyz",
    });
    const setupStatus = await server.inject({
      method: "GET",
      url: "/setup/status",
    });

    expect(readiness.statusCode).toBe(503);
    expect(readiness.json()).toEqual({
      ok: false,
      state: "setup_required",
      checks: {
        database: true,
        setup: false,
        worker: false,
      },
      reasons: ["Nitpickr setup is incomplete."],
    });
    expect(setupStatus.statusCode).toBe(200);
    expect(setupStatus.json()).toEqual({
      state: "setup_required",
      openAiConfigured: false,
      githubAppConfigured: false,
      ready: false,
    });
  });

  it("returns setup_required when GitHub webhooks arrive before onboarding completes", async () => {
    const server = createApiServer({
      setupStatusService: {
        async getSetupStatus() {
          return {
            state: "setup_required" as const,
            openAiConfigured: false,
            githubAppConfigured: false,
            ready: false,
          };
        },
      },
    });

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": "sha256=test",
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        action: "opened",
      }),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      accepted: false,
      message: "Nitpickr setup is incomplete.",
    });
  });

  it("logs unhandled webhook errors and returns a 500 response", async () => {
    const logger = new FakeLogger();
    const server = createApiServer({
      logger,
      githubWebhookService: {
        async handle() {
          throw new Error("boom");
        },
      },
    });

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": "sha256=test",
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        action: "opened",
      }),
    });

    expect(response.statusCode).toBe(500);
    expect(logger.entries).toContainEqual({
      level: "error",
      message: "API request failed.",
      fields: {
        component: "api-server",
        method: "POST",
        url: "/webhooks/github",
        error: "boom",
      },
    });
  });

  it("rejects malformed GitHub webhook payloads before processing", async () => {
    const server = createApiServer({
      githubWebhookService: {
        async handle() {
          return {
            statusCode: 202,
            accepted: true,
            message: "queued",
          };
        },
      },
    });

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": "sha256=test",
        "content-type": "application/json",
      },
      payload: "{not-json",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      accepted: false,
      message: "Invalid GitHub webhook payload.",
    });
  });
});
