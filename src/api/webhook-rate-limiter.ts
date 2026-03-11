export interface WebhookRateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface WebhookRateLimiter {
  consume(key: string): Promise<WebhookRateLimitResult>;
}

interface BucketEntry {
  count: number;
  windowStartedAt: number;
}

export class InMemoryWebhookRateLimiter implements WebhookRateLimiter {
  readonly #maxRequests: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #buckets = new Map<string, BucketEntry>();

  constructor(input?: {
    maxRequests?: number;
    windowMs?: number;
    now?: () => number;
  }) {
    this.#maxRequests = input?.maxRequests ?? 120;
    this.#windowMs = input?.windowMs ?? 60_000;
    this.#now = input?.now ?? (() => Date.now());
  }

  async consume(key: string): Promise<WebhookRateLimitResult> {
    const now = this.#now();
    const current = this.#buckets.get(key);

    if (!current || now - current.windowStartedAt >= this.#windowMs) {
      this.#buckets.set(key, {
        count: 1,
        windowStartedAt: now,
      });
      return {
        allowed: true,
      };
    }

    if (current.count >= this.#maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((this.#windowMs - (now - current.windowStartedAt)) / 1000),
        ),
      };
    }

    this.#buckets.set(key, {
      ...current,
      count: current.count + 1,
    });
    return {
      allowed: true,
    };
  }
}
