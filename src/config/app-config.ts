import { z } from "zod";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const nodeEnvironmentSchema = z.enum(["development", "test", "production"]);

const bootstrapEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema.optional(),
  PORT: z.string().optional(),
  DATABASE_URL: z.string().url(),
  OPENAI_MODEL: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  GITHUB_API_BASE_URL: z.string().url().optional(),
  GITHUB_BOT_LOGINS: z.string().min(1).optional(),
  NITPICKR_BASE_URL: z.string().url().optional(),
  NITPICKR_WEBHOOK_URL: z.string().url().optional(),
  NITPICKR_SECRET_KEY: z.string().min(1).optional(),
  NITPICKR_LOG_LEVEL: logLevelSchema.optional(),
  NITPICKR_WORKER_CONCURRENCY: z.string().optional(),
  NITPICKR_WORKER_POLL_INTERVAL_MS: z.string().optional(),
  NITPICKR_JOB_STALE_AFTER_MS: z.string().optional(),
  NITPICKR_WORKER_HEARTBEAT_INTERVAL_MS: z.string().optional(),
  NITPICKR_READY_WORKER_STALE_AFTER_MS: z.string().optional(),
  NITPICKR_REPOSITORY_ALLOWLIST: z.string().min(1).optional(),
  DISCORD_WEBHOOK_URL: z.string().url().optional(),
});

const runtimeSecretEnvironmentSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).optional(),
  GITHUB_APP_ID: z.string().regex(/^\d+$/),
  GITHUB_BOT_LOGINS: z.string().min(1).optional(),
  GITHUB_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
});

type BootstrapEnvironment = z.infer<typeof bootstrapEnvironmentSchema>;

export interface RuntimeSecrets {
  openAiApiKey: string;
  openAiModel?: string;
  githubAppId: number;
  githubPrivateKey: string;
  githubWebhookSecret: string;
  githubBotLogins?: string[];
}

export interface BootstrapConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  baseUrl: string;
  secretKey: string | null;
  openAi: {
    model: string;
    baseUrl: string;
  };
  github: {
    apiBaseUrl: string;
    botLogins: string[];
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
  };
  worker: {
    concurrency: number;
    pollIntervalMs: number;
    heartbeatIntervalMs: number;
  };
  jobs: {
    staleAfterMs: number;
  };
  ready: {
    workerStaleAfterMs: number;
  };
  repositoryAllowlist: string[] | null;
  discordWebhookUrl: string | null;
}

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  baseUrl: string;
  databaseUrl: string;
  runtimeSecretSource: "environment" | "persisted_store";
  openAiApiKey: string;
  openAi: {
    model: string;
    baseUrl: string;
  };
  github: {
    appId: number;
    apiBaseUrl: string;
    botLogins: string[];
    privateKey: string;
    webhookSecret: string;
    webhookUrl: string;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
  };
  worker: {
    concurrency: number;
    pollIntervalMs: number;
    heartbeatIntervalMs: number;
  };
  jobs: {
    staleAfterMs: number;
  };
  ready: {
    workerStaleAfterMs: number;
  };
  repositoryAllowlist: string[] | null;
  discordWebhookUrl: string | null;
}

function parseInteger(
  value: string | undefined,
  fieldName: string,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return parsed;
}

function parseBotLogins(value: string | undefined): string[] {
  if (value === undefined) {
    return ["nitpickr", "getnitpickr"];
  }

  const parsed = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  if (parsed.length === 0) {
    throw new Error("GITHUB_BOT_LOGINS must contain at least one login.");
  }

  return [...new Set(parsed)];
}

