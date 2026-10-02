import { describe, expect, it } from "vitest";

import { extractJsonObject } from "../../src/shared/model-output.js";

describe("extractJsonObject", () => {
  it("parses plain JSON objects", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("strips think blocks and code fences", () => {
    expect(
      extractJsonObject('<think>hmm</think>\n```json\n{"a":[1,2]}\n```'),
    ).toEqual({ ok: true, value: { a: [1, 2] } });
    expect(extractJsonObject('```\n{"a":true}\n```')).toEqual({
      ok: true,
      value: { a: true },
    });
  });

  it("recovers the outermost object from surrounding prose", () => {
    expect(
      extractJsonObject(
        'Here you go: {"summary":"x","findings":[]} Hope it helps!',
      ),
    ).toEqual({ ok: true, value: { summary: "x", findings: [] } });
  });

  it("keeps braces inside string values intact", () => {
    expect(extractJsonObject('{"s":"a } b { c"}')).toEqual({
      ok: true,
      value: { s: "a } b { c" },
    });
  });

  it("rejects non-object JSON, prose, and empty content", () => {
    expect(extractJsonObject("[1,2]").ok).toBe(false);
    expect(extractJsonObject("no json here").ok).toBe(false);
    expect(extractJsonObject("   ").ok).toBe(false);
  });
});
