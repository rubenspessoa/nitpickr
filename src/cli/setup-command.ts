import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const defaultDatabaseUrl = "postgres://nitpickr:nitpickr@db:5432/nitpickr";
const defaultGitHubApiBaseUrl = "https://api.github.com";
const defaultGitHubBotLogins = "nitpickr,getnitpickr";
const defaultWebhookUrl = "https://your-public-host/webhooks/github";
const defaultOpenAiBaseUrl = "https://api.openai.com/v1";
const defaultOpenAiModel = "gpt-4.1";
const defaultPort = "3000";
const defaultLogLevel = "info";
const defaultWorkerConcurrency = "4";
const defaultWorkerPollIntervalMs = "5000";

const repositoryConfigTemplate = [
  "review:",
  "  strictness: balanced",
  "  maxComments: 20",
  "  focusAreas: []",
  "  ignorePaths: []",
].join("\n");

export class SetupCommand {
  async run(input: {
    cwd: string;
    values: {
      openAiApiKey: string;
      databaseUrl: string;
      githubAppId: string;
      githubPrivateKey: string;
      githubWebhookSecret: string;
      webhookUrl: string;
    };
  }): Promise<void> {
    await mkdir(input.cwd, { recursive: true });

    const envContents = [
      `DATABASE_URL=${input.values.databaseUrl || defaultDatabaseUrl}`,
      `OPENAI_API_KEY=${input.values.openAiApiKey}`,
      `OPENAI_BASE_URL=${defaultOpenAiBaseUrl}`,
      `OPENAI_MODEL=${defaultOpenAiModel}`,
      `GITHUB_APP_ID=${input.values.githubAppId}`,
      `GITHUB_API_BASE_URL=${defaultGitHubApiBaseUrl}`,
      `GITHUB_BOT_LOGINS=${defaultGitHubBotLogins}`,
      `GITHUB_PRIVATE_KEY=${input.values.githubPrivateKey.replace(/\n/g, "\\n")}`,
      `GITHUB_WEBHOOK_SECRET=${input.values.githubWebhookSecret}`,
      `NITPICKR_WEBHOOK_URL=${input.values.webhookUrl || defaultWebhookUrl}`,
      `PORT=${defaultPort}`,
      `NITPICKR_LOG_LEVEL=${defaultLogLevel}`,
      `NITPICKR_WORKER_CONCURRENCY=${defaultWorkerConcurrency}`,
      `NITPICKR_WORKER_POLL_INTERVAL_MS=${defaultWorkerPollIntervalMs}`,
    ].join("\n");

    await writeFile(join(input.cwd, ".env"), `${envContents}\n`, "utf8");
    await writeFile(
      join(input.cwd, ".nitpickr.yml"),
      `${repositoryConfigTemplate}\n`,
      "utf8",
    );
  }
}
