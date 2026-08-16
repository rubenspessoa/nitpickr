import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import type { OpenAiCompletionInfo } from "../review/openai-review-model.js";
import {
  ReviewEngine,
  type ReviewEngineInput,
  type ReviewEngineOptions,
  type ReviewFinding,
  type ReviewModel,
} from "../review/review-engine.js";

/**
 * Live-model review evaluation: runs real diffs through `ReviewEngine` against
 * a real (usually local) model and scores published findings against
 * hand-annotated expectations. Complements `ReviewEvaluator`, which replays
 * canned model output and never calls a model.
 */

const fileSchema = z.object({
  path: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: z.string().nullable(),
  fileContent: z.string().nullable().optional(),
});

const expectedFindingSchema = z.object({
  /** Short label used in reports, e.g. "off-by-one in pagination". */
  label: z.string().min(1),
  path: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive().optional(),
  category: z
    .enum([
      "correctness",
      "performance",
      "security",
      "maintainability",
      "testing",
      "style",
    ])
    .optional(),
});

export const liveEvaluationFixtureSchema = z.object({
  name: z.string().min(1),
  /** Where the case came from (PR URL, "synthetic", ...). Informational. */
  source: z.string().optional(),
  input: z.object({
    changeRequest: z.object({
      title: z.string().min(1),
      number: z.number().int().positive(),
    }),
    files: z.array(fileSchema).min(1),
    contextFiles: z.array(fileSchema).optional(),
    instructionText: z.string().default(""),
    memory: z
      .array(
        z.object({ summary: z.string().min(1), path: z.string().optional() }),
      )
      .default([]),
    commentBudget: z.number().int().positive().default(10),
  }),
  /** Ground truth. Empty array = a clean change where any finding is a false positive. */
  expectedFindings: z.array(expectedFindingSchema),
});

export type LiveEvaluationFixture = z.infer<typeof liveEvaluationFixtureSchema>;
export type ExpectedFinding = z.infer<typeof expectedFindingSchema>;

/** Lines of slack when matching a published finding to an expectation. */
export const LINE_MATCH_TOLERANCE = 2;

export interface LiveCaseReport {
  name: string;
  source: string | null;
  durationMs: number;
  modelCalls: number;
  promptTokens: number | null;
  completionTokens: number | null;
  estimatedPromptTokens: number;
  chunkCount: number;
  precision: number;
  recall: number;
  matched: Array<{ expected: string; finding: string }>;
  missed: string[];
  unexpected: string[];
  summary: string;
  findings: Array<
    Pick<
      ReviewFinding,
      | "path"
      | "line"
      | "severity"
      | "category"
      | "findingType"
      | "title"
      | "body"
    >
  >;
  error: string | null;
}

export interface LiveEvaluationReport {
  cases: LiveCaseReport[];
  totals: {
    cases: number;
    failedCases: number;
    expected: number;
    matched: number;
    published: number;
    unexpected: number;
    precision: number;
    recall: number;
    durationMs: number;
    promptTokens: number | null;
    completionTokens: number | null;
  };
}

/** Collects usage from `OpenAiReviewModel.onCompletion` between `take()` calls. */
export class UsageTracker {
  #calls = 0;
  #promptTokens = 0;
  #completionTokens = 0;
  #sawUsage = false;

  readonly onCompletion = (info: OpenAiCompletionInfo): void => {
    this.#calls += 1;
    if (
      info.promptTokens !== undefined ||
      info.completionTokens !== undefined
    ) {
      this.#sawUsage = true;
      this.#promptTokens += info.promptTokens ?? 0;
      this.#completionTokens += info.completionTokens ?? 0;
    }
  };

  take(): {
    calls: number;
    promptTokens: number | null;
    completionTokens: number | null;
  } {
    const snapshot = {
      calls: this.#calls,
      promptTokens: this.#sawUsage ? this.#promptTokens : null,
      completionTokens: this.#sawUsage ? this.#completionTokens : null,
    };
    this.#calls = 0;
    this.#promptTokens = 0;
    this.#completionTokens = 0;
    this.#sawUsage = false;
    return snapshot;
  }
}

export async function loadLiveEvaluationFixtures(
  directory: string,
): Promise<LiveEvaluationFixture[]> {
  const entries = await readdir(directory);
  return Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .map(async (entry) =>
        liveEvaluationFixtureSchema.parse(
          JSON.parse(await readFile(join(directory, entry), "utf8")),
        ),
      ),
  );
}

export function matchFindings(
  findings: ReviewFinding[],
  expected: ExpectedFinding[],
): {
  matched: Array<{ expected: ExpectedFinding; finding: ReviewFinding }>;
  missed: ExpectedFinding[];
  unexpected: ReviewFinding[];
} {
  const remaining = new Set(findings);
  const matched: Array<{ expected: ExpectedFinding; finding: ReviewFinding }> =
    [];
  const missed: ExpectedFinding[] = [];

  for (const expectation of expected) {
    const lineStart = expectation.lineStart - LINE_MATCH_TOLERANCE;
    const lineEnd =
      (expectation.lineEnd ?? expectation.lineStart) + LINE_MATCH_TOLERANCE;
    const candidate = [...remaining].find(
      (finding) =>
        finding.path === expectation.path &&
        finding.line >= lineStart &&
        finding.line <= lineEnd &&
        (expectation.category === undefined ||
          finding.category === expectation.category),
    );
    if (candidate) {
      remaining.delete(candidate);
      matched.push({ expected: expectation, finding: candidate });
    } else {
      missed.push(expectation);
    }
  }

  return { matched, missed, unexpected: [...remaining] };
}

