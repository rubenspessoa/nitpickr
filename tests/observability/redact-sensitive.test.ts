import { describe, expect, it } from "vitest";

import {
  isSensitiveKey,
  redactSensitive,
} from "../../src/observability/redact-sensitive.js";

describe("isSensitiveKey", () => {
  it.each([
    "apiKey",
    "api_key",
    "API_KEY",
    "api-key",
    "APIKey",
    "myApiKey",
    "apiKeyValue",
    "privateKey",
    "PRIVATE_KEY",
    "webhookSecret",
    "authorization",
    "Authorization",
    "secret",
    "secrets",
    "mySecret",
    "password",
    "Password",
    "token",
    "accessToken",
  ])("matches sensitive key %s", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    "secretary",
    "secretarial",
    "secretive",
    "tokenize",
    "tokenizer",
    "passwordless", // arguable; tokenization treats this as one token
    "ok",
    "username",
    "user",
    "name",
    "id",
    "url",
  ])("does not falsely match %s", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

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

  it("does not redact lookalike words such as 'secretary'", () => {
    const out = redactSensitive({
      secretary: "Pat",
      tokenizer: "wordpiece",
      username: "ruben",
    }) as Record<string, unknown>;

    expect(out.secretary).toBe("Pat");
    expect(out.tokenizer).toBe("wordpiece");
    expect(out.username).toBe("ruben");
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

  it("replaces values beyond max depth with [truncated] so secrets cannot leak", () => {
    // Build an object 10 levels deep with a sensitive key at the bottom.
    let leaf: Record<string, unknown> = { apiKey: "sk-deep" };
    for (let i = 0; i < 10; i += 1) {
      leaf = { nested: leaf };
    }
    const out = redactSensitive(leaf);
    const serialized = JSON.stringify(out);
    expect(serialized).toContain("[truncated]");
    expect(serialized).not.toContain("sk-deep");
  });

  it("passes Map values through unchanged so downstream serializers can handle them", () => {
    const map = new Map([["k", "v"]]);
    const out = redactSensitive({ data: map }) as { data: unknown };
    expect(out.data).toBe(map);
  });

  it("passes Date values through unchanged", () => {
    const date = new Date("2026-01-01T00:00:00Z");
    const out = redactSensitive({ when: date }) as { when: unknown };
    expect(out.when).toBe(date);
  });

  it("passes class instances through unchanged", () => {
    class Custom {
      constructor(public name: string) {}
    }
    const instance = new Custom("x");
    const out = redactSensitive({ obj: instance }) as { obj: unknown };
    expect(out.obj).toBe(instance);
  });

  it("treats null-prototype objects as plain and redacts their sensitive keys", () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.apiKey = "sk-bare";
    bare.harmless = "ok";

    const out = redactSensitive(bare) as Record<string, unknown>;
    expect(out.apiKey).toBe("[redacted]");
    expect(out.harmless).toBe("ok");
  });

  it("recurses into null-prototype objects nested inside plain objects", () => {
    const inner = Object.create(null) as Record<string, unknown>;
    inner.password = "p4ss";

    const out = redactSensitive({ wrapped: inner }) as {
      wrapped: Record<string, unknown>;
    };
    expect(out.wrapped.password).toBe("[redacted]");
  });

  it("recurses into null-prototype objects nested inside arrays", () => {
    const a = Object.create(null) as Record<string, unknown>;
    a.apiKey = "sk-a";
    a.harmless = "ok-a";
    const b = Object.create(null) as Record<string, unknown>;
    b.authorization = "Bearer xyz";
    b.harmless = "ok-b";
    const input = [a, b];

    const out = redactSensitive(input);
    expect(Array.isArray(out)).toBe(true);
    const arr = out as Array<Record<string, unknown>>;
    expect(arr).toHaveLength(2);

    const first = arr[0];
    const second = arr[1];
    if (!first || !second) {
      throw new Error("expected two elements in redacted output");
    }
    expect(first.apiKey).toBe("[redacted]");
    expect(first.harmless).toBe("ok-a");
    expect(second.authorization).toBe("[redacted]");
    expect(second.harmless).toBe("ok-b");

    // Input array and source objects must not be mutated.
    expect(input).toHaveLength(2);
    expect(input[0]).toBe(a);
    expect(input[1]).toBe(b);
    expect(a.apiKey).toBe("sk-a");
    expect(a.harmless).toBe("ok-a");
    expect(b.authorization).toBe("Bearer xyz");
    expect(b.harmless).toBe("ok-b");
  });

  it("returns primitives unchanged", () => {
    expect(redactSensitive("plain")).toBe("plain");
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(null)).toBe(null);
    expect(redactSensitive(undefined)).toBe(undefined);
  });
});
