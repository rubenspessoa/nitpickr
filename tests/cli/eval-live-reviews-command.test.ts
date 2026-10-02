import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EvalLiveReviewsCommand } from "../../src/cli/eval-live-reviews-command.js";

const baseInput = {
  apiKey: null,
  baseUrl: "http://localhost:11434/v1",
  model: "qwen3.6:35b-a3b-coding-nvfp4",
  write: () => {},
};

describe("EvalLiveReviewsCommand", () => {
  let outDirectory: string | null = null;

  afterEach(async () => {
    if (outDirectory) {
      await rm(outDirectory, { recursive: true, force: true });
      outDirectory = null;
    }
  });

  it("runs filtered fixtures through the injected model and writes a report", async () => {
    outDirectory = await mkdtemp(join(tmpdir(), "nitpickr-live-eval-"));
    const outFile = join(outDirectory, "report.json");
    const prompts: string[] = [];
    const lines: string[] = [];

    const report = await new EvalLiveReviewsCommand().run({
      ...baseInput,
      filter: "planted-off-by-one",
      outFile,
      startedAt: "2026-10-02T00:00:00.000Z",
      write: (line) => lines.push(line),
      modelFactory: () => ({
        async generateStructuredReview(input) {
          prompts.push(input.user);
          return { summary: "No issues.", findings: [] };
        },
      }),
    });

    expect(prompts.length).toBeGreaterThan(0);
    expect(report.cases.map((entry) => entry.name)).toEqual([
      "planted-off-by-one",
    ]);
    expect(report.totals.failedCases).toBe(0);
    expect(report.totals.matched).toBe(0);
    expect(lines[0]).toContain("model=qwen3.6:35b-a3b-coding-nvfp4");

    const written = JSON.parse(await readFile(outFile, "utf8"));
    expect(written).toMatchObject({
      model: "qwen3.6:35b-a3b-coding-nvfp4",
      baseUrl: "http://localhost:11434/v1",
      reasoningEffort: null,
      startedAt: "2026-10-02T00:00:00.000Z",
    });
  });

  it("rejects a missing fixture directory", async () => {
    await expect(
      new EvalLiveReviewsCommand().run({
        ...baseInput,
        fixtureDirectory: join(tmpdir(), "nitpickr-no-such-fixtures"),
      }),
    ).rejects.toThrow(/Fixture directory does not exist/);
  });

  it("rejects a filter that matches no fixtures", async () => {
    await expect(
      new EvalLiveReviewsCommand().run({
        ...baseInput,
        filter: "no-fixture-has-this-name",
      }),
    ).rejects.toThrow(/No live eval fixtures found/);
  });
});
