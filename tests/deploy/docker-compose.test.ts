import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("docker-compose runtime commands", () => {
  it("runs migrations in a dedicated one-shot service before api and worker", async () => {
    const contents = await readFile(
      join(process.cwd(), "docker-compose.yml"),
      "utf8",
    );
    const document = parse(contents) as {
      services?: {
        api?: {
          command?: string[];
          depends_on?: Record<string, { condition?: string }>;
        };
        worker?: {
          command?: string[];
          depends_on?: Record<string, { condition?: string }>;
        };
        migrate?: { command?: string[] };
      };
    };

    expect(document.services?.migrate?.command?.join(" ")).toContain(
      "node dist/src/cli/index.js migrate",
    );
    expect(document.services?.api?.command?.join(" ")).not.toContain("migrate");
    expect(document.services?.worker?.command?.join(" ")).not.toContain(
      "migrate",
    );
    expect(document.services?.api?.depends_on?.migrate?.condition).toBe(
      "service_completed_successfully",
    );
    expect(document.services?.worker?.depends_on?.migrate?.condition).toBe(
      "service_completed_successfully",
    );
  });
});