function parseRepositoryAllowlist(value: string | undefined): string[] | null {
  if (value === undefined) {
    return null;
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return entries.length > 0 ? [...new Set(entries)] : null;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function deriveBaseUrl(parsed: BootstrapEnvironment, port: number): string {
  if (parsed.NITPICKR_BASE_URL) {
    return normalizeBaseUrl(parsed.NITPICKR_BASE_URL);
  }

  if (parsed.NITPICKR_WEBHOOK_URL) {
    if (!parsed.NITPICKR_WEBHOOK_URL.endsWith("/webhooks/github")) {
      throw new Error(
        "NITPICKR_WEBHOOK_URL must end with /webhooks/github for the GitHub App webhook.",
      );
    }

    return normalizeBaseUrl(
      parsed.NITPICKR_WEBHOOK_URL.slice(0, -"/webhooks/github".length),
    );
  }

  if ((parsed.NODE_ENV ?? "development") !== "production") {
    return `http://localhost:${port}`;
  }

  throw new Error(
    "NITPICKR_BASE_URL is required in production when NITPICKR_WEBHOOK_URL is not provided.",
  );
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n");
}

export function parseBootstrapConfig(
  input: Record<string, string | undefined>,
): BootstrapConfig {
  const parsed = bootstrapEnvironmentSchema.parse(input);
  const port = parseInteger(parsed.PORT, "PORT", 3000);

  return {
    nodeEnv: parsed.NODE_ENV ?? "development",
    port,
    databaseUrl: parsed.DATABASE_URL,
    baseUrl: deriveBaseUrl(parsed, port),
    secretKey: parsed.NITPICKR_SECRET_KEY ?? null,
    openAi: {
      model: parsed.OPENAI_MODEL ?? "gpt-4.1",
      baseUrl: parsed.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    },
    github: {
      apiBaseUrl: parsed.GITHUB_API_BASE_URL ?? "https://api.github.com",
      botLogins: parseBotLogins(parsed.GITHUB_BOT_LOGINS),
    },
    logging: {
      level: parsed.NITPICKR_LOG_LEVEL ?? "info",
    },
    worker: {
      concurrency: parseInteger(
        parsed.NITPICKR_WORKER_CONCURRENCY,
        "NITPICKR_WORKER_CONCURRENCY",
        4,
      ),
      pollIntervalMs: parseInteger(
        parsed.NITPICKR_WORKER_POLL_INTERVAL_MS,
        "NITPICKR_WORKER_POLL_INTERVAL_MS",
        5000,
      ),
      heartbeatIntervalMs: parseInteger(
        parsed.NITPICKR_WORKER_HEARTBEAT_INTERVAL_MS,
        "NITPICKR_WORKER_HEARTBEAT_INTERVAL_MS",
        5000,
      ),
    },
    jobs: {
      staleAfterMs: parseInteger(
        parsed.NITPICKR_JOB_STALE_AFTER_MS,
        "NITPICKR_JOB_STALE_AFTER_MS",
        120_000,
      ),
    },
    ready: {
      workerStaleAfterMs: parseInteger(
        parsed.NITPICKR_READY_WORKER_STALE_AFTER_MS,
        "NITPICKR_READY_WORKER_STALE_AFTER_MS",
        20_000,
      ),
    },
    repositoryAllowlist: parseRepositoryAllowlist(
      parsed.NITPICKR_REPOSITORY_ALLOWLIST,
    ),
    discordWebhookUrl: parsed.DISCORD_WEBHOOK_URL ?? null,
  };
}

export function parseRuntimeSecretsFromEnvironment(
  input: Record<string, string | undefined>,
): RuntimeSecrets | null {
  const result = runtimeSecretEnvironmentSchema.safeParse(input);
  if (!result.success) {
    return null;
  }

  const runtimeSecrets: RuntimeSecrets = {
    openAiApiKey: result.data.OPENAI_API_KEY,
    githubAppId: Number.parseInt(result.data.GITHUB_APP_ID, 10),
    githubPrivateKey: normalizePrivateKey(result.data.GITHUB_PRIVATE_KEY),
    githubWebhookSecret: result.data.GITHUB_WEBHOOK_SECRET,
  };

  if (result.data.OPENAI_MODEL) {
    runtimeSecrets.openAiModel = result.data.OPENAI_MODEL;
  }

  if (result.data.GITHUB_BOT_LOGINS) {
    runtimeSecrets.githubBotLogins = parseBotLogins(
      result.data.GITHUB_BOT_LOGINS,
    );
  }

  return runtimeSecrets;
}

export function buildAppConfig(
  bootstrap: BootstrapConfig,
  secrets: RuntimeSecrets,
  runtimeSecretSource: AppConfig["runtimeSecretSource"] = "persisted_store",
): AppConfig {
  return {
    nodeEnv: bootstrap.nodeEnv,
    port: bootstrap.port,
    baseUrl: bootstrap.baseUrl,
    databaseUrl: bootstrap.databaseUrl,
    runtimeSecretSource,
    openAiApiKey: secrets.openAiApiKey,
    openAi: {
      model: secrets.openAiModel ?? bootstrap.openAi.model,
      baseUrl: bootstrap.openAi.baseUrl,
    },
    github: {
      appId: secrets.githubAppId,
      apiBaseUrl: bootstrap.github.apiBaseUrl,
      botLogins: secrets.githubBotLogins ?? bootstrap.github.botLogins,
      privateKey: secrets.githubPrivateKey,
      webhookSecret: secrets.githubWebhookSecret,
      webhookUrl: `${bootstrap.baseUrl}/webhooks/github`,
    },
    logging: bootstrap.logging,
    worker: bootstrap.worker,
    jobs: bootstrap.jobs,
    ready: bootstrap.ready,
    repositoryAllowlist: bootstrap.repositoryAllowlist,
    discordWebhookUrl: bootstrap.discordWebhookUrl,
  };
}

export function parseAppConfig(
  input: Record<string, string | undefined>,
): AppConfig {
  const secrets = parseRuntimeSecretsFromEnvironment(input);
  if (!secrets) {
    runtimeSecretEnvironmentSchema.parse(input);
  }

  return buildAppConfig(
    parseBootstrapConfig(input),
    secrets as RuntimeSecrets,
    "environment",
  );
}
