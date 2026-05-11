import { describe, expect, it } from "vitest";

import {
  captureError,
  isSentryInitialized,
  setRequestScope,
  withSentrySpan,
} from "../../src/observability/sentry.js";

describe("sentry observability helpers", () => {
  // The Sentry SDK is initialized in src/observability/instrument.ts, which is
  // not preloaded in tests. So Sentry.getClient() returns undefined here and
  // every helper short-circuits to a no-op. That is the contract we test.

  it("isSentryInitialized returns false when the SDK was never preloaded", () => {
    expect(isSentryInitialized()).toBe(false);
  });

  it("captureError is a no-op and does not throw when Sentry is uninitialized", () => {
    expect(() =>
      captureError(new Error("boom"), {
        tags: { component: "test" },
        extra: { foo: "bar" },
      }),
    ).not.toThrow();
  });

  it("withSentrySpan still runs the wrapped function when Sentry is uninitialized", async () => {
    const result = await withSentrySpan("noop", "noop.op", async () => 42);
    expect(result).toBe(42);
  });

  it("setRequestScope is a no-op when Sentry is uninitialized", () => {
    expect(() =>
      setRequestScope({ correlationId: "abc", route: "/x", method: "GET" }),
    ).not.toThrow();
  });
});
