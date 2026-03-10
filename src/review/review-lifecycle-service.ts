import { randomUUID } from "node:crypto";

import type {
  ChangeRequest,
  ReviewFinding,
  ReviewRun,
  ReviewTrigger,
} from "../domain/types.js";
import type { ReviewEngineResult } from "./review-engine.js";

export type ReviewRunBudgets = ReviewRun["budgets"];

export interface DiscussionSnapshotEntry {
  authorLogin: string;
  body: string;
  path: string | null;
  line: number | null;
  providerCreatedAt: string;
}

export interface PersistedReviewRun extends ReviewRun {
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface PersistedReviewFinding extends ReviewFinding {
  createdAt: string;
}

export interface PersistedPublishedComment {
  id: string;
  reviewRunId: string;
  publishedReviewId: string;
  path: string;
  line: number;
  body: string;
  createdAt: string;
}

export interface PersistedDiscussionEvent {
  id: string;
  tenantId: string;
  repositoryId: string;
  changeRequestId: string;
  authorLogin: string;
  body: string;
  path: string | null;
  line: number | null;
  source: "review_snapshot";
  providerCreatedAt: string;
  createdAt: string;
}

export interface ReviewLifecycleStore {
  upsertChangeRequest(changeRequest: ChangeRequest): Promise<void>;
  createReviewRun(reviewRun: PersistedReviewRun): Promise<void>;
  supersedePreviousRuns(input: {
    changeRequestId: string;
    reviewRunId: string;
    completedAt: string;
  }): Promise<number>;
  completeReviewRun(input: {
    reviewRunId: string;
    status: "published" | "skipped";
    publishedReviewId: string;
    summary: string;
    mermaid: string;
    findings: PersistedReviewFinding[];
    publishedComments: PersistedPublishedComment[];
    completedAt: string;
  }): Promise<void>;
  failReviewRun(input: {
    reviewRunId: string;
    errorMessage: string;
    completedAt: string;
  }): Promise<void>;
  saveDiscussionEvents(events: PersistedDiscussionEvent[]): Promise<void>;
}

export interface ReviewLifecycleServiceOptions {
  now?: () => Date;
  createId?: () => string;
}

export class ReviewLifecycleService {
  readonly #store: ReviewLifecycleStore;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(
    store: ReviewLifecycleStore,
    options: ReviewLifecycleServiceOptions = {},
  ) {
    this.#store = store;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
  }

  async startReview(input: {
    tenantId: string;
    repositoryId: string;
    changeRequest: ChangeRequest;
    trigger: ReviewTrigger;
    mode: ReviewRun["mode"];
    budgets: ReviewRunBudgets;
    discussionSnapshot: DiscussionSnapshotEntry[];
  }): Promise<string> {
    const timestamp = this.#now().toISOString();
    const reviewRunId = this.#createId();

    await this.#store.upsertChangeRequest(input.changeRequest);
    await this.#store.createReviewRun({
      id: reviewRunId,
      tenantId: input.tenantId,
      repositoryId: input.repositoryId,
      changeRequestId: input.changeRequest.id,
      trigger: input.trigger,
      mode: input.mode,
      headSha: input.changeRequest.headSha,
      status: "running",
      budgets: input.budgets,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    });

    await this.#store.supersedePreviousRuns({
      changeRequestId: input.changeRequest.id,
      reviewRunId,
      completedAt: timestamp,
    });

    if (input.discussionSnapshot.length > 0) {
      await this.#store.saveDiscussionEvents(
        input.discussionSnapshot.map((discussion) => ({
          id: this.#createId(),
          tenantId: input.tenantId,
          repositoryId: input.repositoryId,
          changeRequestId: input.changeRequest.id,
          authorLogin: discussion.authorLogin,
          body: discussion.body,
          path: discussion.path,
          line: discussion.line,
          source: "review_snapshot",
          providerCreatedAt: discussion.providerCreatedAt,
          createdAt: timestamp,
        })),
      );
    }

    return reviewRunId;
  }

  async completeReview(input: {
    reviewRunId: string;
    repositoryId: string;
    status: "published" | "skipped";
    publishedReviewId: string;
    result: ReviewEngineResult;
    publishedComments: Array<{
      path: string;
      line: number;
      body: string;
    }>;
  }): Promise<void> {
    const completedAt = this.#now().toISOString();

    await this.#store.completeReviewRun({
      reviewRunId: input.reviewRunId,
      status: input.status,
      publishedReviewId: input.publishedReviewId,
      summary: input.result.summary,
      mermaid: input.result.mermaid,
      findings: input.result.findings.map((finding) => ({
        id: this.#createId(),
        reviewRunId: input.reviewRunId,
        repositoryId: input.repositoryId,
        path: finding.path,
        line: finding.line,
        severity: finding.severity,
        category: finding.category,
        title: finding.title,
        body: finding.body,
        fixPrompt: finding.fixPrompt,
        suggestedChange: finding.suggestedChange,
        createdAt: completedAt,
      })),
      publishedComments: input.publishedComments.map((comment) => ({
        id: this.#createId(),
        reviewRunId: input.reviewRunId,
        publishedReviewId: input.publishedReviewId,
        path: comment.path,
        line: comment.line,
        body: comment.body,
        createdAt: completedAt,
      })),
      completedAt,
    });
  }

  async failReview(input: {
    reviewRunId: string;
    errorMessage: string;
  }): Promise<void> {
    await this.#store.failReviewRun({
      reviewRunId: input.reviewRunId,
      errorMessage: input.errorMessage,
      completedAt: this.#now().toISOString(),
    });
  }
}
