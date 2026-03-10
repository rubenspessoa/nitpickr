import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { GitHubAppAuth } from "../../src/providers/github/github-app-auth.js";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

describe("GitHubAppAuth", () => {
  it("creates a signed GitHub app JWT", () => {
    const auth = new GitHubAppAuth(
      {
        appId: 123456,
        privateKey: privateKey
          .export({
            type: "pkcs8",
            format: "pem",
          })
          .toString(),
      },
      async () => {
        throw new Error("not used");
      },
      () => new Date("2026-03-09T10:00:00.000Z"),
    );

    const jwt = auth.createAppJwt();
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("retrieves an installation token", async () => {
    const auth = new GitHubAppAuth(
      {
        appId: 123456,
        privateKey: privateKey
          .export({
            type: "pkcs8",
            format: "pem",
          })
          .toString(),
      },
      async (_input, init) => {
        expect(init?.headers).toMatchObject({
          accept: "application/vnd.github+json",
        });

        return new Response(
          JSON.stringify({
            token: "ghs_token",
          }),
          { status: 201 },
        );
      },
      () => new Date("2026-03-09T10:00:00.000Z"),
    );

    const token = await auth.getInstallationAccessToken("123456");

    expect(token).toBe("ghs_token");
  });
});
