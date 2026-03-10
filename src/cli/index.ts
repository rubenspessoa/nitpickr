import { cwd, env, exit } from "node:process";

import { parseAppConfig } from "../config/app-config.js";
import { createPostgresClient } from "../runtime/postgres.js";
import { DoctorCommand } from "./doctor-command.js";
import { MigrateCommand } from "./migrate-command.js";
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

  if (command === "migrate") {
    const config = parseAppConfig(env);
    const sql = createPostgresClient(config.databaseUrl);
    try {
      const migrate = new MigrateCommand(sql);
      await migrate.run();
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
