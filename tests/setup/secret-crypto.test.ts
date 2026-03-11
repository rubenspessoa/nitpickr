import { describe, expect, it } from "vitest";

import { SecretCrypto } from "../../src/setup/secret-crypto.js";

describe("SecretCrypto", () => {
  it("encrypts and decrypts JSON payloads without leaking plaintext", () => {
    const crypto = new SecretCrypto("super-secret-key");
    const payload = {
      openAiApiKey: "sk-test-key",
      githubWebhookSecret: "webhook-secret",
    };

    const encrypted = crypto.encryptJson(payload);

    expect(encrypted).not.toContain("sk-test-key");
    expect(encrypted).not.toContain("webhook-secret");
    expect(crypto.decryptJson<typeof payload>(encrypted)).toEqual(payload);
  });
});
