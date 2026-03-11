import { z } from "zod";

import type {
  ReviewFeedbackRecord,
  ReviewFeedbackStore,
} from "./review-feedback-service.js";

export interface PostgresReviewFeedbackClient {
  unsafe<T extends Record<string, unknown>>(
    query: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
}

const reviewFeedbackRowSchema = z
  .object({
    id: z.string().min(1),
    tenant_id: z.string().min(1),
    repository_id: z.string().min(1),
    scope_key: z.string().min(1),
    provider_comment_id: z.string().nullable(),
    fingerprint: z.string().nullable(),
    path: z.string().nullable(),
    category: z
      .enum([
        "correctness",
        "performance",
        "security",
        "maintainability",
        "testing",
        "style",
      ])
      .nullable(),
    finding_type: z
      .enum(["bug", "safe_suggestion", "question", "teaching_note"])
      .nullable(),
    kind: z.enum([
      "reaction_positive",
      "reaction_negative",
      "fixed_after_comment",
      "resolved_without_code_change",
      "ignored",
    ]),
    count: z.number().int().nonnegative(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .transform(
    (row): ReviewFeedbackRecord => ({
      id: row.id,
      tenantId: row.tenant_id,
      repositoryId: row.repository_id,
      scopeKey: row.scope_key,
      providerCommentId: row.provider_comment_id,
      fingerprint: row.fingerprint,
      path: row.path,
      category: row.category,
      findingType: row.finding_type,
      kind: row.kind,
      count: row.count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );

export class PostgresReviewFeedbackStore implements ReviewFeedbackStore {
  readonly #client: PostgresReviewFeedbackClient;

  constructor(client: PostgresReviewFeedbackClient) {
    this.#client = client;
  }

  async save(entries: ReviewFeedbackRecord[]): Promise<void> {
    for (const entry of entries) {
      await this.#client.unsafe(
        `
          insert into review_feedback_events (
            id,
            tenant_id,
            repository_id,
            scope_key,
            provider_comment_id,
            fingerprint,
            path,
            category,
            finding_type,
            kind,
            count,
            created_at,
            updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          on conflict (repository_id, scope_key, kind) do update set
            provider_comment_id = excluded.provider_comment_id,
            fingerprint = excluded.fingerprint,
            path = excluded.path,
            category = excluded.category,
            finding_type = excluded.finding_type,
            count = excluded.count,
            updated_at = excluded.updated_at
        `,
        [
          entry.id,
          entry.tenantId,
          entry.repositoryId,
          entry.scopeKey,
          entry.providerCommentId,
          entry.fingerprint,
          entry.path,
          entry.category,
          entry.findingType,
          entry.kind,
          entry.count,
          entry.createdAt,
          entry.updatedAt,
        ],
      );
    }
  }

  async listByRepository(input: {
    tenantId: string;
    repositoryId: string;
  }): Promise<ReviewFeedbackRecord[]> {
    const rows = await this.#client.unsafe<Record<string, unknown>>(
      `
        select *
        from review_feedback_events
        where tenant_id = $1
          and repository_id = $2
        order by updated_at desc, created_at desc
      `,
      [input.tenantId, input.repositoryId],
    );

    return rows.map((row) => reviewFeedbackRowSchema.parse(row));
  }
}
