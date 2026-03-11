import { describe, expect, it } from "vitest";

import {
  type PublishReviewClient,
  ReviewPublisher,
} from "../../src/publisher/review-publisher.js";

class FakePublishReviewClient implements PublishReviewClient {
  readonly calls: Array<{
    installationId: string;
    repository: {
      owner: string;
      name: string;
    };
    pullNumber: number;
    body: string;
    comments: Array<{
      path: string;
      line: number;
      side: "RIGHT";
      body: string;
    }>;
  }> = [];
  existingReviews: Array<{ reviewId: string; body: string }> = [];
  publishFailures: Error[] = [];

  async listPullRequestReviews(): Promise<
    Array<{
      reviewId: string;
      body: string;
    }>
  > {
    return this.existingReviews;
  }

  async publishPullRequestReview(input: {
    installationId: string;
    repository: {
      owner: string;
      name: string;
    };
    pullNumber: number;
    body: string;
    comments: Array<{
      path: string;
      line: number;
      side: "RIGHT";
      body: string;
    }>;
  }): Promise<{ reviewId: string }> {
    this.calls.push(input);
    const nextFailure = this.publishFailures.shift();
    if (nextFailure) {
      throw nextFailure;
    }
    return { reviewId: "review_1" };
  }
}

describe("ReviewPublisher", () => {
  it("renders a summary body with findings and mermaid output", () => {
    const publisher = new ReviewPublisher(new FakePublishReviewClient());

    const body = publisher.buildSummaryBody({
      reviewRunId: "review_run_1",
      summary: "Queue fairness improved.",
      mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
      findings: [
        {
          path: "src/queue/queue-scheduler.ts",
          line: 18,
          findingType: "bug",
          severity: "high",
          category: "correctness",
          title: "Stable ordering breaks",
          body: "Equal priorities do not preserve insertion order.",
          fixPrompt:
            "Refactor the queue to preserve insertion order for equal priorities.",
        },
      ],
    });

    expect(body).toContain("Queue fairness improved.");
    expect(body).toContain("<!-- nitpickr:review-run:review_run_1 -->");
    expect(body).toContain("# nitpickr review");
    expect(body).toContain("**Summary:**");
    expect(body).not.toContain("## 📌 Highlights");
    expect(body).toContain("## Findings");
    expect(body).toContain("| Signal | Location | Finding |");
    expect(body).toContain("⚠️ 🧩");
    expect(body).toContain("🧭 Change flow");
    expect(body).toContain("```mermaid");
    expect(body).toContain("Stable ordering breaks");
  });

  it("renders inline comment bodies with fix prompts", () => {
    const publisher = new ReviewPublisher(new FakePublishReviewClient());

    const comments = publisher.buildInlineComments([
      {
        path: "src/queue/queue-scheduler.ts",
        line: 18,
        findingType: "safe_suggestion",
        severity: "high",
        category: "correctness",
        title: "Stable ordering breaks",
        body: "Equal priorities do not preserve insertion order.",
        fixPrompt:
          "Refactor the queue to preserve insertion order for equal priorities.",
        suggestedChange:
          "return left.priority - right.priority || left.sequence - right.sequence;",
      },
    ]);

    expect(comments[0]?.body).toContain("⚠️ 🧩 **Stable ordering breaks**");
    expect(comments[0]?.body).toContain(
      "**Where:** `src/queue/queue-scheduler.ts:18`",
    );
    expect(comments[0]?.body).toContain("```suggestion");
    expect(comments[0]?.body).toContain("left.sequence - right.sequence");
    expect(comments[0]?.body).toContain("🤖 AI prompt");
    expect(comments[0]?.body).toContain("preserve insertion order");
    expect(comments[0]?.body).not.toContain("[high][correctness]");
    expect(comments[0]?.side).toBe("RIGHT");
  });

  it("omits GitHub suggestion blocks when no inline replacement is available", () => {
    const publisher = new ReviewPublisher(new FakePublishReviewClient());

    const comments = publisher.buildInlineComments([
      {
        path: "src/queue/queue-scheduler.ts",
        line: 18,
        findingType: "question",
        severity: "low",
        category: "style",
        title: "Rename variable for clarity",
        body: "The current name makes the branch harder to scan.",
        fixPrompt:
          "In `src/queue/queue-scheduler.ts` around line 18, rename `q` to `queueState`.",
      },
    ]);

    expect(comments[0]?.body).not.toContain("```suggestion");
  });

  it("targets inline comments to changed diff lines when file patches are provided", () => {
    const publisher = new ReviewPublisher(new FakePublishReviewClient());

    const comments = publisher.buildInlineComments(
      [
        {
          path: "src/queue/queue-scheduler.ts",
          line: 13,
          findingType: "bug",
          severity: "high",
          category: "correctness",
          title: "Stable ordering breaks",
          body: "Equal priorities do not preserve insertion order.",
          fixPrompt:
            "Refactor the queue to preserve insertion order for equal priorities.",
        },
      ],
      {
        files: [
          {
            path: "src/queue/queue-scheduler.ts",
            patch: ["@@ -10,2 +10,2 @@", " context", "-old", "+new alpha"].join(
              "\n",
            ),
          },
        ],
      },
    );

    expect(comments).toEqual([
      {
        path: "src/queue/queue-scheduler.ts",
        line: 11,
        side: "RIGHT",
        fingerprint:
          "src/queue/queue-scheduler.ts:13:correctness:stable_ordering_breaks",
        body: expect.stringContaining("Stable ordering breaks"),
      },
    ]);
  });

  it("publishes one summary plus inline comments", async () => {
    const client = new FakePublishReviewClient();
    const publisher = new ReviewPublisher(client);

    const published = await publisher.publish({
      reviewRunId: "review_run_1",
      installationId: "123456",
      repository: {
        owner: "rubenspessoa",
        name: "nitpickr",
      },
      pullNumber: 42,
      publishMode: "pr_summary",
      result: {
        summary: "Queue fairness improved.",
        mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
        findings: [
          {
            path: "src/queue/queue-scheduler.ts",
            line: 18,
            findingType: "bug",
            severity: "high",
            category: "correctness",
            title: "Stable ordering breaks",
            body: "Equal priorities do not preserve insertion order.",
            fixPrompt:
              "Refactor the queue to preserve insertion order for equal priorities.",
          },
        ],
      },
      files: [
        {
          path: "src/queue/queue-scheduler.ts",
          patch: [
            "@@ -17,1 +17,2 @@",
            " context",
            "+inserted",
            "+stable ordering",
          ].join("\n"),
        },
      ],
    });

    expect(published.reviewId).toBe("review_1");
    expect(client.calls[0]?.comments).toHaveLength(1);
    expect(client.calls[0]?.body).toContain("Queue fairness improved.");
    expect(client.calls[0]?.comments[0]?.side).toBe("RIGHT");
    expect(client.calls[0]?.comments[0]).not.toHaveProperty("fingerprint");
  });

  it("falls back to summary-only publish when GitHub rejects inline comment path/line resolution", async () => {
    const client = new FakePublishReviewClient();
    client.publishFailures = [
      new Error(
        'GitHub request failed with status 422: {"message":"Unprocessable Entity","errors":["Path could not be resolved, and Line could not be resolved"],"status":"422"}',
      ),
    ];
    const publisher = new ReviewPublisher(client);

    const published = await publisher.publish({
      reviewRunId: "review_run_422",
      installationId: "123456",
      repository: {
        owner: "rubenspessoa",
        name: "nitpickr",
      },
      pullNumber: 42,
      publishMode: "pr_summary",
      result: {
        summary: "Queue fairness improved.",
        mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
        findings: [
          {
            path: "src/queue/queue-scheduler.ts",
            line: 18,
            findingType: "bug",
            severity: "high",
            category: "correctness",
            title: "Stable ordering breaks",
            body: "Equal priorities do not preserve insertion order.",
            fixPrompt:
              "Refactor the queue to preserve insertion order for equal priorities.",
          },
        ],
      },
      files: [
        {
          path: "src/queue/queue-scheduler.ts",
          patch: [
            "@@ -17,1 +17,2 @@",
            " context",
            "+inserted",
            "+stable ordering",
          ].join("\n"),
        },
      ],
    });

    expect(published.reviewId).toBe("review_1");
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.comments).toHaveLength(1);
    expect(client.calls[1]?.comments).toHaveLength(0);
  });

  it("does not swallow unrelated publish errors", async () => {
    const client = new FakePublishReviewClient();
    client.publishFailures = [
      new Error(
        'GitHub request failed with status 422: {"message":"Unprocessable Entity","errors":["Validation failed"],"status":"422"}',
      ),
    ];
    const publisher = new ReviewPublisher(client);

    await expect(() =>
      publisher.publish({
        reviewRunId: "review_run_error",
        installationId: "123456",
        repository: {
          owner: "rubenspessoa",
          name: "nitpickr",
        },
        pullNumber: 42,
        publishMode: "pr_summary",
        result: {
          summary: "Queue fairness improved.",
          mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
          findings: [
            {
              path: "src/queue/queue-scheduler.ts",
              line: 18,
              findingType: "bug",
              severity: "high",
              category: "correctness",
              title: "Stable ordering breaks",
              body: "Equal priorities do not preserve insertion order.",
              fixPrompt:
                "Refactor the queue to preserve insertion order for equal priorities.",
            },
          ],
        },
        files: [
          {
            path: "src/queue/queue-scheduler.ts",
            patch: [
              "@@ -17,1 +17,2 @@",
              " context",
              "+inserted",
              "+stable ordering",
            ].join("\n"),
          },
        ],
      }),
    ).rejects.toThrow(/Validation failed/i);
    expect(client.calls).toHaveLength(1);
  });

  it("reuses an existing review when the same review run was already published", async () => {
    const client = new FakePublishReviewClient();
    client.existingReviews = [
      {
        reviewId: "review_existing",
        body: "<!-- nitpickr:review-run:review_run_1 -->\nexisting",
      },
    ];
    const publisher = new ReviewPublisher(client);

    const published = await publisher.publish({
      reviewRunId: "review_run_1",
      installationId: "123456",
      repository: {
        owner: "rubenspessoa",
        name: "nitpickr",
      },
      pullNumber: 42,
      publishMode: "pr_summary",
      result: {
        summary: "Queue fairness improved.",
        mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
        findings: [],
      },
    });

    expect(published.reviewId).toBe("review_existing");
    expect(client.calls).toHaveLength(0);
  });

  it("does not create another summary review once nitpickr already posted one", async () => {
    const client = new FakePublishReviewClient();
    client.existingReviews = [
      {
        reviewId: "review_summary",
        body: [
          "<!-- nitpickr:summary -->",
          "<!-- nitpickr:review-run:review_run_1 -->",
          "# nitpickr review ✨",
        ].join("\n"),
      },
    ];
    const publisher = new ReviewPublisher(client);

    const published = await publisher.publish({
      reviewRunId: "review_run_2",
      installationId: "123456",
      repository: {
        owner: "rubenspessoa",
        name: "nitpickr",
      },
      pullNumber: 42,
      publishMode: "pr_summary",
      result: {
        summary: "Queue fairness improved.",
        mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
        findings: [],
      },
    });

    expect(published.reviewId).toBe("review_summary");
    expect(client.calls).toHaveLength(0);
  });

  it("publishes later review comments without another visible summary", async () => {
    const client = new FakePublishReviewClient();
    client.existingReviews = [
      {
        reviewId: "review_summary",
        body: [
          "<!-- nitpickr:summary -->",
          "<!-- nitpickr:review-run:review_run_1 -->",
          "# nitpickr review ✨",
        ].join("\n"),
      },
    ];
    const publisher = new ReviewPublisher(client);

    const published = await publisher.publish({
      reviewRunId: "review_run_2",
      installationId: "123456",
      repository: {
        owner: "rubenspessoa",
        name: "nitpickr",
      },
      pullNumber: 42,
      publishMode: "commit_summary",
      reviewedCommitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      commitSummaryCounts: {
        newFindings: 1,
        resolvedThreads: 0,
        stillRelevantFindings: 1,
      },
      result: {
        summary: "This push tightens queue ordering checks.",
        mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
        findings: [
          {
            path: "src/queue/queue-scheduler.ts",
            line: 18,
            findingType: "bug",
            severity: "high",
            category: "correctness",
            title: "Stable ordering breaks",
            body: "Equal priorities do not preserve insertion order.",
            fixPrompt:
              "Refactor the queue to preserve insertion order for equal priorities.",
          },
        ],
      },
      files: [
        {
          path: "src/queue/queue-scheduler.ts",
          patch: [
            "@@ -17,1 +17,2 @@",
            " context",
            "+inserted",
            "+stable ordering",
          ].join("\n"),
        },
      ],
    });

    expect(published.reviewId).toBe("review_1");
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.body).toContain(
      "<!-- nitpickr:review-run:review_run_2 -->",
    );
    expect(client.calls[0]?.body).toContain("nitpickr commit review");
    expect(client.calls[0]?.body).toContain("`bbbbbbb`");
    expect(client.calls[0]?.body).toContain("New findings: 1");
    expect(client.calls[0]?.comments).toHaveLength(1);
  });

  it("publishes a visible clean commit summary even when there are no findings", async () => {
    const client = new FakePublishReviewClient();
    client.existingReviews = [
      {
        reviewId: "review_summary",
        body: [
          "<!-- nitpickr:summary -->",
          "<!-- nitpickr:review-run:review_run_1 -->",
          "# nitpickr review ✨",
        ].join("\n"),
      },
    ];
    const publisher = new ReviewPublisher(client);

    const published = await publisher.publish({
      reviewRunId: "review_run_3",
      installationId: "123456",
      repository: {
        owner: "rubenspessoa",
        name: "nitpickr",
      },
      pullNumber: 42,
      publishMode: "commit_summary",
      reviewedCommitSha: "cccccccccccccccccccccccccccccccccccccccc",
      commitSummaryCounts: {
        newFindings: 0,
        resolvedThreads: 2,
        stillRelevantFindings: 0,
      },
      result: {
        summary: "This push mainly refines webhook validation.",
        mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
        findings: [],
      },
    });

    expect(published.reviewId).toBe("review_1");
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.comments).toHaveLength(0);
    expect(client.calls[0]?.body).toContain(
      "No concerning issues found in this push.",
    );
    expect(client.calls[0]?.body).toContain("final human review before merge");
    expect(client.calls[0]?.body).toContain("Resolved stale threads: 2");
  });

  it("rejects publish calls with no repository owner", async () => {
    const publisher = new ReviewPublisher(new FakePublishReviewClient());

    await expect(() =>
      publisher.publish({
        reviewRunId: "review_run_1",
        installationId: "123456",
        repository: {
          owner: "",
          name: "nitpickr",
        },
        pullNumber: 42,
        publishMode: "pr_summary",
        result: {
          summary: "Queue fairness improved.",
          mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
          findings: [],
        },
      }),
    ).rejects.toThrow(/owner/i);
  });
});
