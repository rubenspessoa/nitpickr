import { describe, expect, it } from "vitest";

import { targetReviewCommentLine } from "../../src/publisher/review-comment-targeter.js";

describe("targetReviewCommentLine", () => {
  it("keeps exact changed lines", () => {
    const line = targetReviewCommentLine({
      requestedLine: 12,
      patch: [
        "@@ -10,2 +10,3 @@",
        " context",
        "-old",
        "+new alpha",
        "+new beta",
      ].join("\n"),
    });

    expect(line).toBe(12);
  });

  it("snaps to the nearest changed line within tolerance", () => {
    const line = targetReviewCommentLine({
      requestedLine: 13,
      patch: ["@@ -10,2 +10,2 @@", " context", "-old", "+new alpha"].join("\n"),
      maxLineDistance: 3,
    });

    expect(line).toBe(11);
  });

  it("drops comments when no nearby changed line exists", () => {
    const line = targetReviewCommentLine({
      requestedLine: 40,
      patch: ["@@ -10,2 +10,2 @@", " context", "-old", "+new alpha"].join("\n"),
      maxLineDistance: 3,
    });

    expect(line).toBeNull();
  });

  it("returns null when the file has no patch", () => {
    const line = targetReviewCommentLine({
      requestedLine: 12,
      patch: null,
    });

    expect(line).toBeNull();
  });
});
