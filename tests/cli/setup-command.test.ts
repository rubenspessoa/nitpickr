import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SetupCommand } from "../../src/cli/setup-command.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("SetupCommand", () => {
  it("writes .env and .nitpickr.yml templates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nitpickr-setup-"));
    directories.push(directory);

    const command = new SetupCommand();
    await command.run({
      cwd: directory,
      values: {
        reviewModel: "qwen3.6:35b-a3b-coding-nvfp4",
        databaseUrl: "postgres://nitpickr:nitpickr@db:5432/nitpickr",
        githubAppId: "123456",
        githubPrivateKey:
          "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
        githubWebhookSecret: "webhook-secret",
        webhookUrl: "https://nitpickr.example.com/webhooks/github",
      },
    });

    const envFile = await readFile(join(directory, ".env"), "utf8");
    const configFile = await readFile(join(directory, ".nitpickr.yml"), "utf8");

    expect(envFile).toContain(
      "NITPICKR_REVIEW_MODEL=qwen3.6:35b-a3b-coding-nvfp4",
    );
    expect(envFile).toContain(
      "NITPICKR_MODEL_BASE_URL=http://host.docker.internal:11434/v1",
    );
    expect(envFile).not.toContain("OPENAI_");
    expect(envFile).toContain("GITHUB_API_BASE_URL=https://api.github.com");
    expect(envFile).toContain("NITPICKR_LOG_LEVEL=info");
    expect(configFile).toContain("strictness: balanced");
  });

  it("fills self-hosted defaults when optional values are blank", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nitpickr-setup-"));
    directories.push(directory);

    const command = new SetupCommand();
    await command.run({
      cwd: directory,
      values: {
        reviewModel: "",
        databaseUrl: "",
        githubAppId: "",
        githubPrivateKey: "",
        githubWebhookSecret: "",
        webhookUrl: "",
      },
    });

    const envFile = await readFile(join(directory, ".env"), "utf8");

    expect(envFile).toContain(
      "DATABASE_URL=postgres://nitpickr:nitpickr@db:5432/nitpickr",
    );
    expect(envFile).toContain("NITPICKR_REVIEW_MODEL=\n");
    expect(envFile).toContain("PORT=3000");
    expect(envFile).toContain("NITPICKR_LOG_LEVEL=info");
    expect(envFile).toContain("NITPICKR_WORKER_CONCURRENCY=4");
    expect(envFile).toContain("NITPICKR_WORKER_POLL_INTERVAL_MS=5000");
    expect(envFile).toContain(
      "NITPICKR_WEBHOOK_URL=https://your-public-host/webhooks/github",
    );
    expect(envFile).toContain(
      "NITPICKR_MODEL_BASE_URL=http://host.docker.internal:11434/v1",
    );
    expect(envFile).toContain("GITHUB_API_BASE_URL=https://api.github.com");
  });
});
