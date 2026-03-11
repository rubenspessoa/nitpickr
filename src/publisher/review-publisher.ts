import { targetReviewCommentLine } from "./review-comment-targeter.js";

export interface PublishedFinding {
  path: string;
  line: number;
  findingType: "bug" | "safe_suggestion" | "question" | "teaching_note";
  severity: "low" | "medium" | "high" | "critical";
  category:
    | "correctness"
    | "performance"
    | "security"
    | "maintainability"
    | "testing"
    | "style";
  title: string;
  body: string;
  fixPrompt: string;
  suggestedChange?: string | undefined;
}

export interface PublishReviewClient {
  listPullRequestReviews(input: {
    installationId: string;
    repository: {
      owner: string;
      name: string;
    };
    pullNumber: number;
  }): Promise<
    Array<{
      reviewId: string;
      body: string;
    }>
  >;
  publishPullRequestReview(input: {
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
  }): Promise<{
    reviewId: string;
  }>;
}

export interface PublishedInlineComment {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
  fingerprint: string;
  providerThreadId?: string | null;
  providerCommentId?: string | null;
  resolvedAt?: string | null;
}

const severityEmoji: Record<PublishedFinding["severity"], string> = {
  low: "🔹",
  medium: "🟠",
  high: "⚠️",
  critical: "🚨",
};

const categoryEmoji: Record<PublishedFinding["category"], string> = {
  correctness: "🧩",
  performance: "⚡",
  security: "🔒",
  maintainability: "🛠️",
  testing: "🧪",
  style: "🎨",
};

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").trim();
}

function renderSignal(finding: PublishedFinding): string {
  return `${severityEmoji[finding.severity]} ${categoryEmoji[finding.category]}`;
}

function fingerprintFinding(finding: PublishedFinding): string {
  return [
    finding.path.trim().toLowerCase(),
    finding.line,
    finding.category,
    finding.title.trim().toLowerCase().replace(/\s+/g, "_"),
  ].join(":");
}

function renderGitHubSuggestion(suggestedChange: string | undefined): string[] {
  if (!suggestedChange) {
    return [];
  }

  return ["```suggestion", suggestedChange, "```", ""];
}

function summarizeFindingCount(count: number): string {
  if (count === 0) {
    return "No actionable inline findings.";
  }

  if (count === 1) {
    return "Posted 1 inline finding.";
  }

  return `Posted ${count} inline findings.`;
}

function buildReviewRunMarker(reviewRunId: string): string {
  return `<!-- nitpickr:review-run:${reviewRunId} -->`;
}

function buildSummaryMarker(): string {
  return "<!-- nitpickr:summary -->";
}

function shortSha(sha: string | undefined): string | null {
  if (!sha) {
    return null;
  }

  const trimmed = sha.trim();
  if (trimmed.length < 7) {
    return null;
  }

  return trimmed.slice(0, 7);
}

export class ReviewPublisher {
  readonly #client: PublishReviewClient;

  constructor(client: PublishReviewClient) {
    this.#client = client;
  }

  buildSummaryBody(input: {
    reviewRunId: string;
    summary: string;
    mermaid: string;
    findings: PublishedFinding[];
  }): string {
    const findingTable =
      input.findings.length === 0
        ? "- ✅ No actionable inline findings."
        : [
            "| Signal | Location | Finding |",
            "| --- | --- | --- |",
            ...input.findings.map(
              (finding) =>
                `| ${renderSignal(finding)} | \`${finding.path}:${finding.line}\` | **${escapeMarkdownTableCell(finding.title)}**<br />${escapeMarkdownTableCell(finding.body)} |`,
            ),
          ].join("\n");

    return [
      buildSummaryMarker(),
      buildReviewRunMarker(input.reviewRunId),
      "",
      "# nitpickr review ✨",
      "",
      `> ${input.summary.trim()}`,
      "",
      `**Summary:** ${summarizeFindingCount(input.findings.length)}`,
      "",
      "## Findings",
      findingTable,
      "",
      "<details>",
      "<summary>🧭 Change flow</summary>",
      "",
      "```mermaid",
      input.mermaid.trim(),
      "```",
      "",
      "</details>",
    ].join("\n");
  }

  buildFollowUpBody(reviewRunId: string): string {
    return buildReviewRunMarker(reviewRunId);
  }

