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
      result: {
        summary: "Queue fairness improved.",
        mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
        findings: [
          {
            path: "src/queue/queue-scheduler.ts",
            line: 18,
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
      result: {
        summary: "Queue fairness improved.",
        mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
        findings: [
          {
            path: "src/queue/queue-scheduler.ts",
            line: 18,
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
    expect(client.calls[0]?.body).not.toContain("# nitpickr review ✨");
    expect(client.calls[0]?.comments).toHaveLength(1);
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
        result: {
          summary: "Queue fairness improved.",
          mermaid: "flowchart TD\nA[Queue] --> B[Publish]",
          findings: [],
        },
      }),
    ).rejects.toThrow(/owner/i);
  });
});
