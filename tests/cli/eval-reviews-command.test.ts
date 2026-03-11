import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EvalReviewsCommand } from "../../src/cli/eval-reviews-command.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("EvalReviewsCommand", () => {
  it("loads fixtures from disk and prints aggregate metrics", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nitpickr-eval-"));
    directories.push(directory);
    await writeFile(
      join(directory, "queue-fairness.json"),
      JSON.stringify(
        {
          name: "queue-fairness",
          input: {
            changeRequest: {
              title: "Improve queue fairness",
              number: 42,
            },
            files: [
              {
                path: "src/queue/queue-scheduler.ts",
                additions: 3,
                deletions: 1,
                patch: "@@ -10,2 +10,3 @@\n context\n-old\n+new alpha",
              },
            ],
            instructionText: "strictness: balanced",
            memory: [],
            commentBudget: 5,
          },
          chunkResponses: [
            {
              summary: "Queue ordering changed.",
              mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
              findings: [
                {
                  path: "src/queue/queue-scheduler.ts",
                  line: 12,
                  findingType: "bug",
                  severity: "high",
                  category: "correctness",
                  title: "Stable ordering breaks",
                  body: "Stable ordering breaks when equal priorities are inserted.",
                  fixPrompt:
                    "In `src/queue/queue-scheduler.ts` around line 12, preserve insertion order for equal priorities.",
                },
              ],
            },
          ],
          expectations: {
            publishedFingerprints: [
              "src/queue/queue-scheduler.ts:12:correctness:stable_ordering_breaks",
            ],
            suppressedFingerprints: [],
          },
          reactionFeedback: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const output: string[] = [];
    const command = new EvalReviewsCommand();

    await command.run({
      fixtureDirectory: directory,
      write: (line) => output.push(line),
    });

    expect(output.join("\n")).toContain("Fixtures: 1");
    expect(output.join("\n")).toContain("Precision: 1.00");
    expect(output.join("\n")).toContain("Comment count / review: 1.00");
  });

  it("fails fast when the fixture directory does not exist", async () => {
    const command = new EvalReviewsCommand();

    await expect(
      command.run({
        fixtureDirectory: join(tmpdir(), "nitpickr-missing-review-fixtures"),
        write: () => undefined,
      }),
    ).rejects.toThrow("Fixture directory does not exist");
  });
});