  buildCommitSummaryBody(input: {
    reviewRunId: string;
    summary: string;
    reviewedCommitSha?: string;
    counts: {
      newFindings: number;
      resolvedThreads: number;
      stillRelevantFindings: number;
    };
  }): string {
    const commitLabel = shortSha(input.reviewedCommitSha);
    const cleanState = input.counts.newFindings === 0;

    return [
      buildReviewRunMarker(input.reviewRunId),
      "",
      "## nitpickr commit review",
      "",
      commitLabel ? `**Commit:** \`${commitLabel}\`` : null,
      `> ${input.summary.trim()}`,
      "",
      cleanState
        ? "No concerning issues found in this push. Please do a final human review before merge."
        : `New findings: ${input.counts.newFindings}`,
      `Resolved stale threads: ${input.counts.resolvedThreads}`,
      `Still relevant findings: ${input.counts.stillRelevantFindings}`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  }

  buildInlineComments(
    findings: PublishedFinding[],
    input: {
      files?: Array<{
        path: string;
        patch: string | null;
      }>;
      maxLineDistance?: number;
    } = {},
  ): PublishedInlineComment[] {
    const patchByPath = new Map(
      (input.files ?? []).map((file) => [file.path, file.patch]),
    );

    return findings.flatMap((finding) => {
      const patch = patchByPath.get(finding.path) ?? null;
      const line =
        input.files === undefined
          ? finding.line
          : targetReviewCommentLine(
              input.maxLineDistance === undefined
                ? {
                    requestedLine: finding.line,
                    patch,
                  }
                : {
                    requestedLine: finding.line,
                    patch,
                    maxLineDistance: input.maxLineDistance,
                  },
            );

      if (line === null) {
        return [];
      }

      return [
        {
          path: finding.path,
          line,
          side: "RIGHT",
          fingerprint: fingerprintFinding(finding),
          body: [
            `${renderSignal(finding)} **${finding.title}**`,
            `**Where:** \`${finding.path}:${line}\``,
            "",
            `${finding.body}`,
            "",
            ...renderGitHubSuggestion(finding.suggestedChange),
            `<!-- nitpickr:fingerprint:${fingerprintFinding(finding)} -->`,
            "<details>",
            "<summary>🤖 AI prompt</summary>",
            "",
            "```text",
            finding.fixPrompt,
            "```",
            "",
            "</details>",
          ].join("\n"),
        },
      ];
    });
  }

  async publish(input: {
    reviewRunId: string;
    installationId: string;
    repository: {
      owner: string;
      name: string;
    };
    pullNumber: number;
    publishMode: "pr_summary" | "commit_summary";
    reviewedCommitSha?: string;
    commitSummaryCounts?: {
      newFindings: number;
      resolvedThreads: number;
      stillRelevantFindings: number;
    };
    result: {
      summary: string;
      mermaid: string;
      findings: PublishedFinding[];
    };
    files?: Array<{
      path: string;
      patch: string | null;
    }>;
  }): Promise<{ reviewId: string }> {
    if (input.repository.owner.trim().length === 0) {
      throw new Error("repository owner must not be empty.");
    }
    if (input.repository.name.trim().length === 0) {
      throw new Error("repository name must not be empty.");
    }
    if (input.pullNumber <= 0) {
      throw new Error("pullNumber must be positive.");
    }

    const existingReviews = await this.#client.listPullRequestReviews({
      installationId: input.installationId,
      repository: input.repository,
      pullNumber: input.pullNumber,
    });

    const existingReview = existingReviews.find((review) =>
      review.body.includes(buildReviewRunMarker(input.reviewRunId)),
    );

    if (existingReview) {
      return {
        reviewId: existingReview.reviewId,
      };
    }

    const existingSummaryReview = existingReviews.find((review) =>
      review.body.includes(buildSummaryMarker()),
    );
    const comments =
      input.files === undefined
        ? this.buildInlineComments(input.result.findings)
        : this.buildInlineComments(input.result.findings, {
            files: input.files,
          });

    if (
      input.publishMode === "pr_summary" &&
      existingSummaryReview &&
      comments.length === 0
    ) {
      return {
        reviewId: existingSummaryReview.reviewId,
      };
    }

    const body =
      input.publishMode === "commit_summary"
        ? this.buildCommitSummaryBody({
            reviewRunId: input.reviewRunId,
            summary: input.result.summary,
            counts: input.commitSummaryCounts ?? {
              newFindings: input.result.findings.length,
              resolvedThreads: 0,
              stillRelevantFindings: input.result.findings.length,
            },
            ...(input.reviewedCommitSha
              ? { reviewedCommitSha: input.reviewedCommitSha }
              : {}),
          })
        : existingSummaryReview
          ? this.buildFollowUpBody(input.reviewRunId)
          : this.buildSummaryBody({
              reviewRunId: input.reviewRunId,
              summary: input.result.summary,
              mermaid: input.result.mermaid,
              findings: input.result.findings,
            });

    return this.#client.publishPullRequestReview({
      installationId: input.installationId,
      repository: input.repository,
      pullNumber: input.pullNumber,
      body,
      comments,
    });
  }
}
