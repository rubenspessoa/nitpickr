import { randomUUID } from "node:crypto";

import type { Logger } from "./logger.js";

export function generateCorrelationId(): string {
  return randomUUID();
}

type ActionFields = Record<string, unknown>;

function durationMsSince(start: bigint): number {
  return Number((process.hrtime.bigint() - start) / 1_000_000n);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run `fn` and emit three structured log lines for the action:
 *  - `${action} started` at debug
 *  - `${action} succeeded` at info with `durationMs`
 *  - `${action} failed` at error with `durationMs` + `errorMessage` (then re-throws)
 *
 * Returns whatever `fn` resolves with. `fields` are merged into all three
 * log lines so per-call context (e.g. `pullNumber`, `repositoryId`) travels
 * with the action.
 */
export async function withTiming<T>(
  logger: Logger,
  action: string,
  fn: () => Promise<T>,
  fields: ActionFields = {},
): Promise<T> {
  const startedAt = process.hrtime.bigint();
  logger.debug(`${action} started`, { action, ...fields });
  try {
    const result = await fn();
    logger.info(`${action} succeeded`, {
      action,
      durationMs: durationMsSince(startedAt),
      ...fields,
    });
    return result;
  } catch (error) {
    logger.error(`${action} failed`, {
      action,
      durationMs: durationMsSince(startedAt),
      errorMessage: errorMessage(error),
      ...fields,
    });
    throw error;
  }
}
