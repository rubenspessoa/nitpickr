import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

const reviewEventSchema = z.enum([
  "pull_request.opened",
  "pull_request.synchronize",
  "pull_request.ready_for_review",
]);

const reviewCommandSchema = z.enum([
  "review",
  "full_review",
  "summary",
  "recheck",
  "ignore_this",
]);

const normalizedRepositoryConfigSchema = z.object({
  version: z.literal(1),
  triggers: z.object({
    autoReview: z.object({
      enabled: z.boolean(),
      events: z.array(reviewEventSchema).min(1),
    }),
    commands: z.array(reviewCommandSchema).min(1),
  }),
  review: z.object({
    ignorePaths: z.array(z.string()),
    maxFiles: z.number().int().positive(),
    maxHunks: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    maxComments: z.number().int().min(1),
    maxAutoComments: z.number().int().min(0),
    summaryOnlyThreshold: z.number().int().positive(),
    allowSuggestedChanges: z.boolean(),
    strictness: z.enum(["relaxed", "balanced", "strict"]),
    focusAreas: z.array(z.string()),
  }),
  concurrency: z.object({
    perRepository: z.number().int().positive(),
    perTenant: z.number().int().positive(),
  }),
  statusChecks: z.object({
    enabled: z.boolean(),
  }),
  learning: z.object({
    mode: z.enum(["explicit"]),
  }),
});

const repositoryConfigInputSchema = z
  .object({
    version: z.literal(1).optional(),
    triggers: z
      .object({
        autoReview: z
          .object({
            enabled: z.boolean().optional(),
            events: z.array(reviewEventSchema).optional(),
          })
          .partial()
          .optional(),
        commands: z.array(reviewCommandSchema).optional(),
      })
      .partial()
      .optional(),
    review: z
      .object({
        ignorePaths: z.array(z.string()).optional(),
        maxFiles: z.number().int().positive().optional(),
        maxHunks: z.number().int().positive().optional(),
        maxTokens: z.number().int().positive().optional(),
        maxComments: z.number().int().min(1).optional(),
        maxAutoComments: z.number().int().min(0).optional(),
        summaryOnlyThreshold: z.number().int().positive().optional(),
        allowSuggestedChanges: z.boolean().optional(),
        strictness: z.enum(["relaxed", "balanced", "strict"]).optional(),
        focusAreas: z.array(z.string()).optional(),
      })
      .partial()
      .optional(),
    concurrency: z
      .object({
        perRepository: z.number().int().positive().optional(),
        perTenant: z.number().int().positive().optional(),
      })
      .partial()
      .optional(),
    statusChecks: z
      .object({
        enabled: z.boolean().optional(),
      })
      .partial()
      .optional(),
    learning: z
      .object({
        mode: z.enum(["explicit"]).optional(),
      })
      .partial()
      .optional(),
  })
  .default({});

export type RepositoryConfig = z.infer<
  typeof normalizedRepositoryConfigSchema
> & {
  source: string | null;
};

export const defaultRepositoryConfig: Omit<RepositoryConfig, "source"> = {
  version: 1,
  triggers: {
    autoReview: {
      enabled: true,
      events: [
        "pull_request.opened",
        "pull_request.synchronize",
        "pull_request.ready_for_review",
      ],
    },
    commands: ["review", "full_review", "summary", "recheck", "ignore_this"],
  },
  review: {
    ignorePaths: [],
    maxFiles: 50,
    maxHunks: 200,
    maxTokens: 120000,
    maxComments: 20,
    maxAutoComments: 5,
    summaryOnlyThreshold: 100,
    allowSuggestedChanges: true,
    strictness: "balanced",
    focusAreas: [],
  },
  concurrency: {
    perRepository: 1,
    perTenant: 2,
  },
  statusChecks: {
    enabled: true,
  },
  learning: {
    mode: "explicit",
  },
};

function mergeRepositoryConfig(
  input: z.infer<typeof repositoryConfigInputSchema>,
): Omit<RepositoryConfig, "source"> {
  return {
    version: input.version ?? defaultRepositoryConfig.version,
    triggers: {
      autoReview: {
        enabled:
          input.triggers?.autoReview?.enabled ??
          defaultRepositoryConfig.triggers.autoReview.enabled,
        events:
          input.triggers?.autoReview?.events ??
          defaultRepositoryConfig.triggers.autoReview.events,
      },
      commands:
        input.triggers?.commands ?? defaultRepositoryConfig.triggers.commands,
    },
    review: {
      ignorePaths:
        input.review?.ignorePaths ?? defaultRepositoryConfig.review.ignorePaths,
      maxFiles:
        input.review?.maxFiles ?? defaultRepositoryConfig.review.maxFiles,
      maxHunks:
        input.review?.maxHunks ?? defaultRepositoryConfig.review.maxHunks,
      maxTokens:
        input.review?.maxTokens ?? defaultRepositoryConfig.review.maxTokens,
      maxComments:
        input.review?.maxComments ?? defaultRepositoryConfig.review.maxComments,
      maxAutoComments:
        input.review?.maxAutoComments ??
        defaultRepositoryConfig.review.maxAutoComments,
      summaryOnlyThreshold:
        input.review?.summaryOnlyThreshold ??
        defaultRepositoryConfig.review.summaryOnlyThreshold,
      allowSuggestedChanges:
        input.review?.allowSuggestedChanges ??
        defaultRepositoryConfig.review.allowSuggestedChanges,
      strictness:
        input.review?.strictness ?? defaultRepositoryConfig.review.strictness,
      focusAreas:
        input.review?.focusAreas ?? defaultRepositoryConfig.review.focusAreas,
    },
    concurrency: {
      perRepository:
        input.concurrency?.perRepository ??
        defaultRepositoryConfig.concurrency.perRepository,
      perTenant:
        input.concurrency?.perTenant ??
        defaultRepositoryConfig.concurrency.perTenant,
    },
    statusChecks: {
      enabled:
        input.statusChecks?.enabled ??
        defaultRepositoryConfig.statusChecks.enabled,
    },
    learning: {
      mode: input.learning?.mode ?? defaultRepositoryConfig.learning.mode,
    },
  };
}

export function parseRepositoryConfigDocument(
  contents: string,
  source: string | null = null,
): RepositoryConfig {
  const parsed = repositoryConfigInputSchema.parse(parseYaml(contents) ?? {});
  const normalized = normalizedRepositoryConfigSchema.parse(
    mergeRepositoryConfig(parsed),
  );

  return {
    ...normalized,
    source,
  };
}

async function resolveConfigPath(
  repositoryRoot: string,
): Promise<string | null> {
  const candidates = [
    join(repositoryRoot, ".nitpickr.yml"),
    join(repositoryRoot, ".nitpickr.yaml"),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.F_OK);
      return candidate;
    } catch {}
  }

  return null;
}

export async function loadRepositoryConfig(
  repositoryRoot: string,
): Promise<RepositoryConfig> {
  const source = await resolveConfigPath(repositoryRoot);
  if (source === null) {
    return {
      ...defaultRepositoryConfig,
      source: null,
    };
  }

  const contents = await readFile(source, "utf8");
  return parseRepositoryConfigDocument(contents, source);
}
