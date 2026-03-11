import { describe, expect, it } from "vitest";

import { InMemoryWebhookRateLimiter } from "../../src/api/webhook-rate-limiter.js";

describe("InMemoryWebhookRateLimiter", () => {
  it("allows requests within the configured window and rejects overflow", async () => {
    let now = 1_000;
    const limiter = new InMemoryWebhookRateLimiter({
      maxRequests: 2,
      windowMs: 10_000,
      now: () => now,
    });

    expect(await limiter.consume("127.0.0.1")).toEqual({
      allowed: true,
    });
    expect(await limiter.consume("127.0.0.1")).toEqual({
      allowed: true,
    });
    expect(await limiter.consume("127.0.0.1")).toEqual({
      allowed: false,
      retryAfterSeconds: 10,
    });

    now = 11_500;

    expect(await limiter.consume("127.0.0.1")).toEqual({
      allowed: true,
    });
  });

  it("always returns a promise from consume", () => {
    const limiter = new InMemoryWebhookRateLimiter();

    expect(limiter.consume("127.0.0.1")).toBeInstanceOf(Promise);
  });
});
