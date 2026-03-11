import { describe, expect, it } from "vitest";

import {
  ReviewEngine,
  type ReviewModel,
} from "../../src/review/review-engine.js";

class FakeReviewModel implements ReviewModel {
  readonly prompts: string[] = [];
  readonly chunkResponses: unknown[];

  constructor(chunkResponses: unknown[]) {
    this.chunkResponses = [...chunkResponses];
  }

  async generateStructuredReview(input: { system: string; user: string }) {
    this.prompts.push(`${input.system}\n---\n${input.user}`);
    return (
      this.chunkResponses.shift() ?? {
        summary: "No findings.",
        mermaid: "flowchart TD\nA[Change] --> B[Reviewed]",
        findings: [],
      }
    );
  }
}

describe("ReviewEngine", () => {
  it("chunks large file sets and merges structured findings", async () => {
    const model = new FakeReviewModel([
      {
        summary: "Chunk one summary",
        diagram: {
          type: "sequence",
          title: "Chunk one",
          participants: [
            { id: "queue", label: "Queue" },
            { id: "sort", label: "Sort step" },
          ],
          steps: [
            {
              from: "queue",
              to: "sort",
              label: "Prepare ordering",
            },
          ],
        },
        findings: [
          {
            path: "src/queue/a.ts",
            line: 12,
            findingType: "bug",
            severity: "high",
            category: "correctness",
            title: "Ordering breaks for equal priority",
            body: "Stable ordering is lost when priorities match.",
            fixPrompt:
              "Refactor the queue insertion logic to preserve stable ordering.",
          },
        ],
      },
      {
        summary: "Chunk two summary",
        diagram: {
          type: "sequence",
          title: "Chunk one",
          participants: [
            { id: "sort", label: "Sort step" },
            { id: "publish", label: "Publish" },
          ],
          steps: [
            {
              from: "sort",
              to: "publish",
              label: "Publish comments",
            },
          ],
        },
        findings: [],
      },
    ]);

    const engine = new ReviewEngine(model, {
      maxPatchCharactersPerChunk: 20,
    });

    const result = await engine.review({
      changeRequest: {
        title: "Improve queue fairness",
        number: 42,
      },
      files: [
        {
          path: "src/queue/a.ts",
          additions: 10,
          deletions: 2,
          patch: "@@ -1,1 +1,20 @@\n+12345678901234567890",
        },
        {
          path: "src/queue/b.ts",
          additions: 8,
          deletions: 1,
          patch: "@@ -1,1 +1,20 @@\n+abcdefghijklmnopqrst",
        },
      ],
      contextFiles: [
        {
          path: "src/queue/a.ts",
          additions: 10,
          deletions: 2,
          patch: "@@ -1,1 +1,20 @@\n+12345678901234567890",
        },
        {
          path: "src/queue/b.ts",
          additions: 8,
          deletions: 1,
          patch: "@@ -1,1 +1,20 @@\n+abcdefghijklmnopqrst",
        },
        {
          path: "src/api/server.ts",
          additions: 3,
          deletions: 1,
          patch: "@@ -1,1 +1,5 @@\n+validate body",
        },
      ],
      instructionText: "strictness: balanced",
      memory: [],
      commentBudget: 10,
    });

    expect(model.prompts).toHaveLength(2);
    expect(result.findings).toHaveLength(1);
    expect(result.summary).toContain("Chunk one summary");
    expect(result.summary).toContain("Chunk two summary");
    expect(result.mermaid).toContain("sequenceDiagram");
    expect(result.mermaid).toContain("queue->>sort: Prepare ordering");
    expect(result.mermaid).toContain("sort->>publish: Publish comments");
    expect(model.prompts[0]).toContain("Current PR context:");
    expect(model.prompts[0]).toContain("src/api/server.ts (+3/-1)");
  });

  it("caps findings to the configured comment budget", async () => {
    const model = new FakeReviewModel([
      {
        summary: "Summary",
        diagram: {
          type: "sequence",
          participants: [
            { id: "code", label: "Code" },
            { id: "review", label: "Review" },
          ],
          steps: [
            {
              from: "code",
              to: "review",
              label: "Review change",
            },
          ],
        },
        findings: [
          {
            path: "src/queue/a.ts",
            line: 12,
            findingType: "bug",
            severity: "critical",
            category: "correctness",
            title: "Critical bug",
            body: "Critical issue.",
            fixPrompt: "Fix critical issue.",
          },
          {
            path: "src/queue/b.ts",
            line: 18,
            findingType: "teaching_note",
            severity: "low",
            category: "maintainability",
            title: "Minor issue",
            body: "Minor issue.",
            fixPrompt: "Fix minor issue.",
          },
        ],
      },
    ]);

    const engine = new ReviewEngine(model);
    const result = await engine.review({
      changeRequest: {
        title: "Improve queue fairness",
        number: 42,
      },
      files: [
        {
          path: "src/queue/a.ts",
          additions: 10,
          deletions: 2,
          patch: "@@ -1,1 +1,20 @@\n+stable ordering",
        },
      ],
      instructionText: "strictness: balanced",
      memory: [],
      commentBudget: 1,
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Critical bug");
  });

  it("suppresses findings outside the changed scope and exposes rejection reasons", async () => {
    const model = new FakeReviewModel([
      {
        summary: "Summary",
        mermaid: "flowchart TD\nA[Change] --> B[Reviewed]",
        findings: [
          {
            path: "src/queue/a.ts",
            line: 12,
            findingType: "bug",
            severity: "high",
            category: "correctness",
            title: "Stable ordering breaks",
            body: "Stable ordering breaks when equal priorities are inserted.",
            fixPrompt:
              "In `src/queue/a.ts` around line 12, preserve insertion order.",
          },
          {
            path: "src/queue/a.ts",
            line: 40,
            findingType: "bug",
            severity: "medium",
            category: "correctness",
            title: "Outside changed context",
            body: "This finding points to a line outside the changed hunk.",
            fixPrompt:
              "In `src/queue/a.ts` around line 40, update the changed branch.",
          },
          {
            path: "src/missing.ts",
            line: 10,
            findingType: "bug",
            severity: "medium",
            category: "correctness",
            title: "Wrong file",
            body: "This finding points to an unknown file.",
            fixPrompt: "In `src/missing.ts` around line 10, update the file.",
          },
        ],
      },
    ]);

    const engine = new ReviewEngine(model);
    const result = await engine.reviewWithDiagnostics({
      changeRequest: {
        title: "Improve queue fairness",
        number: 42,
      },
      files: [
        {
          path: "src/queue/a.ts",
          additions: 3,
          deletions: 1,
          patch: "@@ -10,2 +10,3 @@\n context\n-old\n+new alpha",
        },
      ],
      instructionText: "strictness: balanced",
      memory: [],
      commentBudget: 5,
    });

    expect(result.result.findings).toHaveLength(1);
    expect(result.result.findings[0]?.title).toBe("Stable ordering breaks");
    expect(result.rejectedFindings).toHaveLength(2);
    expect(result.rejectedFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          findingFingerprint:
            "src/queue/a.ts:40:correctness:outside_changed_context",
          reasons: ["line_not_in_changed_context"],
        }),
        expect.objectContaining({
          findingFingerprint: "src/missing.ts:10:correctness:wrong_file",
          reasons: ["path_not_in_scope"],
        }),
      ]),
    );
  });

  it("emits prompt usage diagnostics and compacts balanced commit-delta payloads", async () => {
    const model = new FakeReviewModel([
      {
        summary: "Summary",
        findings: [],
      },
    ]);

    const engine = new ReviewEngine(model);
    const result = await engine.reviewWithDiagnostics({
      changeRequest: {
        title: "Optimize prompts",
        number: 99,
      },
      scope: "commit_delta",
      optimizationMode: "balanced",
      files: [
        {
          path: "src/queue/a.ts",
          additions: 2,
          deletions: 1,
          patch: "@@ -1,1 +1,2 @@\n+optimized",
        },
      ],
      contextFiles: [
        {
          path: "src/context/a.ts",
          additions: 30,
          deletions: 5,
          patch: "@@ -1,1 +1,200 @@\n+".padEnd(500, "x"),
        },
      ],
      instructionText: "instruction ".repeat(500),
      memory: new Array(12).fill(0).map((_, index) => ({
        summary: `memory-${index}-${"x".repeat(400)}`,
      })),
      commentBudget: 5,
    });

    expect(
      result.promptUsage.beforeCompaction.contextPatchChars,
    ).toBeGreaterThan(0);
    expect(result.promptUsage.afterCompaction.contextPatchChars).toBe(0);
    expect(result.promptUsage.afterCompaction.instructionChars).toBeLessThan(
      result.promptUsage.beforeCompaction.instructionChars,
    );
    expect(result.promptUsage.afterCompaction.memoryChars).toBeLessThan(
      result.promptUsage.beforeCompaction.memoryChars,
    );
    expect(
      result.promptUsage.afterCompaction.estimatedPromptTokens,
    ).toBeLessThan(result.promptUsage.beforeCompaction.estimatedPromptTokens);
  });

  it("deduplicates repeated findings and keeps ordering stable", async () => {
    const model = new FakeReviewModel([
      {
        summary: "Summary",
        diagram: {
          type: "sequence",
          participants: [
            { id: "code", label: "Code" },
            { id: "review", label: "Review" },
          ],
          steps: [
            {
              from: "code",
              to: "review",
              label: "Review change",
            },
          ],
        },
        findings: [
          {
            path: "src/queue/b.ts",
            line: 30,
            findingType: "bug",
            severity: "medium",
            category: "maintainability",
            title: "Extract duplicate branch",
            body: "The branch is repeated twice.",
            fixPrompt: "Extract the shared branch into a helper.",
          },
          {
            path: "src/queue/a.ts",
            line: 12,
            findingType: "bug",
            severity: "high",
            category: "correctness",
            title: "Ordering breaks for equal priority",
            body: "Stable ordering is lost when priorities match.",
            fixPrompt: "Preserve insertion order for equal priorities.",
          },
        ],
      },
      {
        summary: "Summary two",
        diagram: {
          type: "sequence",
          participants: [
            { id: "code", label: "Code" },
            { id: "review", label: "Review" },
          ],
          steps: [
            {
              from: "code",
              to: "review",
              label: "Review change",
            },
          ],
        },
        findings: [
          {
            path: "src/queue/a.ts",
            line: 12,
            findingType: "bug",
            severity: "critical",
            category: "correctness",
            title: "Ordering breaks for equal priority",
            body: "Stable ordering is lost when priorities match.",
            fixPrompt: "Preserve insertion order for equal priorities.",
          },
          {
            path: "src/queue/a.ts",
            line: 40,
            findingType: "question",
            severity: "medium",
            category: "testing",
            title: "Add a regression test",
            body: "The case is not covered today.",
            fixPrompt: "Add a regression test for equal-priority insertion.",
          },
        ],
      },
    ]);

    const engine = new ReviewEngine(model, {
      maxPatchCharactersPerChunk: 20,
    });
    const result = await engine.review({
      changeRequest: {
        title: "Improve queue fairness",
        number: 42,
      },
      files: [
        {
          path: "src/queue/a.ts",
          additions: 10,
          deletions: 2,
          patch: "@@ -1,1 +1,20 @@\n+12345678901234567890",
        },
        {
          path: "src/queue/b.ts",
          additions: 8,
          deletions: 1,
          patch: "@@ -1,1 +1,20 @@\n+abcdefghijklmnopqrst",
        },
      ],
      instructionText: "strictness: balanced",
      memory: [],
      commentBudget: 10,
    });

    expect(result.findings).toHaveLength(3);
    expect(result.findings[0]).toEqual(
      expect.objectContaining({
        path: "src/queue/a.ts",
        line: 12,
        severity: "critical",
      }),
    );
    expect(
      result.findings.map((finding) => `${finding.path}:${finding.line}`),
    ).toEqual(["src/queue/a.ts:12", "src/queue/a.ts:40", "src/queue/b.ts:30"]);
  });

  it("falls back to a default mermaid graph when the model returns null", async () => {
    const model = new FakeReviewModel([
      {
        summary: "Summary",
        diagram: null,
        findings: [],
      },
    ]);

    const engine = new ReviewEngine(model);
    const result = await engine.review({
      changeRequest: {
        title: "Improve queue fairness",
        number: 42,
      },
      files: [
        {
          path: "src/queue/a.ts",
          additions: 10,
          deletions: 2,
          patch: "@@ -1,1 +1,20 @@\n+stable ordering",
        },
      ],
      instructionText: "strictness: balanced",
      memory: [],
      commentBudget: 2,
    });

    expect(result.mermaid).toBe(
      'sequenceDiagram\ntitle "Review flow"\nparticipant pull_request as "Pull Request"\nparticipant nitpickr as "nitpickr"\npull_request->>nitpickr: Review requested\nnitpickr->>pull_request: Publish review summary',
    );
  });

  it("normalizes common severity and category synonyms from the model", async () => {
    const model = new FakeReviewModel([
      {
        summary: "Summary",
        diagram: {
          type: "sequence",
          participants: [
            { id: "code", label: "Code" },
            { id: "review", label: "Review" },
          ],
          steps: [
            {
              from: "code",
              to: "review",
              label: "Review change",
            },
          ],
        },
        findings: [
          {
            path: "src/queue/a.ts",
            line: 12,
            findingType: "safe_suggestion",
            severity: "minor",
            category: "robustness",
            title: "Guard missing state",
            body: "The queue should handle missing state defensively.",
            fixPrompt: "Add a guard for missing queue state.",
            suggestedChange:
              "```suggestion\nif (!queueState) {\n  return;\n}\n```",
          },
        ],
      },
    ]);

    const engine = new ReviewEngine(model);
    const result = await engine.review({
      changeRequest: {
        title: "Improve queue fairness",
        number: 42,
      },
      files: [
        {
          path: "src/queue/a.ts",
          additions: 10,
          deletions: 2,
          patch: "@@ -1,1 +1,20 @@\n+stable ordering",
        },
      ],
      instructionText: "strictness: balanced",
      memory: [],
      commentBudget: 2,
    });

    expect(result.findings).toEqual([
      expect.objectContaining({
        severity: "low",
        category: "correctness",
        fixPrompt: expect.stringContaining("src/queue/a.ts"),
        suggestedChange: "if (!queueState) {\n  return;\n}",
      }),
    ]);
    expect(result.findings).toEqual([
      expect.objectContaining({
        fixPrompt: expect.stringContaining("line 12"),
      }),
    ]);
  });

  it("drops unrecoverable findings instead of failing the full review", async () => {
    const model = new FakeReviewModel([
      {
        summary: "Summary",
        diagram: {
          type: "sequence",
          participants: [
            { id: "code", label: "Code" },
            { id: "review", label: "Review" },
          ],
          steps: [
            {
              from: "code",
              to: "review",
              label: "Review change",
            },
          ],
        },
        findings: [
          {
            path: "",
            line: 12,
            findingType: "bug",
            severity: "minor",
            category: "robustness",
            title: "Bad finding",
            body: "This should be dropped.",
            fixPrompt: "Drop it.",
          },
          {
            path: "src/queue/a.ts",
            line: 18,
            findingType: "bug",
            severity: "major",
            category: "performance",
            title: "Avoid repeated scans",
            body: "Scanning the queue repeatedly is expensive.",
            fixPrompt: "Cache the computed ordering before reuse.",
          },
        ],
      },
    ]);

    const engine = new ReviewEngine(model);
    const result = await engine.review({
      changeRequest: {
        title: "Improve queue fairness",
        number: 42,
      },
      files: [
        {
          path: "src/queue/a.ts",
          additions: 10,
          deletions: 2,
          patch: "@@ -1,1 +1,20 @@\n+stable ordering",
        },
      ],
      instructionText: "strictness: balanced",
      memory: [],
      commentBudget: 2,
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual(
      expect.objectContaining({
        path: "src/queue/a.ts",
        severity: "high",
        category: "performance",
        fixPrompt: expect.stringContaining("src/queue/a.ts"),
      }),
    );
  });

  it("adds file and line context to fix prompts when the model omits it", async () => {
    const model = new FakeReviewModel([
      {
        summary: "Summary",
        diagram: {
          type: "sequence",
          participants: [
            { id: "code", label: "Code" },
            { id: "review", label: "Review" },
          ],
          steps: [
            {
              from: "code",
              to: "review",
              label: "Review change",
            },
          ],
        },
        findings: [
          {
            path: "src/api/server.ts",
            line: 27,
            findingType: "bug",
            severity: "medium",
            category: "maintainability",
            title: "Clarify parsing path",
            body: "Guard the invalid JSON branch explicitly.",
            fixPrompt: "Add an explicit JSON parse guard.",
          },
        ],
      },
    ]);

    const engine = new ReviewEngine(model);
    const result = await engine.review({
      changeRequest: {
        title: "Improve queue fairness",
        number: 42,
      },
      files: [
        {
          path: "src/api/server.ts",
          additions: 10,
          deletions: 2,
          patch: "@@ -1,1 +1,20 @@\n+stable ordering",
        },
      ],
      instructionText: "strictness: balanced",
      memory: [],
      commentBudget: 2,
    });

    expect(result.findings[0]).toEqual(
      expect.objectContaining({
        fixPrompt: expect.stringContaining("src/api/server.ts"),
      }),
    );
    expect(result.findings[0]).toEqual(
      expect.objectContaining({
        fixPrompt: expect.stringContaining("line 27"),
      }),
    );
  });

  it("drops oversized inline suggestions while keeping the finding", async () => {
    const model = new FakeReviewModel([
      {
        summary: "Summary",
        diagram: {
          type: "sequence",
          participants: [
            { id: "code", label: "Code" },
            { id: "review", label: "Review" },
          ],
          steps: [
            {
              from: "code",
              to: "review",
              label: "Review change",
            },
          ],
        },
        findings: [
          {
            path: "src/api/server.ts",
            line: 27,
            findingType: "safe_suggestion",
            severity: "medium",
            category: "maintainability",
            title: "Extract request validation",
            body: "The validation branch is getting harder to scan.",
            fixPrompt: "Extract the validation into a helper.",
            suggestedChange: new Array(20)
              .fill("const value = input;")
              .join("\n"),
          },
        ],
      },
    ]);

    const engine = new ReviewEngine(model);
    const result = await engine.review({
      changeRequest: {
        title: "Improve API validation",
        number: 51,
      },
      files: [
        {
          path: "src/api/server.ts",
          additions: 6,
          deletions: 1,
          patch: "@@ -20,1 +20,6 @@\n+const value = input;",
        },
      ],
      instructionText: "strictness: balanced",
      memory: [],
      commentBudget: 2,
    });

    expect(result.findings).toEqual([
      expect.objectContaining({
        path: "src/api/server.ts",
        suggestedChange: undefined,
      }),
    ]);
  });

  it("normalizes finding types and strips suggested changes from non-safe findings", async () => {
    const model = new FakeReviewModel([
      {
        summary: "Summary",
        findings: [
          {
            path: "src/queue/a.ts",
            line: 12,
            findingType: "suggestion",
            severity: "medium",
            category: "maintainability",
            title: "Extract a helper",
            body: "This branch repeats logic twice.",
            fixPrompt: "Extract a helper for the repeated branch.",
            suggestedChange: "return buildTenantCountMap(runningJobs);",
          },
          {
            path: "src/queue/a.ts",
            line: 18,
            findingType: "bug",
            severity: "high",
            category: "correctness",
            title: "Ordering breaks",
            body: "Stable ordering is lost for equal priorities.",
            fixPrompt: "Preserve insertion order for equal priorities.",
            suggestedChange: "return left.sequence - right.sequence;",
          },
        ],
      },
    ]);

    const engine = new ReviewEngine(model);
    const result = await engine.review({
      changeRequest: {
        title: "Improve queue fairness",
        number: 42,
      },
      files: [
        {
          path: "src/queue/a.ts",
          additions: 10,
          deletions: 2,
          patch: "@@ -1,1 +1,20 @@\n+stable ordering",
        },
      ],
      instructionText: "strictness: balanced",
      memory: [],
      commentBudget: 10,
    });

    const suggestionFinding = result.findings.find(
      (finding) => finding.findingType === "safe_suggestion",
    );
    const bugFinding = result.findings.find(
      (finding) => finding.title === "Ordering breaks",
    );

    expect(suggestionFinding).toEqual(
      expect.objectContaining({
        findingType: "safe_suggestion",
        suggestedChange: "return buildTenantCountMap(runningJobs);",
      }),
    );
    expect(bugFinding).toEqual(
      expect.objectContaining({
        findingType: "bug",
        suggestedChange: undefined,
      }),
    );
  });

  it("rejects malformed top-level model output", async () => {
    const model = new FakeReviewModel(["not-an-object"]);

    const engine = new ReviewEngine(model);

    await expect(() =>
      engine.review({
        changeRequest: {
          title: "Improve queue fairness",
          number: 42,
        },
        files: [
          {
            path: "src/queue/a.ts",
            additions: 10,
            deletions: 2,
            patch: "@@ -1,1 +1,20 @@\n+stable ordering",
          },
        ],
        instructionText: "strictness: balanced",
        memory: [],
        commentBudget: 2,
      }),
    ).rejects.toThrow(/object/i);
  });

  it("supports legacy raw mermaid output as a fallback", async () => {
    const model = new FakeReviewModel([
      {
        summary: "Summary",
        mermaid: "flowchart LR\nA[Legacy] --> B[Graph]",
        findings: [],
      },
    ]);

    const engine = new ReviewEngine(model);
    const result = await engine.review({
      changeRequest: {
        title: "Improve queue fairness",
        number: 42,
      },
      files: [
        {
          path: "src/queue/a.ts",
          additions: 10,
          deletions: 2,
          patch: "@@ -1,1 +1,20 @@\n+stable ordering",
        },
      ],
      instructionText: "strictness: balanced",
      memory: [],
      commentBudget: 2,
    });

    expect(result.mermaid).toContain("flowchart TD");
    expect(result.mermaid).toContain("A[Legacy] --> B[Graph]");
  });
});
