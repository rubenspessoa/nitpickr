import { createPrivateKey, createSign } from "node:crypto";

export type FetchLike = typeof fetch;

export interface GitHubAppAuthConfig {
  appId: number;
  privateKey: string;
  baseUrl?: string;
}

export class GitHubAppAuth {
  readonly #config: GitHubAppAuthConfig;
  readonly #fetch: FetchLike;
  readonly #now: () => Date;

  constructor(
    config: GitHubAppAuthConfig,
    fetchFn: FetchLike = fetch,
    now: () => Date = () => new Date(),
  ) {
    this.#config = config;
    this.#fetch = fetchFn;
    this.#now = now;
  }

  createAppJwt(): string {
    const issuedAt = Math.floor(this.#now().getTime() / 1000);
    const header = Buffer.from(
      JSON.stringify({
        alg: "RS256",
        typ: "JWT",
      }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iat: issuedAt - 60,
        exp: issuedAt + 600,
        iss: this.#config.appId,
      }),
    ).toString("base64url");

    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${payload}`);
    signer.end();

    const signature = signer
      .sign(createPrivateKey(this.#config.privateKey))
      .toString("base64url");

    return `${header}.${payload}.${signature}`;
  }

  async getInstallationAccessToken(installationId: string): Promise<string> {
    const response = await this.#fetch(
      `${
        this.#config.baseUrl ?? "https://api.github.com"
      }/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.createAppJwt()}`,
          accept: "application/vnd.github+json",
        },
      },
    );

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `GitHub installation token request failed with status ${response.status}: ${details}`,
      );
    }

    const payload = (await response.json()) as {
      token?: string;
    };
    if (!payload.token) {
      throw new Error(
        "GitHub installation token response did not include a token.",
      );
    }

    return payload.token;
  }
}
