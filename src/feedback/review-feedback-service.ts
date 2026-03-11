import { randomUUID } from "node:crypto";

import type { ReviewFinding } from "../domain/types.js";
import type { ReviewFeedbackSignal } from "../review/evidence-gate.js";

export type ReviewFeedbackKind =
  | "reaction_positive"
  | "reaction_negative"
  | "fixed_after_comment"
  | "resolved_without_code_change"
  | "ignored";
type ReviewFindingType = ReviewFinding["findingType"];

export interface ReviewFeedbackRecord {
  id: string;
  tenantId: string;
  repositoryId: string;
  scopeKey: string;
  providerCommentId: string | null;
  fingerprint: string | null;
  path: string | null;
  category: ReviewFinding["category"] | null;
  findingType: ReviewFindingType | null;
  kind: ReviewFeedbackKind;
  count: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewFeedbackStore {
  save(entries: ReviewFeedbackRecord[]): Promise<void>;
  listByRepository(input: {
    tenantId: string;
    repositoryId: string;
  }): Promise<ReviewFeedbackRecord[]>;
}

export interface ReviewFeedbackServiceOptions {
  now?: () => Date;
  createId?: () => string;
}

export interface ReviewFeedbackOutcomeEvent {
  fingerprint?: string;
  path?: string;
  category?: ReviewFinding["category"];
  findingType?: ReviewFindingType;
  kind: Exclude<ReviewFeedbackKind, "reaction_positive" | "reaction_negative">;
}

interface AggregatedSignal extends ReviewFeedbackSignal {
  score: number;
}

function normalizeCount(count: number): number {
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }

  return Math.trunc(count);
}

function matchesPath(recordPath: string | null, reviewPath: string): boolean {
  if (!recordPath) {
    return false;
  }

  return reviewPath === recordPath || reviewPath.startsWith(`${recordPath}/`);
}

function throwUnhandledFeedbackKind(value: never): never {
  throw new Error(`Unhandled feedback kind: ${String(value)}`);
}

function scoreForRecord(record: ReviewFeedbackRecord): number {
  switch (record.kind) {
    case "reaction_positive":
      return record.count;
    case "reaction_negative":
      return -record.count;
    case "fixed_after_comment":
      return record.count * 2;
    case "resolved_without_code_change":
      return -Math.max(record.count * 3, 3);
    case "ignored":
      return -Math.max(record.count * 2, 2);
  }

  return throwUnhandledFeedbackKind(record.kind);
}

function buildReactionScopeKey(
  kind: "reaction_positive" | "reaction_negative",
  providerCommentId: string,
): string {
  return `${kind}:${providerCommentId}`;
}

function buildOutcomeScopeKey(
  event: ReviewFeedbackOutcomeEvent,
  fallbackKey: string,
): string {
  if (event.fingerprint) {
    return `${event.kind}:${event.fingerprint}`;
  }

  if (event.path || event.category || event.findingType) {
    return [
      event.kind,
      event.path ?? "_",
      event.category ?? "_",
      event.findingType ?? "_",
    ].join(":");
  }

  return `${event.kind}:${fallbackKey}`;
}

function buildSignalAggregationKey(record: ReviewFeedbackRecord): string {
  if (record.fingerprint) {
    return `fingerprint:${record.fingerprint}`;
  }

  if (record.path || record.category || record.findingType) {
    return [
      "signal",
      record.path ?? "_",
      record.category ?? "_",
      record.findingType ?? "_",
    ].join(":");
  }

  return `scope:${record.scopeKey}:record:${record.id}`;
}

function createAggregatedSignal(
  record: ReviewFeedbackRecord,
): AggregatedSignal {
  const signal: AggregatedSignal = {
    score: 0,
  };

  if (record.fingerprint !== null) {
    signal.fingerprint = record.fingerprint;
  }
  if (record.path !== null) {
    signal.path = record.path;
  }
  if (record.category !== null) {
    signal.category = record.category;
  }
  if (record.findingType !== null) {
    signal.findingType = record.findingType;
  }

  return signal;
}

