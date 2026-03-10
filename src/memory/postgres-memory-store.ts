import { z } from "zod";

import type { MemoryEntry, MemoryStore } from "./memory-service.js";

export interface PostgresMemoryClient {
  unsafe<T extends Record<string, unknown>>(
    query: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
}

const memoryRowSchema = z
  .object({
    id: z.string().min(1),
    tenant_id: z.string().min(1),
    repository_id: z.string().min(1),
    kind: z.enum([
      "preferred_pattern",
      "false_positive",
      "accepted_recommendation",
    ]),
    summary: z.string().min(1),
    path: z.string().nullable(),
    confidence: z.number(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .transform(
    (row): MemoryEntry => ({
      id: row.id,
      tenantId: row.tenant_id,
      repositoryId: row.repository_id,
      kind: row.kind,
      summary: row.summary,
      path: row.path,
      confidence: row.confidence,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );

export class PostgresMemoryStore implements MemoryStore {
  readonly #client: PostgresMemoryClient;

  constructor(client: PostgresMemoryClient) {
    this.#client = client;
  }

  async save(entries: MemoryEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.#client.unsafe(
        `
          insert into memories (
            id,
            tenant_id,
            repository_id,
            kind,
            summary,
            path,
            confidence,
            created_at,
            updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          on conflict (id) do update set
            kind = excluded.kind,
            summary = excluded.summary,
            path = excluded.path,
            confidence = excluded.confidence,
            updated_at = excluded.updated_at
        `,
        [
          entry.id,
          entry.tenantId,
          entry.repositoryId,
          entry.kind,
          entry.summary,
          entry.path,
          entry.confidence,
          entry.createdAt,
          entry.updatedAt,
        ],
      );
    }
  }

  async listByRepository(input: {
    tenantId: string;
    repositoryId: string;
  }): Promise<MemoryEntry[]> {
    const rows = await this.#client.unsafe<Record<string, unknown>>(
      `
        select *
        from memories
        where tenant_id = $1
          and repository_id = $2
        order by confidence desc, updated_at desc
      `,
      [input.tenantId, input.repositoryId],
    );

    return rows.map((row) => memoryRowSchema.parse(row));
  }
}
