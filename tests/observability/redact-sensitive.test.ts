import { describe, expect, it } from "vitest";

import { redactSensitive } from "../../src/observability/redact-sensitive.js";

describe("redactSensitive", () => {
  it("redacts top-level sensitive keys", () => {
    const out = redactSensitive({
      apiKey: "sk-secret",
      privateKey: "pem",
      webhookSecret: "whk",
      authorization: "Bearer abc",
      secret: "shh",
      ok: "value",
    }) as Record<string, unknown>;

    expect(out.apiKey).toBe("[redacted]");
    expect(out.privateKey).toBe("[redacted]");
    expect(out.webhookSecret).toBe("[redacted]");
    expect(out.authorization).toBe("[redacted]");
    expect(out.secret).toBe("[redacted]");
    expect(out.ok).toBe("value");
  });

  it("recurses into nested objects and arrays", () => {
    const out = redactSensitive({
      headers: [{ name: "Authorization", value: "Bearer abc" }],
      nested: { deeper: { api_key: "x", harmless: 1 } },
    }) as Record<string, unknown>;

    const nested = (out.nested as { deeper: Record<string, unknown> }).deeper;
    expect(nested.api_key).toBe("[redacted]");
    expect(nested.harmless).toBe(1);
  });

  it("returns a fresh copy without mutating the input", () => {
    const input = { apiKey: "sk-1", nested: { foo: "bar" } };
    const out = redactSensitive(input);
    expect(input.apiKey).toBe("sk-1");
    expect(out).not.toBe(input);
  });

  it("handles circular references without throwing or recursing forever", () => {
    const cyclic: Record<string, unknown> = { name: "outer" };
    cyclic.self = cyclic;

    const out = redactSensitive(cyclic) as Record<string, unknown>;
    expect(out.name).toBe("outer");
    expect(out.self).toBe("[circular]");
  });

  it("handles circular references inside arrays", () => {
    const arr: unknown[] = [1, 2];
    arr.push(arr);

    const out = redactSensitive(arr) as unknown[];
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(2);
    expect(out[2]).toBe("[circular]");
  });

  it("returns primitives unchanged", () => {
    expect(redactSensitive("plain")).toBe("plain");
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(null)).toBe(null);
    expect(redactSensitive(undefined)).toBe(undefined);
  });
});