function describeFinding(finding: ReviewFinding): string {
  return `${finding.path}:${finding.line} [${finding.severity}/${finding.category}] ${finding.title}`;
}

function describeExpected(expected: ExpectedFinding): string {
  const range =
    expected.lineEnd && expected.lineEnd !== expected.lineStart
      ? `${expected.lineStart}-${expected.lineEnd}`
      : `${expected.lineStart}`;
  return `${expected.path}:${range} ${expected.label}`;
}

export interface LiveReviewEvaluatorOptions {
  model: ReviewModel;
  usage?: UsageTracker;
  engineOptions?: ReviewEngineOptions;
  onCaseStart?: (fixture: LiveEvaluationFixture, index: number) => void;
  onCaseDone?: (report: LiveCaseReport, index: number) => void;
}

export class LiveReviewEvaluator {
  readonly #options: LiveReviewEvaluatorOptions;

  constructor(options: LiveReviewEvaluatorOptions) {
    this.#options = options;
  }

  async evaluate(
    fixtures: LiveEvaluationFixture[],
  ): Promise<LiveEvaluationReport> {
    const engine = new ReviewEngine(
      this.#options.model,
      this.#options.engineOptions ?? {},
    );
    const cases: LiveCaseReport[] = [];

    for (const [index, fixture] of fixtures.entries()) {
      this.#options.onCaseStart?.(fixture, index);
      const report = await this.#evaluateCase(engine, fixture);
      cases.push(report);
      this.#options.onCaseDone?.(report, index);
    }

    return { cases, totals: summarize(cases) };
  }

  async #evaluateCase(
    engine: ReviewEngine,
    fixture: LiveEvaluationFixture,
  ): Promise<LiveCaseReport> {
    const startedAt = process.hrtime.bigint();
    const elapsedMs = () =>
      Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
    this.#options.usage?.take();

    const base = {
      name: fixture.name,
      source: fixture.source ?? null,
    };

    try {
      const diagnostics = await engine.reviewWithDiagnostics({
        ...(fixture.input as ReviewEngineInput),
        publishableFindingTypes: ["bug", "safe_suggestion"],
      });
      const usage = this.#options.usage?.take();
      const findings = diagnostics.result.findings;
      const { matched, missed, unexpected } = matchFindings(
        findings,
        fixture.expectedFindings,
      );

      return {
        ...base,
        durationMs: elapsedMs(),
        modelCalls:
          usage?.calls ?? diagnostics.promptUsage.afterCompaction.chunkCount,
        promptTokens: usage?.promptTokens ?? null,
        completionTokens: usage?.completionTokens ?? null,
        estimatedPromptTokens:
          diagnostics.promptUsage.afterCompaction.estimatedPromptTokens,
        chunkCount: diagnostics.promptUsage.afterCompaction.chunkCount,
        precision: findings.length === 0 ? 1 : matched.length / findings.length,
        recall:
          fixture.expectedFindings.length === 0
            ? 1
            : matched.length / fixture.expectedFindings.length,
        matched: matched.map((entry) => ({
          expected: describeExpected(entry.expected),
          finding: describeFinding(entry.finding),
        })),
        missed: missed.map(describeExpected),
        unexpected: unexpected.map(describeFinding),
        summary: diagnostics.result.summary,
        findings: findings.map((finding) => ({
          path: finding.path,
          line: finding.line,
          severity: finding.severity,
          category: finding.category,
          findingType: finding.findingType,
          title: finding.title,
          body: finding.body,
        })),
        error: null,
      };
    } catch (error) {
      const usage = this.#options.usage?.take();
      return {
        ...base,
        durationMs: elapsedMs(),
        modelCalls: usage?.calls ?? 0,
        promptTokens: usage?.promptTokens ?? null,
        completionTokens: usage?.completionTokens ?? null,
        estimatedPromptTokens: 0,
        chunkCount: 0,
        precision: 0,
        recall: 0,
        matched: [],
        missed: fixture.expectedFindings.map(describeExpected),
        unexpected: [],
        summary: "",
        findings: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function summarize(cases: LiveCaseReport[]): LiveEvaluationReport["totals"] {
  const expected = cases.reduce(
    (sum, entry) => sum + entry.matched.length + entry.missed.length,
    0,
  );
  const matched = cases.reduce((sum, entry) => sum + entry.matched.length, 0);
  const published = cases.reduce(
    (sum, entry) => sum + entry.findings.length,
    0,
  );
  const unexpected = cases.reduce(
    (sum, entry) => sum + entry.unexpected.length,
    0,
  );
  const sawTokens = cases.some((entry) => entry.promptTokens !== null);
  return {
    cases: cases.length,
    failedCases: cases.filter((entry) => entry.error !== null).length,
    expected,
    matched,
    published,
    unexpected,
    precision: published === 0 ? 1 : matched / published,
    recall: expected === 0 ? 1 : matched / expected,
    durationMs: cases.reduce((sum, entry) => sum + entry.durationMs, 0),
    promptTokens: sawTokens
      ? cases.reduce((sum, entry) => sum + (entry.promptTokens ?? 0), 0)
      : null,
    completionTokens: sawTokens
      ? cases.reduce((sum, entry) => sum + (entry.completionTokens ?? 0), 0)
      : null,
  };
}
