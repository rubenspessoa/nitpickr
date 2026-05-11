import { describe, expect, it } from "vitest";

import { PromptPayloadOptimizer } from "../../src/review/prompt-payload-optimizer.js";

function longPatch(label: string, length: number): string {
  const bodyLength = Math.max(0, length - (label.length + 16));
  return `START-${label}\n${"x".repeat(bodyLength)}\nEND-${label}`;
}

describe("PromptPayloadOptimizer", () => {
  it("compacts context files to metadata-only in deterministic order", () => {
    const optimizer = new PromptPayloadOptimizer();
    const optimized = optimizer.optimize({
      scope: "commit_delta",
      mode: "balanced",
      files: [
        {
          path: "src/main.ts",
          additions: 3,
          deletions: 1,
          patch: "@@ -1,1 +1,2 @@\n+main",
        },
      ],
      contextFiles: [
        {
          path: "src/beta.ts",
          additions: 4,
          deletions: 4,
          patch: "@@ -1,1 +1,2 @@\n+beta",
        },
        {
          path: "src/alpha.ts",
          additions: 4,
          deletions: 4,
          patch: "@@ -1,1 +1,2 @@\n+alpha",
        },
        {
          path: "src/omega.ts",
          additions: 30,
          deletions: 1,
          patch: "@@ -1,1 +1,2 @@\n+omega",
        },
      ],
      instructionText: "strictness: balanced",
      memory: [],
    });

    const compactedContext = optimized.contextFiles ?? [];
    expect(compactedContext.map((file) => file.path)).toEqual([
      "src/omega.ts",
      "src/alpha.ts",
      "src/beta.ts",
    ]);
    expect(compactedContext.every((file) => file.patch === null)).toBe(true);
  });

  it("enforces primary patch budgets and preserves patch edges when truncating", () => {
    const optimizer = new PromptPayloadOptimizer();
    const optimized = optimizer.optimize({
      scope: "commit_delta",
      mode: "balanced",
      files: ["a", "b", "c", "d", "e"].map((suffix) => ({
        path: `src/${suffix}.ts`,
        additions: 100,
        deletions: 50,
        patch: longPatch(suffix, 10_000),
      })),
      instructionText: "strictness: balanced",
      memory: [],
    });

    const totalPatchChars = optimized.files.reduce(
      (total, file) => total + (file.patch?.length ?? 0),
      0,
    );

    expect(totalPatchChars).toBeLessThanOrEqual(20_000);
    for (const file of optimized.files) {
      const suffix = file.path.split("/").pop()?.replace(/\.ts$/, "");
      expect(suffix).toBeTruthy();
      expect(file.patch).not.toBeNull();
      expect(file.patch?.length ?? 0).toBeGreaterThan(0);
      expect(file.patch?.length ?? 0).toBeLessThanOrEqual(6_000);
      expect(file.patch).toContain(`START-${suffix}`);
      expect(file.patch).toContain(`END-${suffix}`);
      expect(file.patch).toContain("[omitted");
    }
  });

  it("selects chunk memory with path matches first, then global entries", () => {
    const optimizer = new PromptPayloadOptimizer();
    const selected = optimizer.selectChunkMemory({
      mode: "balanced",
      files: [
        {
          path: "src/app/main.ts",
          additions: 1,
          deletions: 0,
          patch: "@@ -1,1 +1,1 @@\n+main",
        },
      ],
      memory: [
        {
          path: "src/other",
          summary: "non matching memory",
        },
        {
          path: "src/app",
          summary: "app-level memory",
        },
        {
          summary: "global guidance",
        },
        {
          path: "src/app/main.ts",
          summary: "file-level memory",
        },
      ],
    });

    expect(selected).toEqual([
      {
        path: "src/app",
        summary: "app-level memory",
      },
      {
        path: "src/app/main.ts",
        summary: "file-level memory",
      },
      {
        summary: "global guidance",
      },
    ]);
  });

  it("matches chunk memory relevance with Windows-style path separators", () => {
    const optimizer = new PromptPayloadOptimizer();
    const selected = optimizer.selectChunkMemory({
      mode: "balanced",
      files: [
        {
          path: "src\\app\\main.ts",
          additions: 1,
          deletions: 0,
          patch: "@@ -1,1 +1,1 @@\n+main",
        },
      ],
      memory: [
        {
          path: "src\\app",
          summary: "windows path memory",
        },
        {
          summary: "global fallback",
        },
      ],
    });

    expect(selected).toEqual([
      {
        path: "src\\app",
        summary: "windows path memory",
      },
      {
        summary: "global fallback",
      },
    ]);
  });

  it("keeps payload unchanged when optimization mode is off", () => {
    const optimizer = new PromptPayloadOptimizer();
    const optimized = optimizer.optimize({
      scope: "full_pr",
      mode: "off",
      files: [
        {
          path: "src/main.ts",
          additions: 3,
          deletions: 1,
          patch: "@@ -1,1 +1,2 @@\n+main",
        },
      ],
      contextFiles: [
        {
          path: "src/context.ts",
          additions: 2,
          deletions: 2,
          patch: "@@ -1,1 +1,2 @@\n+context",
        },
      ],
      instructionText: "strictness: balanced",
      memory: [
        {
          path: "src/main.ts",
          summary: "keep this",
        },
      ],
    });

    expect(optimized.files[0]?.patch).toBe("@@ -1,1 +1,2 @@\n+main");
    expect(optimized.contextFiles?.[0]?.patch).toBe(
      "@@ -1,1 +1,2 @@\n+context",
    );
    expect(optimized.instructionText).toBe("strictness: balanced");
    expect(
      optimizer.selectChunkMemory({
        mode: "off",
        files: optimized.files,
        memory: optimized.memory,
      }),
    ).toEqual([
      {
        path: "src/main.ts",
        summary: "keep this",
      },
    ]);
  });

  it("estimates prompt usage from compacted payload components", () => {
    const optimizer = new PromptPayloadOptimizer();
    const usage = optimizer.estimatePromptUsage({
      chunks: [
        [
          {
            path: "src/a.ts",
            additions: 2,
            deletions: 1,
            patch: "abcde",
          },
        ],
        [
          {
            path: "src/b.ts",
            additions: 2,
            deletions: 1,
            patch: "vwxyz",
          },
        ],
      ],
      contextFiles: [
        {
          path: "src/context.ts",
          additions: 1,
          deletions: 1,
          patch: "1234",
        },
      ],
      instructionText: "1234567890",
      chunkMemory: [
        [{ summary: "abcdef" }],
        [{ path: "src/b.ts", summary: "ghij" }],
      ],
    });

    expect(usage.chunkCount).toBe(2);
    expect(usage.primaryPatchChars).toBe(10);
    expect(usage.contextPatchChars).toBeGreaterThan(0);
    expect(usage.instructionChars).toBeGreaterThan(0);
    expect(usage.memoryChars).toBeGreaterThan(0);
    expect(usage.contextPatchChars % usage.chunkCount).toBe(0);
    expect(usage.instructionChars % usage.chunkCount).toBe(0);
    expect(usage.estimatedPromptTokens).toBe(
      Math.ceil(
        (usage.primaryPatchChars +
          usage.contextPatchChars +
          usage.instructionChars +
          usage.memoryChars) /
          4,
      ),
    );
  });

  it("preserves patches and drops file content first when over budget", () => {
    const optimizer = new PromptPayloadOptimizer();
    const oversizedContent = "a".repeat(200_000);
    const optimized = optimizer.optimize({
      scope: "commit_delta",
      mode: "balanced",
      files: [
        {
          path: "src/big.ts",
          additions: 5,
          deletions: 0,
          patch: "@@ -1 +1,2 @@\n+keep this",
          fileContent: oversizedContent,
        },
        {
          path: "src/small.ts",
          additions: 1,
          deletions: 0,
          patch: "@@ -1 +1,2 @@\n+also keep",
          fileContent: "ok",
        },
      ],
      instructionText: "",
      memory: [],
    });

    const big = optimized.files.find((file) => file.path === "src/big.ts");
    const small = optimized.files.find((file) => file.path === "src/small.ts");
    expect(big?.patch).toBe("@@ -1 +1,2 @@\n+keep this");
    expect(small?.patch).toBe("@@ -1 +1,2 @@\n+also keep");
    expect(big?.fileContent?.length).toBeLessThan(oversizedContent.length);
    expect(big?.fileContent?.length).toBeGreaterThan(0);
    expect(small?.fileContent).toBe("ok");
  });

  it("passes through fileContent untouched in 'off' mode", () => {
    const optimizer = new PromptPayloadOptimizer();
    const optimized = optimizer.optimize({
      scope: "commit_delta",
      mode: "off",
      files: [
        {
          path: "src/a.ts",
          additions: 1,
          deletions: 0,
          patch: "@@ -1 +1 @@\n+x",
          fileContent: "hello",
        },
      ],
      instructionText: "",
      memory: [],
    });

    expect(
      optimized.files.find((file) => file.path === "src/a.ts")?.fileContent,
    ).toBe("hello");
  });
});
