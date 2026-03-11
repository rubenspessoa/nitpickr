import { describe, expect, it } from "vitest";

import { ReviewerChatService } from "../../src/review/reviewer-chat-service.js";

describe("ReviewerChatService", () => {
  it("builds a scoped explanation reply for why", async () => {
    const service = new ReviewerChatService();

    const reply = await service.respond({
      command: "why",
      actorLogin: "maintainer",
      latestReview: {
        id: "run_1",
        tenantId: "tenant_1",
        repositoryId: "repo_1",
        changeRequestId: "cr_1",
        trigger: {
          type: "pr_opened",
          actorLogin: "ruben",
        },
        mode: "quick",
        scope: "full_pr",
        headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        comparedFromSha: null,
        status: "published",
        budgets: {
          maxFiles: 5,
          maxHunks: 20,
          maxTokens: 8_000,
          maxComments: 5,
          maxDurationMs: 300_000,
        },
        createdAt: "2026-03-11T12:00:00.000Z",
        updatedAt: "2026-03-11T12:00:00.000Z",
        completedAt: "2026-03-11T12:02:00.000Z",
      },
      thread: {
        providerCommentId: "comment_1",
        path: "src/api/server.ts",
        line: 27,
        fingerprint: "src/api/server.ts:27:correctness:guard_the_parse",
        title: "Guard the parse",
        body: "The webhook parser should reject invalid payloads before queueing work.",
        fixPrompt:
          "In `src/api/server.ts` around line 27, add an early validation guard before queueing.",
      },
    });

    expect(reply.body).toContain("**Why this matters**");
    expect(reply.body).toContain("src/api/server.ts:27");
    expect(reply.body).toContain("Guard the parse");
    expect(reply.feedbackEvents).toEqual([]);
  });

  it("records a soft suppression signal for reconsider", async () => {
    const service = new ReviewerChatService();

    const reply = await service.respond({
      command: "reconsider",
      actorLogin: "maintainer",
      thread: {
        providerCommentId: "comment_1",
        path: "src/api/server.ts",
        line: 27,
        fingerprint: "src/api/server.ts:27:correctness:guard_the_parse",
        title: "Guard the parse",
        body: "The webhook parser should reject invalid payloads before queueing work.",
        fixPrompt:
          "In `src/api/server.ts` around line 27, add an early validation guard before queueing.",
      },
    });

    expect(reply.feedbackEvents).toEqual([
      {
        fingerprint: "src/api/server.ts:27:correctness:guard_the_parse",
        path: "src/api/server.ts",
        category: "correctness",
        kind: "ignored",
      },
    ]);
    expect(reply.body).toContain("down-rank similar findings");
  });

  it("turns learn commands into explicit discussion memories", async () => {
    const service = new ReviewerChatService();

    const reply = await service.respond({
      command: "learn",
      actorLogin: "maintainer",
      argumentText: "Prefer explicit webhook payload guards in API handlers.",
      thread: {
        providerCommentId: "comment_1",
        path: "src/api/server.ts",
        line: 27,
        fingerprint: "src/api/server.ts:27:correctness:guard_the_parse",
        title: "Guard the parse",
        body: "The webhook parser should reject invalid payloads before queueing work.",
        fixPrompt:
          "In `src/api/server.ts` around line 27, add an early validation guard before queueing.",
      },
    });

    expect(reply.memoryDiscussions).toEqual([
      {
        authorLogin: "maintainer",
        body: "Prefer explicit webhook payload guards in API handlers.",
        path: "src/api/server.ts",
      },
    ]);
    expect(reply.body).toContain("I'll remember that preference");
  });

  it("reports the latest review status in a PR-level status reply", async () => {
    const service = new ReviewerChatService();

    const reply = await service.respond({
      command: "status",
      actorLogin: "maintainer",
      latestReview: {
        id: "run_1",
        tenantId: "tenant_1",
        repositoryId: "repo_1",
        changeRequestId: "cr_1",
        trigger: {
          type: "pr_synchronized",
          actorLogin: "ruben",
        },
        mode: "quick",
        scope: "commit_delta",
        headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        comparedFromSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "published",
        budgets: {
          maxFiles: 5,
          maxHunks: 20,
          maxTokens: 8_000,
          maxComments: 5,
          maxDurationMs: 300_000,
        },
        createdAt: "2026-03-11T12:00:00.000Z",
        updatedAt: "2026-03-11T12:00:00.000Z",
        completedAt: "2026-03-11T12:02:00.000Z",
      },
    });

    expect(reply.body).toContain("**nitpickr status**");
    expect(reply.body).toContain("published");
    expect(reply.body).toContain("`bbbbbbb`");
  });
});
