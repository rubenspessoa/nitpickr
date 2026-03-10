import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export class SecretCrypto {
  readonly #secret: string;

  constructor(secret: string) {
    if (secret.trim().length === 0) {
      throw new Error("SecretCrypto requires a non-empty secret.");
    }

    this.#secret = secret;
  }

  encryptJson(input: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", deriveKey(this.#secret), iv);
    const plaintext = Buffer.from(JSON.stringify(input), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [iv, tag, encrypted]
      .map((part) => part.toString("base64url"))
      .join(".");
  }

  decryptJson<T>(payload: string): T {
    const [ivPart, tagPart, encryptedPart] = payload.split(".");
    if (!ivPart || !tagPart || !encryptedPart) {
      throw new Error("Encrypted payload is malformed.");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(this.#secret),
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, "base64url")),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString("utf8")) as T;
  }
}
