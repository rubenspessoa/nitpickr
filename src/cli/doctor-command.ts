import { ZodError } from "zod";

import { parseAppConfig } from "../config/app-config.js";

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidUrl(value: string | undefined): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export class DoctorCommand {
  run(environment: Record<string, string | undefined>): {
    ok: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!isNonEmptyString(environment.DATABASE_URL)) {
      errors.push("DATABASE_URL is required.");
    } else if (!/^postgres(ql)?:\/\//.test(environment.DATABASE_URL)) {
      errors.push("DATABASE_URL must use a postgres:// or postgresql:// URL.");
    }

    if (!isNonEmptyString(environment.OPENAI_API_KEY)) {
      errors.push("OPENAI_API_KEY is required.");
    }

    if (!isNonEmptyString(environment.GITHUB_APP_ID)) {
      errors.push("GITHUB_APP_ID is required.");
    } else if (!/^\d+$/.test(environment.GITHUB_APP_ID)) {
      errors.push("GITHUB_APP_ID must be a numeric GitHub App id.");
    }

    if (!isNonEmptyString(environment.GITHUB_PRIVATE_KEY)) {
      errors.push("GITHUB_PRIVATE_KEY is required.");
    } else if (!environment.GITHUB_PRIVATE_KEY.includes("BEGIN PRIVATE KEY")) {
      errors.push("GITHUB_PRIVATE_KEY must contain a PEM private key block.");
    }

    if (!isNonEmptyString(environment.GITHUB_WEBHOOK_SECRET)) {
      errors.push("GITHUB_WEBHOOK_SECRET is required.");
    }

    if (!isValidUrl(environment.NITPICKR_WEBHOOK_URL)) {
      errors.push("NITPICKR_WEBHOOK_URL must be a valid URL.");
    } else if (!environment.NITPICKR_WEBHOOK_URL.endsWith("/webhooks/github")) {
      errors.push(
        "NITPICKR_WEBHOOK_URL must end with /webhooks/github for the GitHub App webhook.",
      );
    }

    if (
      environment.GITHUB_BOT_LOGINS !== undefined &&
      environment.GITHUB_BOT_LOGINS.split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0).length === 0
    ) {
      errors.push("GITHUB_BOT_LOGINS must contain at least one bot login.");
    }

    if (errors.length > 0) {
      return {
        ok: false,
        errors,
      };
    }

    try {
      parseAppConfig(environment);

      return {
        ok: true,
        errors: [],
      };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          ok: false,
          errors: error.issues.map((issue) => issue.message),
        };
      }

      return {
        ok: false,
        errors: [
          error instanceof Error ? error.message : "Unknown doctor error.",
        ],
      };
    }
  }
}
