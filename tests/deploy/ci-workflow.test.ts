import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("ci workflow", () => {
  it("relies on the packageManager field for the pnpm version", () => {
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/ci.yml"),
      "utf8",
    );

    expect(workflow).toContain("pnpm/action-setup@v4");
    expect(workflow).not.toMatch(
      /- uses: pnpm\/action-setup@v4\s*\n\s*with:\s*\n\s*version:/,
    );
  });
});
