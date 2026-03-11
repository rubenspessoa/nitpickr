export type FetchLike = typeof fetch;

export interface InstallationTokenProvider {
  getInstallationAccessToken(installationId: string): Promise<string>;
}

interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  user: {
    login: string;
  };
  base: {
    sha: string;
    ref: string;
  };
  head: {
    sha: string;
    ref: string;
  };
}

function extractFingerprintMarker(body: string): string | null {
  const match = /<!--\s*nitpickr:fingerprint:([a-z0-9:_-]+)\s*-->/i.exec(body);
  return match?.[1] ?? null;
}

export interface GitHubRestClientOptions {
  baseUrl?: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export class GitHubRestClient {
  readonly #tokenProvider: InstallationTokenProvider;
  readonly #fetch: FetchLike;
  readonly #baseUrl: string;

  constructor(
    tokenProvider: InstallationTokenProvider,
    fetchFn: FetchLike = fetch,
    options: GitHubRestClientOptions = {},
  ) {
    this.#tokenProvider = tokenProvider;
    this.#fetch = fetchFn;
    this.#baseUrl = normalizeBaseUrl(
      options.baseUrl ?? "https://api.github.com",
    );
  }

  async getPullRequest(input: {
    installationId: string;
    owner: string;
    repo: string;
    pullNumber: number;
  }): Promise<GitHubPullRequest> {
    return this.#requestJson(
      input.installationId,
      `/repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}`,
    ) as Promise<GitHubPullRequest>;
  }

  async listPullRequestFiles(input: {
    installationId: string;
    owner: string;
    repo: string;
    pullNumber: number;
  }): Promise<
    Array<{
      filename: string;
      status: "added" | "modified" | "removed" | "renamed";
      additions: number;
      deletions: number;
      patch?: string;
      previous_filename?: string;
    }>
  > {
    return this.#requestJson(
      input.installationId,
      `/repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}/files`,
    ) as Promise<
      Array<{
        filename: string;
        status: "added" | "modified" | "removed" | "renamed";
        additions: number;
        deletions: number;
        patch?: string;
        previous_filename?: string;
      }>
    >;
  }

  async listIssueComments(input: {
    installationId: string;
    owner: string;
    repo: string;
    issueNumber: number;
  }): Promise<
    Array<{
      id: number;
      body: string;
      user: {
        login: string;
      };
      created_at: string;
    }>
  > {
    return this.#requestJson(
      input.installationId,
      `/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}/comments`,
    ) as Promise<
      Array<{
        id: number;
        body: string;
        user: {
          login: string;
        };
        created_at: string;
      }>
    >;
  }

  async comparePullRequestRange(input: {
    installationId: string;
    owner: string;
    repo: string;
    baseSha: string;
    headSha: string;
  }): Promise<
    Array<{
      filename: string;
      status: "added" | "modified" | "removed" | "renamed";
      additions: number;
      deletions: number;
      patch?: string;
      previous_filename?: string;
    }>
  > {
    const payload = (await this.#requestJson(
      input.installationId,
      `/repos/${input.owner}/${input.repo}/compare/${input.baseSha}...${input.headSha}`,
    )) as {
      files?: Array<{
        filename: string;
        status: "added" | "modified" | "removed" | "renamed";
        additions: number;
        deletions: number;
        patch?: string;
        previous_filename?: string;
      }>;
    };

    return payload.files ?? [];
  }

  async listPullRequestReviews(input: {
    installationId: string;
    owner: string;
    repo: string;
    pullNumber: number;
  }): Promise<
    Array<{
      id: number;
      body: string | null;
      state: string;
    }>
  > {
    return this.#requestJson(
      input.installationId,
      `/repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}/reviews`,
    ) as Promise<
      Array<{
        id: number;
        body: string | null;
        state: string;
      }>
    >;
  }

  async listReviewComments(input: {
    installationId: string;
    owner: string;
    repo: string;
    pullNumber: number;
  }): Promise<
    Array<{
      id: number;
      body: string;
      user: {
        login: string;
      };
      path?: string;
      line?: number;
      created_at: string;
    }>
  > {
    return this.#requestJson(
      input.installationId,
      `/repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}/comments`,
    ) as Promise<
      Array<{
        id: number;
        body: string;
        user: {
          login: string;
        };
        path?: string;
        line?: number;
        created_at: string;
      }>
    >;
  }

  async readTextFile(input: {
    installationId: string;
    owner: string;
    repo: string;
    path: string;
    ref: string;
  }): Promise<string | null> {
    const response = await this.#request(
      input.installationId,
      `/repos/${input.owner}/${input.repo}/contents/${input.path}?ref=${input.ref}`,
    );

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `GitHub file read failed with status ${response.status}: ${details}`,
      );
    }

    const payload = (await response.json()) as {
      content?: string;
      encoding?: string;
      type?: string;
    };
    if (
      payload.type !== "file" ||
      payload.encoding !== "base64" ||
      !payload.content
    ) {
      return null;
    }

    return Buffer.from(payload.content, "base64").toString("utf8");
  }

  async listFiles(input: {
    installationId: string;
    owner: string;
    repo: string;
    path: string;
    ref: string;
  }): Promise<string[]> {
    const response = await this.#request(
      input.installationId,
      `/repos/${input.owner}/${input.repo}/contents/${input.path}?ref=${input.ref}`,
    );

    if (response.status === 404) {
      return [];
    }
    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `GitHub request failed with status ${response.status}: ${details}`,
      );
    }

    const payload = (await response.json()) as Array<{
      type?: string;
      path?: string;
    }>;

    return payload
      .filter(
        (entry) => entry.type === "file" && typeof entry.path === "string",
      )
      .map((entry) => entry.path as string);
  }

  async createIssueCommentReaction(input: {
    installationId: string;
    owner: string;
    repo: string;
    commentId: number;
    content: "eyes";
  }): Promise<void> {
    const response = await this.#request(
      input.installationId,
      `/repos/${input.owner}/${input.repo}/issues/comments/${input.commentId}/reactions`,
      {
        method: "POST",
        body: JSON.stringify({
          content: input.content,
        }),
      },
    );

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `GitHub request failed with status ${response.status}: ${details}`,
      );
    }
  }

  async createIssueComment(input: {
    installationId: string;
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
  }): Promise<void> {
    const response = await this.#request(
      input.installationId,
      `/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}/comments`,
      {
        method: "POST",
        body: JSON.stringify({
          body: input.body,
        }),
      },
    );

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `GitHub request failed with status ${response.status}: ${details}`,
      );
    }
  }

  async createCommitStatus(input: {
    installationId: string;
    owner: string;
    repo: string;
    sha: string;
    state: "pending" | "success" | "failure" | "error";
    description: string;
    targetUrl?: string;
    context: string;
  }): Promise<void> {
    const response = await this.#request(
      input.installationId,
      `/repos/${input.owner}/${input.repo}/statuses/${input.sha}`,
      {
        method: "POST",
        body: JSON.stringify({
          state: input.state,
          description: input.description,
          ...(input.targetUrl ? { target_url: input.targetUrl } : {}),
          context: input.context,
        }),
      },
    );

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `GitHub request failed with status ${response.status}: ${details}`,
      );
    }
  }

  async createCheckRun(input: {
    installationId: string;
    owner: string;
    repo: string;
    sha: string;
    name: string;
    externalId: string;
    status: "in_progress" | "completed";
    conclusion?: "success" | "neutral" | "failure";
    title: string;
    summary: string;
  }): Promise<{ checkRunId: string }> {
    const payload = (await this.#requestJson(
      input.installationId,
      `/repos/${input.owner}/${input.repo}/check-runs`,
      {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          head_sha: input.sha,
          external_id: input.externalId,
          status: input.status,
          ...(input.conclusion ? { conclusion: input.conclusion } : {}),
          output: {
            title: input.title,
            summary: input.summary,
          },
        }),
      },
    )) as { id: number };

    return {
      checkRunId: String(payload.id),
    };
  }

  async updateCheckRun(input: {
    installationId: string;
    owner: string;
    repo: string;
    checkRunId: string;
    status: "in_progress" | "completed";
    conclusion?: "success" | "neutral" | "failure";
    title: string;
    summary: string;
  }): Promise<void> {
    const response = await this.#request(
      input.installationId,
      `/repos/${input.owner}/${input.repo}/check-runs/${input.checkRunId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: input.status,
          ...(input.conclusion ? { conclusion: input.conclusion } : {}),
          output: {
            title: input.title,
            summary: input.summary,
          },
        }),
      },
    );

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `GitHub request failed with status ${response.status}: ${details}`,
      );
    }
  }

  async listNitpickrReviewThreads(input: {
    installationId: string;
    owner: string;
    repo: string;
    pullNumber: number;
    botLogins: string[];
  }): Promise<
    Array<{
      threadId: string;
      providerCommentId: string;
      path: string;
      line: number;
      fingerprint: string;
      isResolved: boolean;
      body: string;
      reactionSummary: {
        positiveCount: number;
        negativeCount: number;
      };
    }>
  > {
    const payload = (await this.#requestGraphQL(
      input.installationId,
      `
        query NitpickrReviewThreads($owner: String!, $repo: String!, $pullNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $pullNumber) {
              reviewThreads(first: 100) {
                nodes {
                  id
                  isResolved
                  comments(first: 20) {
                    nodes {
                      id
                      databaseId
                      body
                      path
                      line
                      reactionGroups {
                        content
                        users {
                          totalCount
                        }
                      }
                      author {
                        login
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      {
        owner: input.owner,
        repo: input.repo,
        pullNumber: input.pullNumber,
      },
    )) as {
      repository?: {
        pullRequest?: {
          reviewThreads?: {
            nodes?: Array<{
              id?: string;
              isResolved?: boolean;
              comments?: {
                nodes?: Array<{
                  id?: string;
                  databaseId?: number;
                  body?: string;
                  path?: string;
                  line?: number;
                  reactionGroups?: Array<{
                    content?: string;
                    users?: {
                      totalCount?: number;
                    };
                  }>;
                  author?: {
                    login?: string;
                  };
                }>;
              };
            }>;
          };
        };
      };
    };

    const threads = payload.repository?.pullRequest?.reviewThreads?.nodes ?? [];

    return threads.flatMap((thread) => {
      if (!thread.id) {
        return [];
      }

      const matchingComment =
        thread.comments?.nodes?.find((comment) => {
          const authorLogin = comment.author?.login?.toLowerCase();
          if (!authorLogin || !comment.body || !comment.path || !comment.line) {
            return false;
          }

          return (
            input.botLogins.some(
              (botLogin) => botLogin.toLowerCase() === authorLogin,
            ) && extractFingerprintMarker(comment.body) !== null
          );
        }) ?? null;

      if (!matchingComment?.path || !matchingComment.line) {
        return [];
      }

      const commentBody = matchingComment.body ?? null;
      if (commentBody === null) {
        return [];
      }

      const fingerprint = extractFingerprintMarker(commentBody);
      if (!fingerprint) {
        return [];
      }

      return [
        {
          threadId: thread.id,
          providerCommentId: String(
            matchingComment.databaseId ?? matchingComment.id,
          ),
          path: matchingComment.path,
          line: matchingComment.line,
          fingerprint,
          isResolved: thread.isResolved ?? false,
          body: commentBody,
          reactionSummary: (matchingComment.reactionGroups ?? []).reduce(
            (summary, group) => {
              const count = group.users?.totalCount ?? 0;

              switch (group.content) {
                case "THUMBS_UP":
                case "HEART":
                case "ROCKET":
                  summary.positiveCount += count;
                  break;
                case "THUMBS_DOWN":
                case "CONFUSED":
                  summary.negativeCount += count;
                  break;
              }

              return summary;
            },
            {
              positiveCount: 0,
              negativeCount: 0,
            },
          ),
        },
      ];
    });
  }

  async replyToReviewComment(input: {
    installationId: string;
    owner: string;
    repo: string;
    pullNumber: number;
    commentId: number;
    body: string;
  }): Promise<void> {
    const response = await this.#request(
      input.installationId,
      `/repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}/comments`,
      {
        method: "POST",
        body: JSON.stringify({
          body: input.body,
          in_reply_to: input.commentId,
        }),
      },
    );

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `GitHub request failed with status ${response.status}: ${details}`,
      );
    }
  }

  async resolveReviewThread(input: {
    installationId: string;
    threadId: string;
  }): Promise<void> {
    await this.#requestGraphQL(
      input.installationId,
      `
        mutation ResolveNitpickrReviewThread($threadId: ID!) {
          resolveReviewThread(input: { threadId: $threadId }) {
            thread {
              id
              isResolved
            }
          }
        }
      `,
      {
        threadId: input.threadId,
      },
    );
  }

  async publishPullRequestReview(input: {
    installationId: string;
    owner: string;
    repo: string;
    pullNumber: number;
    body: string;
    comments: Array<{
      path: string;
      line: number;
      side: "RIGHT";
      body: string;
    }>;
  }): Promise<{ reviewId: string }> {
    const payload = (await this.#requestJson(
      input.installationId,
      `/repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}/reviews`,
      {
        method: "POST",
        body: JSON.stringify({
          event: "COMMENT",
          body: input.body,
          comments: input.comments,
        }),
      },
    )) as { id: number };

    return {
      reviewId: String(payload.id),
    };
  }

  async #requestJson(
    installationId: string,
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const response = await this.#request(installationId, path, init);
    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `GitHub request failed with status ${response.status}: ${details}`,
      );
    }

    return response.json();
  }

  async #requestGraphQL(
    installationId: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await this.#request(installationId, "/graphql", {
      method: "POST",
      body: JSON.stringify({
        query,
        variables,
      }),
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `GitHub request failed with status ${response.status}: ${details}`,
      );
    }

    const payload = (await response.json()) as {
      data?: unknown;
      errors?: Array<{
        message?: string;
      }>;
    };
    if (payload.errors && payload.errors.length > 0) {
      throw new Error(
        `GitHub GraphQL request failed: ${payload.errors
          .map((error) => error.message ?? "Unknown GraphQL error.")
          .join("; ")}`,
      );
    }

    return payload.data ?? {};
  }

  async #request(
    installationId: string,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const token =
      await this.#tokenProvider.getInstallationAccessToken(installationId);

    return this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        ...init.headers,
      },
    });
  }
}
