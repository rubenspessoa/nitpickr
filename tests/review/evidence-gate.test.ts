import { describe, expect, it } from "vitest";

import { gateAndRankFindings } from "../../src/review/evidence-gate.js";

describe("gateAndRankFindings", () => {
  it("suppresses findings when matching suppressing feedback exists", () => {
    const result = gateAndRankFindings({
      findings: [
        {
          path: "src/api/server.ts",
          line: 12,
          findingType: "bug",
          severity: "high",
          category: "correctness",
          title: "Guard malformed JSON",
        },
      ],
      files: [
        {
          path: "src/api/server.ts",
          patch: "@@ -10,1 +10,2 @@\n context\n+guard",
        },
      ],
      feedbackSignals: [
        {
          path: "src/api/server.ts",
          category: "correctness",
          findingType: "bug",
          score: -2,
          suppress: true,
        },
      ],
      publishableFindingTypes: ["bug"],
    });

    expect(result.acceptedFindings).toEqual([]);
    expect(result.rejectedFindings).toEqual([
      expect.objectContaining({
        reasons: ["suppressed_by_feedback"],
      }),
    ]);
  });

  it("keeps no-hunk patches eligible for later targeting", () => {
    const result = gateAndRankFindings({
      findings: [
        {
          path: "src/api/server.ts",
          line: 200,
          findingType: "bug",
          severity: "medium",
          category: "maintainability",
          title: "Clarify binary diff handling",
        },
      ],
      files: [
        {
          path: "src/api/server.ts",
          patch: "Binary files differ",
        },
      ],
      publishableFindingTypes: ["bug"],
    });

    expect(result.acceptedFindings).toHaveLength(1);
    expect(result.rejectedFindings).toEqual([]);
  });
});
