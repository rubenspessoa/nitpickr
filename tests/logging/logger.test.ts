import { describe, expect, it } from "vitest";

import { createLogger } from "../../src/logging/logger.js";

describe("createLogger", () => {
  it("emits structured logs at or above the configured level", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const logger = createLogger({
      level: "info",
      context: {
        service: "nitpickr",
      },
      now: () => new Date("2026-03-10T11:00:00.000Z"),
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    });

    logger.debug("suppressed");
    logger.info("started", {
      component: "api",
    });
    logger.error("failed", {
      component: "worker",
    });

    expect(stdout).toEqual([
      `${JSON.stringify({
        timestamp: "2026-03-10T11:00:00.000Z",
        level: "info",
        message: "started",
        service: "nitpickr",
        component: "api",
      })}\n`,
    ]);
    expect(stderr).toEqual([
      `${JSON.stringify({
        timestamp: "2026-03-10T11:00:00.000Z",
        level: "error",
        message: "failed",
        service: "nitpickr",
        component: "worker",
      })}\n`,
    ]);
  });

  it("inherits child context fields", () => {
    const stdout: string[] = [];
    const logger = createLogger({
      level: "debug",
      context: {
        service: "nitpickr",
      },
      now: () => new Date("2026-03-10T11:00:00.000Z"),
      stdout: (message) => stdout.push(message),
      stderr: () => {},
    });

    const child = logger.child({
      component: "worker",
    });
    child.info("claimed job", {
      jobId: "job_1",
    });

    expect(stdout).toEqual([
      `${JSON.stringify({
        timestamp: "2026-03-10T11:00:00.000Z",
        level: "info",
        message: "claimed job",
        service: "nitpickr",
        component: "worker",
        jobId: "job_1",
      })}\n`,
    ]);
  });
});
