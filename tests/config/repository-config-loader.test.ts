import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadRepositoryConfig } from "../../src/config/repository-config-loader.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("loadRepositoryConfig", () => {
  it("returns defaults when the repo config is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nitpickr-config-"));
    directories.push(directory);

    const config = await loadRepositoryConfig(directory);

    expect(config.source).toBeNull();
    expect(config.review.maxComments).toBe(20);
    expect(config.review.maxAutoComments).toBe(5);
    expect(config.review.allowSuggestedChanges).toBe(true);
    expect(config.statusChecks.enabled).toBe(true);
    expect(config.triggers.autoReview.events).toEqual([
      "pull_request.opened",
      "pull_request.synchronize",
      "pull_request.ready_for_review",
    ]);
  });

  it("loads and normalizes a repository config", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nitpickr-config-"));
    directories.push(directory);
    await writeFile(
      join(directory, ".nitpickr.yml"),
      [
        "review:",
        "  maxComments: 5",
        "  maxAutoComments: 2",
        "  allowSuggestedChanges: false",
        "  focusAreas:",
        "    - queue fairness",
        "    - prompt validation",
        "triggers:",
        "  autoReview:",
        "    events:",
        "      - pull_request.opened",
        "      - pull_request.synchronize",
      ].join("\n"),
    );

    const config = await loadRepositoryConfig(directory);

    expect(config.source?.endsWith(".nitpickr.yml")).toBe(true);
    expect(config.review.maxComments).toBe(5);
    expect(config.review.maxAutoComments).toBe(2);
    expect(config.review.allowSuggestedChanges).toBe(false);
    expect(config.review.focusAreas).toContain("queue fairness");
  });

  it("rejects invalid repository configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nitpickr-config-"));
    directories.push(directory);
    await writeFile(
      join(directory, ".nitpickr.yml"),
      ["review:", "  maxComments: 0"].join("\n"),
    );

    await expect(() => loadRepositoryConfig(directory)).rejects.toThrow(
      /maxComments/i,
    );
  });
});
