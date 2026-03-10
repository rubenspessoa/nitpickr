import { randomUUID } from "node:crypto";

export interface MemoryEntry {
  id: string;
  tenantId: string;
  repositoryId: string;
  kind: "preferred_pattern" | "false_positive" | "accepted_recommendation";
  summary: string;
  path: string | null;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryStore {
  save(entries: MemoryEntry[]): Promise<void>;
  listByRepository(input: {
    tenantId: string;
    repositoryId: string;
  }): Promise<MemoryEntry[]>;
}

export interface MemoryServiceDependencies {
  now?: () => Date;
  createId?: () => string;
}

function normalizeSummary(body: string): string {
  return body.trim().replace(/\s+/g, " ");
}

function classifyDiscussion(body: string): {
  kind: MemoryEntry["kind"];
  confidence: number;
} | null {
  const normalized = body.toLowerCase();

  if (normalized.includes("false positive")) {
    return {
      kind: "false_positive",
      confidence: 0.95,
    };
  }

  if (normalized.startsWith("prefer ") || normalized.includes(" prefer ")) {
    return {
      kind: "preferred_pattern",
      confidence: 0.85,
    };
  }

  if (
    normalized.includes("accepted recommendation") ||
    normalized.includes("good fix")
  ) {
    return {
      kind: "accepted_recommendation",
      confidence: 0.75,
    };
  }

  return null;
}

export class MemoryService {
  readonly #store: MemoryStore;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(
    store: MemoryStore,
    dependencies: MemoryServiceDependencies = {},
  ) {
    this.#store = store;
    this.#now = dependencies.now ?? (() => new Date());
    this.#createId = dependencies.createId ?? randomUUID;
  }

  async ingestDiscussion(input: {
    tenantId: string;
    repositoryId: string;
    discussions: Array<{
      authorLogin: string;
      body: string;
      path: string | null;
    }>;
  }): Promise<void> {
    const now = this.#now().toISOString();
    const entries = input.discussions
      .map((discussion) => {
        const classification = classifyDiscussion(discussion.body);
        if (!classification) {
          return null;
        }

        return {
          id: this.#createId(),
          tenantId: input.tenantId,
          repositoryId: input.repositoryId,
          kind: classification.kind,
          summary: normalizeSummary(discussion.body),
          path: discussion.path,
          confidence: classification.confidence,
          createdAt: now,
          updatedAt: now,
        } satisfies MemoryEntry;
      })
      .filter((entry): entry is MemoryEntry => entry !== null);

    if (entries.length === 0) {
      return;
    }

    await this.#store.save(entries);
  }

  async getRelevantMemories(input: {
    tenantId: string;
    repositoryId: string;
    paths: string[];
    limit: number;
  }): Promise<MemoryEntry[]> {
    const repositoryEntries = await this.#store.listByRepository({
      tenantId: input.tenantId,
      repositoryId: input.repositoryId,
    });

    return repositoryEntries
      .filter((entry) => {
        if (entry.path === null) {
          return true;
        }

        const pathPrefix = entry.path;
        return input.paths.some((path) => path.startsWith(pathPrefix));
      })
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, input.limit);
  }
}
