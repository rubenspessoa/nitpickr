import { randomUUID } from "node:crypto";

import type { ReviewFinding } from "../domain/types.js";
import type { ReviewFeedbackSignal } from "../review/evidence-gate.js";

export type ReviewFeedbackKind =
  | "reaction_positive"
  | "reaction_negative"
  | "fixed_after_comment"
  | "resolved_without_code_change"
  | "ignored";

export interface ReviewFeedbackRecord {
  id: string;
  tenantId: string;
  repositoryId: string;
  scopeKey: string;
  providerCommentId: string | null;
  fingerprint: string | null;
  path: string | null;
  category: ReviewFinding["category"] | null;
  findingType: ReviewFinding["findingType"] | null;
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
  findingType?: ReviewFinding["findingType"];
  kind: Exclude<ReviewFeedbackKind, "reaction_positive" | "reaction_negative">;
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
        scopeKey: comment.providerCommentId,
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
        scopeKey: comment.providerCommentId,
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
        scopeKey:
          event.fingerprint !== undefined
            ? `${event.kind}:${event.fingerprint}`
            : `${event.kind}:${event.path ?? this.#createId()}`,
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

    const aggregated = new Map<string, ReviewFeedbackSignal>();
    for (const record of records) {
      if (!input.paths.some((path) => matchesPath(record.path, path))) {
        continue;
      }

      const key =
        record.fingerprint ??
        [
          record.path ?? "",
          record.category ?? "",
          record.findingType ?? "",
        ].join(":");
      const current = aggregated.get(key) ?? {
        ...(record.fingerprint === null
          ? {}
          : { fingerprint: record.fingerprint }),
        ...(record.path === null ? {} : { path: record.path }),
        ...(record.category === null ? {} : { category: record.category }),
        ...(record.findingType === null
          ? {}
          : { findingType: record.findingType }),
        score: 0,
      };

      current.score += scoreForRecord(record);
      if (isSuppressingRecord(record)) {
        current.suppress = true;
      }

      aggregated.set(key, current);
    }

    return [...aggregated.values()]
      .filter((signal) => (signal.suppress ?? false) || signal.score !== 0)
      .sort((left, right) => {
        if ((right.suppress ?? false) !== (left.suppress ?? false)) {
          return (
            Number(right.suppress ?? false) - Number(left.suppress ?? false)
          );
        }

        const scoreDifference = Math.abs(right.score) - Math.abs(left.score);
        if (scoreDifference !== 0) {
          return scoreDifference;
        }

        return (left.fingerprint ?? left.path ?? "").localeCompare(
          right.fingerprint ?? right.path ?? "",
        );
      })
      .slice(0, input.limit);
  }
}
