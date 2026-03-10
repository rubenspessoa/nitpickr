import { z } from "zod";

const providerSchema = z.enum(["github", "gitlab", "bitbucket"]);
const shaSchema = z.string().regex(/^[a-f0-9]{40}$/, {
  message: "Expected a full 40 character git SHA.",
});
const reviewCommandSchema = z.enum([
  "review",
  "full_review",
  "summary",
  "recheck",
  "ignore_this",
]);

const tenantSchema = z.object({
  id: z.string().min(1),
  provider: providerSchema,
  installationId: z.string().min(1),
  slug: z.string().min(1),
});

const changeRequestSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  installationId: z.string().min(1),
  repositoryId: z.string().min(1),
  provider: providerSchema,
  number: z.number().int().positive(),
  title: z.string().min(1),
  baseSha: shaSchema,
  headSha: shaSchema,
  status: z.enum(["open", "draft", "closed"]),
  authorLogin: z.string().min(1),
});

const reviewTriggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("pr_opened"),
    actorLogin: z.string().min(1),
  }),
  z.object({
    type: z.literal("pr_synchronized"),
    actorLogin: z.string().min(1),
  }),
  z.object({
    type: z.literal("pr_ready_for_review"),
    actorLogin: z.string().min(1),
  }),
  z.object({
    type: z.literal("manual_command"),
    command: reviewCommandSchema,
    actorLogin: z.string().min(1),
  }),
  z.object({
    type: z.literal("manual_label"),
    label: z.string().min(1),
    actorLogin: z.string().min(1),
  }),
]);

const reviewBudgetsSchema = z.object({
  maxFiles: z.number().int().positive(),
  maxHunks: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  maxComments: z.number().int().positive(),
  maxDurationMs: z.number().int().positive(),
});

const reviewRunSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  repositoryId: z.string().min(1),
  changeRequestId: z.string().min(1),
  trigger: reviewTriggerSchema,
  mode: z.enum(["quick", "full", "summary"]),
  headSha: shaSchema,
  status: z.enum([
    "queued",
    "running",
    "published",
    "superseded",
    "failed",
    "skipped",
  ]),
  budgets: reviewBudgetsSchema,
});

const reviewFindingSchema = z.object({
  id: z.string().min(1),
  reviewRunId: z.string().min(1),
  repositoryId: z.string().min(1),
  path: z.string().min(1),
  line: z.number().int().positive(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  category: z.enum([
    "correctness",
    "performance",
    "security",
    "maintainability",
    "testing",
    "style",
  ]),
  title: z.string().min(1),
  body: z.string().min(1),
  fixPrompt: z.string().min(1),
  suggestedChange: z.string().min(1).optional(),
});

export type Provider = z.infer<typeof providerSchema>;
export type ReviewCommand = z.infer<typeof reviewCommandSchema>;
export type Tenant = z.infer<typeof tenantSchema>;
export type ChangeRequest = z.infer<typeof changeRequestSchema>;
export type ReviewTrigger = z.infer<typeof reviewTriggerSchema>;
export type ReviewRun = z.infer<typeof reviewRunSchema>;
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

export function parseTenant(input: unknown): Tenant {
  return tenantSchema.parse(input);
}

export function parseChangeRequest(input: unknown): ChangeRequest {
  return changeRequestSchema.parse(input);
}

export function parseReviewRun(input: unknown): ReviewRun {
  return reviewRunSchema.parse(input);
}

export function parseReviewFinding(input: unknown): ReviewFinding {
  return reviewFindingSchema.parse(input);
}

export function parseReviewTrigger(input: unknown): ReviewTrigger {
  return reviewTriggerSchema.parse(input);
}
