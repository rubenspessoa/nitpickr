import { z } from "zod";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const nodeEnvironmentSchema = z.enum(["development", "test", "production"]);

const environmentSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema.optional(),
  PORT: z.string().optional(),
  DATABASE_URL: z.string().url(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  GITHUB_APP_ID: z.string().regex(/^\d+$/),
  GITHUB_API_BASE_URL: z.string().url().optional(),
  GITHUB_BOT_LOGINS: z.string().min(1).optional(),
  GITHUB_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  NITPICKR_WEBHOOK_URL: z.string().url(),
  NITPICKR_LOG_LEVEL: logLevelSchema.optional(),
  NITPICKR_WORKER_CONCURRENCY: z.string().optional(),
  NITPICKR_WORKER_POLL_INTERVAL_MS: z.string().optional(),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
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
  };
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

export function parseAppConfig(
  input: Record<string, string | undefined>,
): AppConfig {
  const parsed = environmentSchema.parse(input);

  return {
    nodeEnv: parsed.NODE_ENV ?? "development",
    port: parseInteger(parsed.PORT, "PORT", 3000),
    databaseUrl: parsed.DATABASE_URL,
    openAiApiKey: parsed.OPENAI_API_KEY,
    openAi: {
      model: parsed.OPENAI_MODEL ?? "gpt-4.1",
      baseUrl: parsed.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    },
    github: {
      appId: Number.parseInt(parsed.GITHUB_APP_ID, 10),
      apiBaseUrl: parsed.GITHUB_API_BASE_URL ?? "https://api.github.com",
      botLogins: parseBotLogins(parsed.GITHUB_BOT_LOGINS),
      privateKey: parsed.GITHUB_PRIVATE_KEY.replace(/\\n/g, "\n"),
      webhookSecret: parsed.GITHUB_WEBHOOK_SECRET,
      webhookUrl: parsed.NITPICKR_WEBHOOK_URL,
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
    },
  };
}
