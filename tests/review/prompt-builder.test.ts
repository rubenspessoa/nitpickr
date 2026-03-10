import { describe, expect, it } from "vitest";

import { PromptBuilder } from "../../src/review/prompt-builder.js";

describe("PromptBuilder", () => {
  it("builds a review prompt with instructions, memory, and file diffs", () => {
    const builder = new PromptBuilder();
    const prompt = builder.build({
      changeRequest: {
        title: "Improve queue fairness",
        number: 42,
      },
      chunk: {
        index: 0,
        total: 1,
        files: [
          {
            path: "src/queue/queue-scheduler.ts",
            patch: "@@ -1,4 +1,8 @@\n+preserve order",
            additions: 8,
            deletions: 2,
          },
        ],
      },
      instructionText:
        "strictness: balanced\nfocusAreas: queue fairness, prompt validation",
      memory: [
        {
          summary:
            "Maintainers rejected comments that suggest unstable ordering fixes.",
          path: "src/queue",
        },
      ],
      commentBudget: 5,
    });

    expect(prompt.system).toContain("JSON");
    expect(prompt.system).toContain("summary, diagram, findings");
    expect(prompt.system).toContain('Prefer `diagram.type = "sequence"`');
    expect(prompt.system).toContain("Do not return raw Mermaid text");
    expect(prompt.system).toContain("Keep the summary concise");
    expect(prompt.system).toContain(
      "Keep each finding body concise, clear, and actionable",
    );
    expect(prompt.system).toContain(
      "Write polished GitHub-ready copy in plain Markdown",
    );
    expect(prompt.system).toContain("Lead with the issue");
    expect(prompt.system).toContain("suggestedChange");
    expect(prompt.system).toContain(
      "Only return suggestedChange when the fix is small, local, and safe to apply inline on GitHub.",
    );
    expect(prompt.system).toContain(
      "Every fixPrompt must mention the exact file path and target line",
    );
    expect(prompt.system).toContain("'low' | 'medium' | 'high' | 'critical'");
    expect(prompt.system).toContain(
      "'correctness' | 'performance' | 'security' | 'maintainability' | 'testing' | 'style'",
    );
    expect(prompt.user).toContain("Improve queue fairness");
    expect(prompt.user).toContain("queue fairness");
    expect(prompt.user).toContain("unstable ordering fixes");
    expect(prompt.user).toContain("src/queue/queue-scheduler.ts");
  });

  it("rejects empty review chunks", () => {
    const builder = new PromptBuilder();

    expect(() =>
      builder.build({
        changeRequest: {
          title: "Improve queue fairness",
          number: 42,
        },
        chunk: {
          index: 0,
          total: 1,
          files: [],
        },
        instructionText: "strictness: balanced",
        memory: [],
        commentBudget: 5,
      }),
    ).toThrow(/chunk/i);
  });
});
