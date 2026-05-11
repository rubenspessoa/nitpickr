export interface DiscussionAcknowledgmentStore {
  wasAcknowledged(input: {
    repositoryId: string;
    providerCommentId: string;
  }): Promise<boolean>;
  markAcknowledged(input: {
    repositoryId: string;
    providerCommentId: string;
    acknowledgedAt: string;
  }): Promise<void>;
}

export interface PostgresDiscussionAcknowledgmentClient {
  unsafe<T extends Record<string, unknown>>(
    query: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
}

export class PostgresDiscussionAcknowledgmentStore
  implements DiscussionAcknowledgmentStore
{
  readonly #client: PostgresDiscussionAcknowledgmentClient;

  constructor(client: PostgresDiscussionAcknowledgmentClient) {
    this.#client = client;
  }

  async wasAcknowledged(input: {
    repositoryId: string;
    providerCommentId: string;
  }): Promise<boolean> {
    const rows = await this.#client.unsafe<{ exists: boolean }>(
      `
        select true as exists
        from discussion_acknowledgments
        where repository_id = $1
          and provider_comment_id = $2
        limit 1
      `,
      [input.repositoryId, input.providerCommentId],
    );
    return rows.length > 0;
  }

  async markAcknowledged(input: {
    repositoryId: string;
    providerCommentId: string;
    acknowledgedAt: string;
  }): Promise<void> {
    await this.#client.unsafe(
      `
        insert into discussion_acknowledgments (
          repository_id,
          provider_comment_id,
          acknowledged_at
        )
        values ($1, $2, $3)
        on conflict (repository_id, provider_comment_id) do nothing
      `,
      [input.repositoryId, input.providerCommentId, input.acknowledgedAt],
    );
  }
}