function compareSignals(
  left: AggregatedSignal,
  right: AggregatedSignal,
): number {
  // Prefer suppressing signals first, then stronger absolute scores,
  // then fall back to a stable identity sort for deterministic output.
  if ((right.suppress ?? false) !== (left.suppress ?? false)) {
    return Number(right.suppress ?? false) - Number(left.suppress ?? false);
  }

  const scoreDifference = Math.abs(right.score) - Math.abs(left.score);
  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  return (left.fingerprint ?? left.path ?? "").localeCompare(
    right.fingerprint ?? right.path ?? "",
  );
}

function isSuppressingRecord(record: ReviewFeedbackRecord): boolean {
  return (
    record.kind === "resolved_without_code_change" || record.kind === "ignored"
  );
}

export class ReviewFeedbackService {
  readonly #store: ReviewFeedbackStore;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(
    store: ReviewFeedbackStore,
    options: ReviewFeedbackServiceOptions = {},
  ) {
    this.#store = store;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
  }

  async syncCommentReactions(input: {
    tenantId: string;
    repositoryId: string;
    comments: Array<{
      providerCommentId: string;
      fingerprint: string;
      path: string;
      category: ReviewFinding["category"];
      findingType?: ReviewFinding["findingType"];
      positiveCount: number;
      negativeCount: number;
    }>;
  }): Promise<void> {
    const timestamp = this.#now().toISOString();
    const entries: ReviewFeedbackRecord[] = [];

    for (const comment of input.comments) {
      entries.push({
        id: this.#createId(),
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        scopeKey: buildReactionScopeKey(
          "reaction_positive",
          comment.providerCommentId,
        ),
        providerCommentId: comment.providerCommentId,
        fingerprint: comment.fingerprint,
        path: comment.path,
        category: comment.category,
        findingType: comment.findingType ?? null,
        kind: "reaction_positive",
        count: normalizeCount(comment.positiveCount),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      entries.push({
        id: this.#createId(),
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        scopeKey: buildReactionScopeKey(
          "reaction_negative",
          comment.providerCommentId,
        ),
        providerCommentId: comment.providerCommentId,
        fingerprint: comment.fingerprint,
        path: comment.path,
        category: comment.category,
        findingType: comment.findingType ?? null,
        kind: "reaction_negative",
        count: normalizeCount(comment.negativeCount),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    if (entries.length === 0) {
      return;
    }

    await this.#store.save(entries);
  }

  async recordOutcome(input: {
    tenantId: string;
    repositoryId: string;
    events: ReviewFeedbackOutcomeEvent[];
  }): Promise<void> {
    const timestamp = this.#now().toISOString();
    const entries = input.events.map(
      (event): ReviewFeedbackRecord => ({
        id: this.#createId(),
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        scopeKey: buildOutcomeScopeKey(event, this.#createId()),
        providerCommentId: null,
        fingerprint: event.fingerprint ?? null,
        path: event.path ?? null,
        category: event.category ?? null,
        findingType: event.findingType ?? null,
        kind: event.kind,
        count: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    if (entries.length === 0) {
      return;
    }

    await this.#store.save(entries);
  }

  async getSignals(input: {
    tenantId: string;
    repositoryId: string;
    paths: string[];
    limit: number;
  }): Promise<ReviewFeedbackSignal[]> {
    const records = await this.#store.listByRepository({
      tenantId: input.tenantId,
      repositoryId: input.repositoryId,
    });

    const aggregated = new Map<string, AggregatedSignal>();
    for (const record of records) {
      if (!input.paths.some((path) => matchesPath(record.path, path))) {
        continue;
      }

      const key = buildSignalAggregationKey(record);
      const current = aggregated.get(key) ?? createAggregatedSignal(record);

      current.score += scoreForRecord(record);
      if (isSuppressingRecord(record)) {
        current.suppress = true;
      }

      aggregated.set(key, current);
    }

    return [...aggregated.values()]
      .filter((signal) => (signal.suppress ?? false) || signal.score !== 0)
      .sort(compareSignals)
      .slice(0, input.limit);
  }
}
