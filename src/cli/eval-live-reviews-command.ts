import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ReasoningEffort } from "../config/app-config.js";
import {
  type LiveCaseReport,
  type LiveEvaluationReport,
  LiveReviewEvaluator,
  UsageTracker,
  loadLiveEvaluationFixtures,
} from "../eval/live-review-evaluator.js";
import { createLogger } from "../logging/logger.js";
import { OpenAiReviewModel } from "../review/openai-review-model.js";
import type { ReviewEngineOptions } from "../review/review-engine.js";

export interface EvalLiveReviewsInput {
  cwd?: string;
  fixtureDirectory?: string;
  outFile?: string;
  filter?: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoningEffort?: ReasoningEffort | null;
  timeoutMs?: number;
  engineOptions?: ReviewEngineOptions;
  /** Injected for tests; defaults to a real OpenAiReviewModel. */
  modelFactory?: (
    usage: UsageTracker,
  ) => Pick<OpenAiReviewModel, "generateStructuredReview">;
  write?: (line: string) => void;
  /** Stamped into the report; passed in so callers control clock access. */
  startedAt?: string;
}

export const DEFAULT_LIVE_FIXTURE_DIRECTORY =
  "tests/fixtures/review-evals/live";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCase(report: LiveCaseReport): string {
  const tokens =
    report.promptTokens === null
      ? "tokens n/a"
      : `${report.promptTokens}+${report.completionTokens ?? 0} tok`;
  const status = report.error ? `ERROR ${report.error}` : "";
  return [
    `  ${report.name}: recall ${pct(report.recall)} precision ${pct(report.precision)}`,
    `matched ${report.matched.length} missed ${report.missed.length} unexpected ${report.unexpected.length}`,
    `${seconds(report.durationMs)} ${report.chunkCount} chunk(s) ${tokens} ${status}`,
  ].join(" | ");
}

export class EvalLiveReviewsCommand {
  async run(input: EvalLiveReviewsInput): Promise<LiveEvaluationReport> {
    const write = input.write ?? ((line: string) => console.log(line));
    const cwd = input.cwd ?? process.cwd();
    const directory =
      input.fixtureDirectory ?? join(cwd, DEFAULT_LIVE_FIXTURE_DIRECTORY);
    try {
      await access(directory);
    } catch {
      throw new Error(`Fixture directory does not exist: ${directory}`);
    }

    let fixtures = await loadLiveEvaluationFixtures(directory);
    if (input.filter) {
      const needle = input.filter.toLowerCase();
      fixtures = fixtures.filter((fixture) =>
        fixture.name.toLowerCase().includes(needle),
      );
    }
    if (fixtures.length === 0) {
      throw new Error(`No live eval fixtures found in ${directory}.`);
    }

    const usage = new UsageTracker();
    const model =
      input.modelFactory?.(usage) ??
      new OpenAiReviewModel({
        apiKey: input.apiKey,
        model: input.model,
        baseUrl: input.baseUrl,
        reasoningEffort: input.reasoningEffort ?? null,
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
        onCompletion: usage.onCompletion,
        logger: createLogger({ level: "warn" }),
      });

    write(
      `Live review eval: model=${input.model} baseUrl=${input.baseUrl} reasoningEffort=${input.reasoningEffort ?? "(unset)"} fixtures=${fixtures.length}`,
    );

    const evaluator = new LiveReviewEvaluator({
      model,
      usage,
      engineOptions: input.engineOptions ?? {},
      onCaseStart: (fixture, index) => {
        write(`[${index + 1}/${fixtures.length}] ${fixture.name} ...`);
      },
      onCaseDone: (report) => {
        write(formatCase(report));
        for (const entry of report.matched) {
          write(`      ✓ ${entry.expected}  ←  ${entry.finding}`);
        }
        for (const entry of report.missed) {
          write(`      ✗ missed: ${entry}`);
        }
        for (const entry of report.unexpected) {
          write(`      ? unexpected: ${entry}`);
        }
      },
    });

    const report = await evaluator.evaluate(fixtures);
    const totals = report.totals;
    write("");
    write(
      `Totals: recall ${pct(totals.recall)} (${totals.matched}/${totals.expected}) | precision ${pct(totals.precision)} (${totals.matched}/${totals.published}) | unexpected ${totals.unexpected} | failed cases ${totals.failedCases} | wall-clock ${seconds(totals.durationMs)}${totals.promptTokens === null ? "" : ` | tokens ${totals.promptTokens}+${totals.completionTokens ?? 0}`}`,
    );

    if (input.outFile) {
      const payload = {
        model: input.model,
        baseUrl: input.baseUrl,
        reasoningEffort: input.reasoningEffort ?? null,
        startedAt: input.startedAt ?? null,
        fixtureDirectory: directory,
        ...report,
      };
      await mkdir(dirname(input.outFile), { recursive: true });
      await writeFile(input.outFile, `${JSON.stringify(payload, null, 2)}\n`);
      write(`Wrote ${input.outFile}`);
    }

    return report;
  }
}
