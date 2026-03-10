import { describe, expect, it } from "vitest";

import { createSetupAwareGitHubWebhookHandler } from "../../src/api/setup-aware-webhook-handler.js";

describe("createSetupAwareGitHubWebhookHandler", () => {
  it("returns setup_required until an operational runtime exists, then reuses the created service", async () => {
    let getOperationalRuntimeCalls = 0;
    let handleCalls = 0;

    const handler = createSetupAwareGitHubWebhookHandler({
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() {},
        child() {
          return this;
        },
      },
      runtime: {
        queueScheduler: {},
        webhookEventService: {},
        async getOperationalRuntime() {
          getOperationalRuntimeCalls += 1;
          if (getOperationalRuntimeCalls === 1) {
            return null;
          }

          return {
            githubAdapter: {} as never,
          };
        },
      } as never,
      createWebhookService: () => ({
        async handle() {
          handleCalls += 1;
          return {
            statusCode: 202,
            accepted: true,
            message: "queued",
          };
        },
      }),
    });

    await expect(
      handler.handle({
        eventName: "pull_request",
        signature: "sha256=test",
        rawBody: "{}",
        payload: {},
      }),
    ).resolves.toEqual({
      statusCode: 503,
      accepted: false,
      message: "Nitpickr setup is incomplete.",
    });

    await expect(
      handler.handle({
        eventName: "pull_request",
        signature: "sha256=test",
        rawBody: "{}",
        payload: {},
      }),
    ).resolves.toEqual({
      statusCode: 202,
      accepted: true,
      message: "queued",
    });

    await handler.handle({
      eventName: "pull_request",
      signature: "sha256=test",
      rawBody: "{}",
      payload: {},
    });

    expect(getOperationalRuntimeCalls).toBe(2);
    expect(handleCalls).toBe(2);
  });
});
