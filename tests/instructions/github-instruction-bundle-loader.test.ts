import { describe, expect, it } from "vitest";

import { GitHubInstructionBundleLoader } from "../../src/instructions/github-instruction-bundle-loader.js";

describe("GitHubInstructionBundleLoader", () => {
  it("loads instruction bundles through the GitHub file API", async () => {
    const loader = new GitHubInstructionBundleLoader({
      async readTextFile({ path }) {
        if (path === ".nitpickr.yml") {
          return ["review:", "  maxComments: 8"].join("\n");
        }

        if (path === "AGENTS.md") {
          return "# Team guide\nPrefer small services.";
        }

        if (path === ".nitpickr/review.md") {
          return "# Review focus\nLook for queue regressions.";
        }

        return null;
      },
      async listFiles() {
        return [".nitpickr/review.md"];
      },
    });

    const bundle = await loader.loadForReview({
      installationId: "123456",
      repository: {
        owner: "rubenspessoa",
        name: "nitpickr",
      },
      changeRequest: {
        headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    });

    expect(bundle.config.review.maxComments).toBe(8);
    expect(bundle.combinedText).toContain("Prefer small services.");
  });

  it("treats missing .nitpickr directories as optional", async () => {
    const loader = new GitHubInstructionBundleLoader({
      async readTextFile({ path }) {
        if (path === "AGENTS.md") {
          return "# Team guide\nPrefer small services.";
        }

        return null;
      },
      async listFiles() {
        return [];
      },
    });

    const bundle = await loader.loadForReview({
      installationId: "123456",
      repository: {
        owner: "rubenspessoa",
        name: "nitpickr",
      },
      changeRequest: {
        headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    });

    expect(bundle.combinedText).toContain("Prefer small services.");
    expect(bundle.documents).toEqual([
      {
        path: "AGENTS.md",
        content: "# Team guide\nPrefer small services.",
      },
    ]);
  });
});
