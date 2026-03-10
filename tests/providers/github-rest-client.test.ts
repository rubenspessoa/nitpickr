import { describe, expect, it } from "vitest";

import { GitHubRestClient } from "../../src/providers/github/github-rest-client.js";

describe("GitHubRestClient", () => {
  it("fetches a pull request", async () => {
    const client = new GitHubRestClient(
      {
        async getInstallationAccessToken() {
          return "ghs_token";
        },
      },
      async () =>
        new Response(
          JSON.stringify({
            id: 101,
            number: 42,
            title: "Improve queue fairness",
            state: "open",
            draft: false,
            user: { login: "ruben" },
            base: {
              sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              ref: "main",
            },
            head: {
              sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              ref: "feature",
            },
          }),
          { status: 200 },
        ),
    );

    const pullRequest = (await client.getPullRequest({
      installationId: "123456",
      owner: "rubenspessoa",
      repo: "nitpickr",
      pullNumber: 42,
    })) as { number: number };

    expect(pullRequest.number).toBe(42);
  });

  it("lists pull request files", async () => {
    const client = new GitHubRestClient(
      {
        async getInstallationAccessToken() {
          return "ghs_token";
        },
      },
      async () =>
        new Response(
          JSON.stringify([
            {
              filename: "src/queue/queue-scheduler.ts",
              status: "modified",
              additions: 4,
              deletions: 1,
              patch: "@@ -1 +1 @@\n+stable ordering",
            },
          ]),
          { status: 200 },
        ),
    );

    const files = (await client.listPullRequestFiles({
      installationId: "123456",
      owner: "rubenspessoa",
      repo: "nitpickr",
      pullNumber: 42,
    })) as Array<{ filename: string }>;

    expect(files[0]?.filename).toBe("src/queue/queue-scheduler.ts");
  });

  it("reads repository file contents", async () => {
    const client = new GitHubRestClient(
      {
        async getInstallationAccessToken() {
          return "ghs_token";
        },
      },
      async () =>
        new Response(
          JSON.stringify({
            type: "file",
            content: Buffer.from("review: {}\n", "utf8").toString("base64"),
            encoding: "base64",
          }),
          { status: 200 },
        ),
    );

    const contents = await client.readTextFile({
      installationId: "123456",
      owner: "rubenspessoa",
      repo: "nitpickr",
      path: ".nitpickr.yml",
      ref: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    expect(contents).toContain("review:");
  });

  it("lists files in a repository directory", async () => {
    const client = new GitHubRestClient(
      {
        async getInstallationAccessToken() {
          return "ghs_token";
        },
      },
      async () =>
        new Response(
          JSON.stringify([
            {
              type: "file",
              path: ".nitpickr/review.md",
            },
            {
              type: "file",
              path: ".nitpickr/api.md",
            },
          ]),
          { status: 200 },
        ),
    );

    const files = await client.listFiles({
      installationId: "123456",
      owner: "rubenspessoa",
      repo: "nitpickr",
      path: ".nitpickr",
      ref: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    expect(files).toEqual([".nitpickr/review.md", ".nitpickr/api.md"]);
  });

  it("returns an empty file list when a repository directory does not exist", async () => {
    const client = new GitHubRestClient(
      {
        async getInstallationAccessToken() {
          return "ghs_token";
        },
      },
      async () =>
        new Response(
          JSON.stringify({
            message: "Not Found",
          }),
          { status: 404 },
        ),
    );

    const files = await client.listFiles({
      installationId: "123456",
      owner: "rubenspessoa",
      repo: "nitpickr",
      path: ".nitpickr",
      ref: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    expect(files).toEqual([]);
  });

  it("publishes a pull request review", async () => {
    let capturedBody = "";
    const client = new GitHubRestClient(
      {
        async getInstallationAccessToken() {
          return "ghs_token";
        },
      },
      async (_input, init) => {
        capturedBody = String(init?.body ?? "");
        return new Response(JSON.stringify({ id: 777 }), { status: 200 });
      },
    );

    const result = await client.publishPullRequestReview({
      installationId: "123456",
      owner: "rubenspessoa",
      repo: "nitpickr",
      pullNumber: 42,
      body: "summary",
      comments: [
        {
          path: "src/queue/queue-scheduler.ts",
          line: 18,
          side: "RIGHT",
          body: "comment",
        },
      ],
    });

    expect(result.reviewId).toBe("777");
    expect(capturedBody).toContain("summary");
    expect(capturedBody).toContain('"side":"RIGHT"');
  });

  it("lists pull request reviews for idempotent publish checks", async () => {
    const client = new GitHubRestClient(
      {
        async getInstallationAccessToken() {
          return "ghs_token";
        },
      },
      async () =>
        new Response(
          JSON.stringify([
            {
              id: 777,
              body: "<!-- nitpickr:review-run:review_run_1 -->\nsummary",
              state: "COMMENTED",
            },
          ]),
          { status: 200 },
        ),
    );

    const reviews = await client.listPullRequestReviews({
      installationId: "123456",
      owner: "rubenspessoa",
      repo: "nitpickr",
      pullNumber: 42,
    });

    expect(reviews).toEqual([
      {
        id: 777,
        body: "<!-- nitpickr:review-run:review_run_1 -->\nsummary",
        state: "COMMENTED",
      },
    ]);
  });

  it("creates and updates check runs for review state updates", async () => {
    let requestedUrl = "";
    let capturedBody = "";
    let method = "";
    const client = new GitHubRestClient(
      {
        async getInstallationAccessToken() {
          return "ghs_token";
        },
      },
      async (input, init) => {
        requestedUrl = String(input);
        method = String(init?.method ?? "GET");
        capturedBody = String(init?.body ?? "");
        return new Response(JSON.stringify({ id: 88 }), { status: 201 });
      },
    );

    const created = await client.createCheckRun({
      installationId: "123456",
      owner: "rubenspessoa",
      repo: "nitpickr",
      sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      name: "nitpickr / review",
      externalId: "review_run_1",
      status: "in_progress",
      title: "nitpickr review is running",
      summary: "nitpickr review is running.",
    });

    expect(created).toEqual({
      checkRunId: "88",
    });
    expect(method).toBe("POST");
    expect(requestedUrl).toBe(
      "https://api.github.com/repos/rubenspessoa/nitpickr/check-runs",
    );
    expect(capturedBody).toContain('"name":"nitpickr / review"');
    expect(capturedBody).toContain('"status":"in_progress"');
    expect(capturedBody).toContain('"external_id":"review_run_1"');

    await client.updateCheckRun({
      installationId: "123456",
      owner: "rubenspessoa",
      repo: "nitpickr",
      checkRunId: "88",
      status: "completed",
      conclusion: "success",
      title: "nitpickr review completed",
      summary: "2 findings published.",
    });

    expect(method).toBe("PATCH");
    expect(requestedUrl).toBe(
      "https://api.github.com/repos/rubenspessoa/nitpickr/check-runs/88",
    );
    expect(capturedBody).toContain('"status":"completed"');
    expect(capturedBody).toContain('"conclusion":"success"');
  });

  it("reacts to issue comments", async () => {
    let requestedUrl = "";
    let capturedBody = "";
    const client = new GitHubRestClient(
      {
        async getInstallationAccessToken() {
          return "ghs_token";
        },
      },
      async (input, init) => {
        requestedUrl = String(input);
        capturedBody = String(init?.body ?? "");
        return new Response(JSON.stringify({ id: 55 }), { status: 201 });
      },
    );

    await client.createIssueCommentReaction({
      installationId: "123456",
      owner: "rubenspessoa",
      repo: "nitpickr",
      commentId: 9001,
      content: "eyes",
    });

    expect(requestedUrl).toBe(
      "https://api.github.com/repos/rubenspessoa/nitpickr/issues/comments/9001/reactions",
    );
    expect(capturedBody).toBe('{"content":"eyes"}');
  });

  it("uses a custom GitHub API base URL when configured", async () => {
    let requestedUrl = "";
    const client = new GitHubRestClient(
      {
        async getInstallationAccessToken() {
          return "ghs_token";
        },
      },
      async (input) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({
            id: 101,
            number: 42,
            title: "Improve queue fairness",
            state: "open",
            draft: false,
            user: { login: "ruben" },
            base: {
              sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              ref: "main",
            },
            head: {
              sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              ref: "feature",
            },
          }),
          { status: 200 },
        );
      },
      {
        baseUrl: "http://github-stub:4010/",
      },
    );

    await client.getPullRequest({
      installationId: "123456",
      owner: "rubenspessoa",
      repo: "nitpickr",
      pullNumber: 42,
    });

    expect(requestedUrl).toBe(
      "http://github-stub:4010/repos/rubenspessoa/nitpickr/pulls/42",
    );
  });
});
