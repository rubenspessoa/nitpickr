import { describe, expect, it } from "vitest";

import {
  generateCorrelationId,
  withTiming,
} from "../../src/logging/correlation.js";
import type { Logger } from "../../src/logging/logger.js";

class RecordingLogger implements Logger {
  readonly entries: Array<{
    level: "debug" | "info" | "warn" | "error";
    message: string;
    fields: Record<string, unknown>;
  }> = [];

  debug(message: string, fields: Record<string, unknown> = {}): void {
    this.entries.push({ level: "debug", message, fields });
  }

  info(message: string, fields: Record<string, unknown> = {}): void {
    this.entries.push({ level: "info", message, fields });
  }

  warn(message: string, fields: Record<string, unknown> = {}): void {
    this.entries.push({ level: "warn", message, fields });
  }

  error(message: string, fields: Record<string, unknown> = {}): void {
    this.entries.push({ level: "error", message, fields });
  }

  child(): Logger {
    return this;
  }
}

describe("withTiming", () => {
  it("emits debug-start and info-success around a resolving action", async () => {
    const logger = new RecordingLogger();
    const result = await withTiming(logger, "test_action", async () => "ok", {
      pullNumber: 42,
    });

    expect(result).toBe("ok");
    expect(logger.entries).toHaveLength(2);
    expect(logger.entries[0]).toEqual({
      level: "debug",
      message: "test_action started",
      fields: { action: "test_action", pullNumber: 42 },
    });
    const success = logger.entries[1];
    expect(success?.level).toBe("info");
    expect(success?.message).toBe("test_action succeeded");
    expect(success?.fields.action).toBe("test_action");
    expect(success?.fields.pullNumber).toBe(42);
    expect(typeof success?.fields.durationMs).toBe("number");
    expect(success?.fields.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("emits error-failed and re-throws when the action rejects", async () => {
    const logger = new RecordingLogger();
    const boom = new Error("kaboom");
    await expect(
      withTiming(logger, "test_action", async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(logger.entries).toHaveLength(2);
    expect(logger.entries[0]?.level).toBe("debug");
    const failure = logger.entries[1];
    expect(failure?.level).toBe("error");
    expect(failure?.message).toBe("test_action failed");
    expect(failure?.fields.action).toBe("test_action");
    expect(failure?.fields.errorMessage).toBe("kaboom");
    expect(typeof failure?.fields.durationMs).toBe("number");
  });

  it("stringifies non-Error rejections in the errorMessage field", async () => {
    const logger = new RecordingLogger();
    const rejection: unknown = "string error";
    await expect(
      withTiming(logger, "rejecting", () => Promise.reject(rejection)),
    ).rejects.toBe("string error");

    expect(logger.entries[1]?.fields.errorMessage).toBe("string error");
  });
});

describe("generateCorrelationId", () => {
  it("returns a stable v4-style UUID string", () => {
    const id = generateCorrelationId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(id).not.toBe(generateCorrelationId());
  });
});
