export interface ReviewStatusClient {
  createCheckRun(input: {
    installationId: string;
    repository: {
      owner: string;
      name: string;
    };
    sha: string;
    name: string;
    externalId: string;
    status: "in_progress" | "completed";
    conclusion?: "success" | "neutral" | "failure";
    title: string;
    summary: string;
  }): Promise<{
    checkRunId: string;
  }>;
  updateCheckRun(input: {
    installationId: string;
    repository: {
      owner: string;
      name: string;
    };
    checkRunId: string;
    status: "in_progress" | "completed";
    conclusion?: "success" | "neutral" | "failure";
    title: string;
    summary: string;
  }): Promise<void>;
}

export interface ReviewStatusUpdate {
  installationId: string;
  repository: {
    owner: string;
    name: string;
  };
  sha: string;
  reviewRunId: string;
  description: string;
  summary?: string;
}

const REVIEW_CHECK_NAME = "nitpickr / review";

function toOutputSummary(
  description: string,
  summary: string | undefined,
): string {
  return summary?.trim().length ? summary.trim() : description;
}

export class ReviewStatusPublisher {
  readonly #client: ReviewStatusClient;

  constructor(client: ReviewStatusClient) {
    this.#client = client;
  }

  async markPending(input: ReviewStatusUpdate): Promise<string> {
    const created = await this.#client.createCheckRun({
      installationId: input.installationId,
      repository: input.repository,
      sha: input.sha,
      name: REVIEW_CHECK_NAME,
      externalId: input.reviewRunId,
      status: "in_progress",
      title: "nitpickr review is running",
      summary: toOutputSummary(input.description, input.summary),
    });

    return created.checkRunId;
  }

  async markPublished(
    input: ReviewStatusUpdate & {
      checkRunId: string;
    },
  ): Promise<void> {
    await this.#publishCompleted({
      ...input,
      checkRunId: input.checkRunId,
      conclusion: "success",
      title: "nitpickr review completed",
    });
  }

  async markSkipped(
    input: ReviewStatusUpdate & {
      checkRunId: string;
    },
  ): Promise<void> {
    await this.#publishCompleted({
      ...input,
      checkRunId: input.checkRunId,
      conclusion: "neutral",
      title: "nitpickr review skipped",
    });
  }

  async markFailed(
    input: ReviewStatusUpdate & {
      checkRunId?: string;
      retryable: boolean;
    },
  ): Promise<string | undefined> {
    const title = input.retryable
      ? "nitpickr review retry scheduled"
      : "nitpickr review failed";
    const conclusion = input.retryable ? "neutral" : "failure";
    if (input.checkRunId) {
      await this.#publishCompleted({
        ...input,
        checkRunId: input.checkRunId,
        conclusion,
        title,
      });
      return;
    }

    const created = await this.#client.createCheckRun({
      installationId: input.installationId,
      repository: input.repository,
      sha: input.sha,
      name: REVIEW_CHECK_NAME,
      externalId: input.reviewRunId,
      status: "completed",
      conclusion,
      title,
      summary: toOutputSummary(input.description, input.summary),
    });

    return created.checkRunId;
  }

  async #publishCompleted(
    input: ReviewStatusUpdate & {
      checkRunId: string;
      conclusion: "success" | "neutral" | "failure";
      title: string;
    },
  ): Promise<void> {
    await this.#client.updateCheckRun({
      installationId: input.installationId,
      repository: input.repository,
      checkRunId: input.checkRunId,
      status: "completed",
      conclusion: input.conclusion,
      title: input.title,
      summary: toOutputSummary(input.description, input.summary),
    });
  }
}
