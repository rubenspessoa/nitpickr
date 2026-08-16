import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTimeoutFetch,
  isTimeoutError,
} from "../../src/shared/http-client.js";

// Server that waits `delay` ms before sending headers — mimics a non-streaming
// model server that answers only once generation is complete.
const server = createServer((request, response) => {
  const delay = Number(
    new URL(request.url ?? "/", "http://x").searchParams.get("delay") ?? "0",
  );
  setTimeout(() => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, delay }));
  }, delay);
});
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("createTimeoutFetch", () => {
  it("waits for slow headers within the timeout", async () => {
    const fetchFn = createTimeoutFetch(2_000);
    const response = await fetchFn(`${baseUrl}/?delay=150`);
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ ok: true, delay: 150 });
  });

  it("fails with a timeout error once the ceiling is exceeded", async () => {
    const fetchFn = createTimeoutFetch(100);
    let caught: unknown;
    try {
      await fetchFn(`${baseUrl}/?delay=1500`);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(isTimeoutError(caught)).toBe(true);
  });

  it("rejects non-positive timeouts", () => {
    expect(() => createTimeoutFetch(0)).toThrow(/positive/);
  });
});

describe("isTimeoutError", () => {
  it("recognises undici timeout causes and abort/timeout names", () => {
    const undiciStyle = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Headers Timeout Error"), {
        code: "UND_ERR_HEADERS_TIMEOUT",
      }),
    });
    expect(isTimeoutError(undiciStyle)).toBe(true);
    expect(isTimeoutError(new DOMException("t", "TimeoutError"))).toBe(true);
    expect(isTimeoutError(new Error("nope"))).toBe(false);
    expect(isTimeoutError("string")).toBe(false);
  });
});
