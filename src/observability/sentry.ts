import * as Sentry from "@sentry/node";

import { type Logger, noopLogger } from "../logging/logger.js";

export interface InitSentryInput {
  dsn: string | null;
  environment: string;
  release?: string;
  tracesSampleRate: number;
  logger?: Logger;
}

let initialized = false;

const SENSITIVE_KEY_PATTERN =
  /api[_-]?key|private[_-]?key|webhook[_-]?secret|authorization|secret/i;

function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactObject(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = "[redacted]";
        continue;
      }
      result[key] = redactObject(raw, depth + 1);
    }
    return result;
  }
  return value;
}

export function initSentry(input: InitSentryInput): void {
  const logger = (input.logger ?? noopLogger).child({
    component: "sentry",
  });

  if (!input.dsn) {
    logger.warn("Sentry disabled — SENTRY_DSN not set.", {});
    return;
  }

  if (initialized) {
    return;
  }

  Sentry.init({
    dsn: input.dsn,
    environment: input.environment,
    release: input.release,
    tracesSampleRate: input.tracesSampleRate,
    integrations: [Sentry.httpIntegration(), Sentry.postgresIntegration()],
    beforeSend(event) {
      if (event.extra) {
        event.extra = redactObject(event.extra) as typeof event.extra;
      }
      if (event.contexts) {
        event.contexts = redactObject(event.contexts) as typeof event.contexts;
      }
      if (event.request?.headers) {
        event.request.headers = redactObject(
          event.request.headers,
        ) as typeof event.request.headers;
      }
      return event;
    },
  });

  initialized = true;
  logger.info("Sentry initialized.", {
    environment: input.environment,
    tracesSampleRate: input.tracesSampleRate,
    release: input.release ?? null,
  });
}

export interface CaptureScope {
  tags?: Record<string, string | number | boolean | undefined>;
  extra?: Record<string, unknown>;
}

export function captureError(error: unknown, scope: CaptureScope = {}): void {
  if (!initialized) {
    return;
  }
  Sentry.withScope((sentryScope) => {
    if (scope.tags) {
      for (const [key, value] of Object.entries(scope.tags)) {
        if (value !== undefined) {
          sentryScope.setTag(key, value);
        }
      }
    }
    if (scope.extra) {
      for (const [key, value] of Object.entries(scope.extra)) {
        sentryScope.setExtra(key, value);
      }
    }
    Sentry.captureException(error);
  });
}

export async function withSentrySpan<T>(
  name: string,
  op: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!initialized) {
    return fn();
  }
  return Sentry.startSpan({ name, op }, () => fn());
}

export function setRequestScope(
  fields: Record<string, string | number | boolean | undefined>,
): void {
  if (!initialized) {
    return;
  }
  Sentry.getCurrentScope().setTags(
    Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    ) as Record<string, string | number | boolean>,
  );
}

export function isSentryInitialized(): boolean {
  return initialized;
}

/** Reset internal flag — test-only. */
export function __resetSentryForTests(): void {
  initialized = false;
}
