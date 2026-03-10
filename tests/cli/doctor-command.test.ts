import { describe, expect, it } from "vitest";

import { DoctorCommand } from "../../src/cli/doctor-command.js";

describe("DoctorCommand", () => {
  it("passes a valid environment configuration", () => {
    const command = new DoctorCommand();
    const result = command.run({
      DATABASE_URL: "postgres://nitpickr:nitpickr@localhost:5432/nitpickr",
      OPENAI_API_KEY: "sk-test",
      GITHUB_APP_ID: "123456",
      GITHUB_BOT_LOGINS: "nitpickr,getnitpickr",
      GITHUB_PRIVATE_KEY:
        "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
      NITPICKR_WEBHOOK_URL: "https://nitpickr.example.com/webhooks/github",
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("reports missing or invalid settings", () => {
    const command = new DoctorCommand();
    const result = command.run({
      DATABASE_URL: "https://nitpickr.example.com",
      OPENAI_API_KEY: "",
      GITHUB_APP_ID: "123456",
      GITHUB_PRIVATE_KEY: "not-a-pem",
      GITHUB_WEBHOOK_SECRET: "secret",
      NITPICKR_WEBHOOK_URL: "https://nitpickr.example.com/hooks",
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("DATABASE_URL");
    expect(result.errors.join("\n")).toContain("OPENAI_API_KEY");
    expect(result.errors.join("\n")).toContain("GITHUB_PRIVATE_KEY");
    expect(result.errors.join("\n")).toContain("NITPICKR_WEBHOOK_URL");
  });

  it("reports invalid optional bot login configuration", () => {
    const command = new DoctorCommand();
    const result = command.run({
      DATABASE_URL: "postgres://nitpickr:nitpickr@localhost:5432/nitpickr",
      OPENAI_API_KEY: "sk-test",
      GITHUB_APP_ID: "123456",
      GITHUB_BOT_LOGINS: " , ",
      GITHUB_PRIVATE_KEY:
        "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
      NITPICKR_WEBHOOK_URL: "https://nitpickr.example.com/webhooks/github",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "GITHUB_BOT_LOGINS must contain at least one bot login.",
    );
  });
});
