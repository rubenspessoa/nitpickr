import { z } from "zod";

import type { MemoryEntry, MemoryKind, MemoryStore } from "./memory-service.js";

export interface PostgresMemoryClient {
  unsafe<T extends Record<string, unknown>>(
    query: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
}

const memoryKindSchema = z.enum([
  "preferred_pattern",
  "false_positive",
  "accepted_recommendation",
  "coding_convention",
  "domain_fact",
  "dismissed_finding",
]);

const memoryRowSchema = z
  .object({
    id: z.string().min(1),
    tenant_id: z.string().min(1),
    repository_id: z.string().min(1),
    kind: memoryKindSchema,
    summary: z.string().min(1),
    path: z.string().nullable(),
    tags: z.array(z.string()).nullable().optional(),
    globs: z.array(z.string()).nullable().optional(),
    confidence: z.number(),
    usage_count: z.number().nullable().optional(),
    last_used_at: z.string().nullable().optional(),
    embedding: z.unknown().optional(),
    superseded_by: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .transform((row): MemoryEntry => {
    const rawEmbedding = parseEmbedding(row.embedding);
    return {
      id: row.id,
      tenantId: row.tenant_id,
      repositoryId: row.repository_id,
      kind: row.kind,
      summary: row.summary,
      path: row.path,
      tags: row.tags ?? [],
      globs: row.globs ?? [],
      confidence: row.confidence,
      usageCount: row.usage_count ?? 0,
      lastUsedAt: row.last_used_at ?? null,
      embedding: rawEmbedding,
      supersededBy: row.superseded_by ?? null,
      source: row.source ?? "discussion",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((v) => typeof v === "number")) {
    return value as number[];
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      trimmed.length === 0 ||
      !(trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (
        Array.isArray(parsed) &&
        parsed.every((v: unknown) => typeof v === "number")
      ) {
        return parsed as number[];
      }
    } catch {
      return null;
    }
  }
  return null;
}

function serializeEmbedding(embedding: number[] | null): string | null {
  if (embedding === null || embedding.length === 0) {
    return null;
  }
  return `[${embedding.join(",")}]`;
}

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
            tags,
            globs,
            confidence,
            usage_count,
            last_used_at,
            embedding,
            superseded_by,
            source,
            created_at,
            updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::vector, $13, $14, $15, $16)
          on conflict (id) do update set
            kind = excluded.kind,
            summary = excluded.summary,
            path = excluded.path,
            tags = excluded.tags,
            globs = excluded.globs,
            confidence = excluded.confidence,
            usage_count = excluded.usage_count,
            last_used_at = excluded.last_used_at,
            embedding = excluded.embedding,
            superseded_by = excluded.superseded_by,
            source = excluded.source,
            updated_at = excluded.updated_at
        `,
        [
          entry.id,
          entry.tenantId,
          entry.repositoryId,
          entry.kind,
          entry.summary,
          entry.path,
          entry.tags,
          entry.globs,
          entry.confidence,
          entry.usageCount,
          entry.lastUsedAt,
          serializeEmbedding(entry.embedding),
          entry.supersededBy,
          entry.source,
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

  async findNearestNeighbors(input: {
    tenantId: string;
    repositoryId: string;
    embedding: number[];
    kind?: MemoryKind;
    limit: number;
  }): Promise<Array<{ entry: MemoryEntry; similarity: number }>> {
    const params: unknown[] = [
      input.tenantId,
      input.repositoryId,
      serializeEmbedding(input.embedding),
      input.limit,
    ];
    let kindFilter = "";
    if (input.kind) {
      kindFilter = "and kind = $5";
      params.push(input.kind);
    }
    const rows = await this.#client.unsafe<Record<string, unknown>>(
      `
        select *,
          1 - (embedding <=> $3::vector) as similarity
        from memories
        where tenant_id = $1
          and repository_id = $2
          and superseded_by is null
          and embedding is not null
          ${kindFilter}
        order by embedding <=> $3::vector asc
        limit $4
      `,
      params,
    );
    return rows.map((row) => {
      const similarity =
        typeof row.similarity === "number"
          ? row.similarity
          : Number.parseFloat(String(row.similarity ?? "0"));
      return {
        entry: memoryRowSchema.parse(row),
        similarity: Number.isFinite(similarity) ? similarity : 0,
      };
    });
  }

  async markSuperseded(input: {
    supersededId: string;
    supersededBy: string;
    updatedAt: string;
  }): Promise<void> {
    await this.#client.unsafe(
      `
        update memories
        set superseded_by = $2,
            updated_at = $3
        where id = $1
      `,
      [input.supersededId, input.supersededBy, input.updatedAt],
    );
  }

  async markUsage(input: {
    ids: string[];
    lastUsedAt: string;
  }): Promise<void> {
    if (input.ids.length === 0) {
      return;
    }
    await this.#client.unsafe(
      `
        update memories
        set usage_count = usage_count + 1,
            last_used_at = $2
        where id = any($1::text[])
      `,
      [input.ids, input.lastUsedAt],
    );
  }

  async findActiveById(input: {
    tenantId: string;
    repositoryId: string;
    id: string;
  }): Promise<MemoryEntry | null> {
    const rows = await this.#client.unsafe<Record<string, unknown>>(
      `
        select *
        from memories
        where tenant_id = $1
          and repository_id = $2
          and id = $3
          and superseded_by is null
        limit 1
      `,
      [input.tenantId, input.repositoryId, input.id],
    );
    if (rows.length === 0) {
      return null;
    }
    const first = rows[0];
    if (!first) {
      return null;
    }
    return memoryRowSchema.parse(first);
  }
}
