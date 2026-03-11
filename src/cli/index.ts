import { cwd, env, exit } from "node:process";

import { parseBootstrapConfig as parseCliBootstrapConfig } from "../config/app-config.js";
import { createPostgresClient } from "../runtime/postgres.js";
import { DoctorCommand } from "./doctor-command.js";
import { EvalReviewsCommand } from "./eval-reviews-command.js";
import { runMigrationsWithAdvisoryLock } from "./migrate-command.js";
import { SetupCommand } from "./setup-command.js";

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === "setup") {
    const setup = new SetupCommand();
    await setup.run({
      cwd: cwd(),
      values: {
        openAiApiKey: env.OPENAI_API_KEY ?? "",
        databaseUrl: env.DATABASE_URL ?? "",
        githubAppId: env.GITHUB_APP_ID ?? "",
        githubPrivateKey: env.GITHUB_PRIVATE_KEY ?? "",
        githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET ?? "",
        webhookUrl: env.NITPICKR_WEBHOOK_URL ?? "",
      },
    });
    return;
  }

  if (command === "doctor") {
    const doctor = new DoctorCommand();
    const result = doctor.run(env);
    if (!result.ok) {
      throw new Error(result.errors.join("\n"));
    }
    return;
  }

  if (command === "eval:reviews") {
    const evaluation = new EvalReviewsCommand();
    await evaluation.run({
      cwd: cwd(),
    });
    return;
  }

  if (command === "migrate") {
    // CLI bootstrap commands intentionally use bootstrap-only config because
    // migrations run before runtime secrets are guaranteed to exist.
    const config = parseCliBootstrapConfig(env);
    const sql = createPostgresClient(config.databaseUrl);
    try {
      await runMigrationsWithAdvisoryLock(sql);
    } finally {
      await sql.end();
    }
    return;
  }

  throw new Error(`Unknown nitpickr CLI command: ${command ?? "(missing)"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  exit(1);
});
