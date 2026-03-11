import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("railway deployment config", () => {
  it("defines a dedicated api service config", () => {
    const config = readFileSync(
      resolve(process.cwd(), "deploy/railway/api.toml"),
      "utf8",
    );

    expect(config).toContain('builder = "DOCKERFILE"');
    expect(config).toContain('dockerfilePath = "Dockerfile"');
    expect(config).toContain(
      'preDeployCommand = "node dist/src/cli/index.js migrate"',
    );
    expect(config).toContain('startCommand = "node dist/src/api/index.js"');
    expect(config).toContain('healthcheckPath = "/healthz"');
  });

  it("defines a dedicated worker service config", () => {
    const config = readFileSync(
      resolve(process.cwd(), "deploy/railway/worker.toml"),
      "utf8",
    );

    expect(config).toContain('builder = "DOCKERFILE"');
    expect(config).toContain('dockerfilePath = "Dockerfile"');
    expect(config).toContain(
      'preDeployCommand = "node dist/src/cli/index.js migrate"',
    );
    expect(config).toContain('startCommand = "node dist/src/worker/index.js"');
  });
});
