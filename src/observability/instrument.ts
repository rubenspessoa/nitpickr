// Side-effect-only Sentry preload. Loaded via `node --import ./instrument.js`
// (or `tsx --import ./instrument.ts`) *before* any other module so that
// OpenTelemetry-based auto-instrumentation (HTTP, Postgres, etc.) can patch
// modules at import time. Initializing Sentry inside main() is too late.
//
// Reads configuration directly from process.env so this file has no project
// dependencies and is safe to load before anything else.

import * as Sentry from "@sentry/node";

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

function parseTracesSampleRate(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return 0.1;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  if (parsed > 1) {
    return 1;
  }
  return parsed;
}

const dsn = process.env.SENTRY_DSN;
if (!dsn) {
  // Match the existing "Sentry disabled" affordance. Single stderr line so it
  // shows up in ops logs without depending on the app logger that hasn't loaded
  // yet at this point in the boot.
  process.stderr.write(
    '{"level":"warn","component":"sentry","message":"Sentry disabled — SENTRY_DSN not set."}\n',
  );
} else {
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: parseTracesSampleRate(
      process.env.SENTRY_TRACES_SAMPLE_RATE,
    ),
    sendDefaultPii: true,
    includeLocalVariables: true,
    enableLogs: true,
    integrations: [
      Sentry.httpIntegration(),
      Sentry.postgresIntegration(),
      Sentry.nodeRuntimeMetricsIntegration(),
    ],
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
}
