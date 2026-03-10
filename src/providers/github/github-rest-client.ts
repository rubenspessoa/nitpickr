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
