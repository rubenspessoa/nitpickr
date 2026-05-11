import { describe, expect, it } from "vitest";

import {
  __resetSentryForTests,
  captureError,
  initSentry,
  isSentryInitialized,
} from "../../src/observability/sentry.js";

describe("sentry observability helpers", () => {
  it("is a no-op when SENTRY_DSN is unset", () => {
    __resetSentryForTests();
    const logged: Array<{ message: string; fields: unknown }> = [];
    initSentry({
      dsn: null,
      environment: "test",
      tracesSampleRate: 0,
      logger: {
        debug() {},
        info() {},
        warn(message, fields) {
          logged.push({ message, fields });
        },
        error() {},
        child() {
          return this;
        },
      },
    });

    expect(isSentryInitialized()).toBe(false);
    expect(logged[0]?.message).toContain("Sentry disabled");
    // captureError must not throw when uninitialized.
    expect(() => captureError(new Error("boom"))).not.toThrow();
  });
});
