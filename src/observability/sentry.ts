// Helper façade around @sentry/node. The SDK itself is initialized in
// src/observability/instrument.ts (loaded via --import). These helpers are
// always safe to call: when Sentry isn't initialized (no DSN), they short-
// circuit via Sentry.getClient() and become no-ops.

import * as Sentry from "@sentry/node";

export interface CaptureScope {
  tags?: Record<string, string | number | boolean | undefined>;
  extra?: Record<string, unknown>;
}

export function isSentryInitialized(): boolean {
  return Sentry.getClient() !== undefined;
}

export function captureError(error: unknown, scope: CaptureScope = {}): void {
  if (!isSentryInitialized()) {
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
  if (!isSentryInitialized()) {
    return fn();
  }
  return Sentry.startSpan({ name, op }, () => fn());
}

export function setRequestScope(
  fields: Record<string, string | number | boolean | undefined>,
): void {
  if (!isSentryInitialized()) {
    return;
  }
  Sentry.getCurrentScope().setTags(
    Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    ) as Record<string, string | number | boolean>,
  );
}
