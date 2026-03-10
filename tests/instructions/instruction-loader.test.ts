import { describe, expect, it } from "vitest";

import {
  InstructionLoader,
  type InstructionSource,
} from "../../src/instructions/instruction-loader.js";

class FakeInstructionSource implements InstructionSource {
  readonly files = new Map<string, string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [path, contents] of Object.entries(seed)) {
      this.files.set(path, contents);
    }
  }

  async readFile(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async listFiles(prefix: string): Promise<string[]> {
    return [...this.files.keys()]
      .filter((path) => path.startsWith(prefix))
      .sort();
  }
}

describe("InstructionLoader", () => {
  it("loads repository config, AGENTS, and .nitpickr docs into one bundle", async () => {
    const loader = new InstructionLoader();
    const bundle = await loader.load(
      new FakeInstructionSource({
        ".nitpickr.yml": [
          "review:",
          "  maxComments: 8",
          "  focusAreas:",
          "    - queue fairness",
        ].join("\n"),
        "AGENTS.md": "# Team guide\nPrefer small services.",
        ".nitpickr/review.md":
          "# Review focus\nLook for concurrency regressions.",
        ".nitpickr/api.md": "# API notes\nValidate webhook signatures.",
      }),
    );

    expect(bundle.config.review.maxComments).toBe(8);
    expect(bundle.documents.map((document) => document.path)).toEqual([
      ".nitpickr/api.md",
      ".nitpickr/review.md",
      "AGENTS.md",
    ]);
    expect(bundle.combinedText).toContain("queue fairness");
    expect(bundle.combinedText).toContain("Validate webhook signatures.");
  });

  it("falls back to defaults when no instruction files exist", async () => {
    const loader = new InstructionLoader();
    const bundle = await loader.load(new FakeInstructionSource());

    expect(bundle.config.review.maxComments).toBe(20);
    expect(bundle.documents).toEqual([]);
    expect(bundle.combinedText).toContain("strictness: balanced");
  });

  it("rejects invalid repo config content", async () => {
    const loader = new InstructionLoader();

    await expect(() =>
      loader.load(
        new FakeInstructionSource({
          ".nitpickr.yml": ["review:", "  maxComments: 0"].join("\n"),
        }),
      ),
    ).rejects.toThrow(/maxComments/i);
  });
});
