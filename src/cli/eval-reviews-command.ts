import { join } from "node:path";

import {
  ReviewEvaluator,
  loadReviewEvaluationFixtures,
} from "../eval/review-evaluator.js";

export class EvalReviewsCommand {
  async run(
    input: {
      fixtureDirectory?: string;
      cwd?: string;
      write?: (line: string) => void;
    } = {},
  ): Promise<void> {
    const write = input.write ?? ((line: string) => console.log(line));
    const directory =
      input.fixtureDirectory ??
      join(input.cwd ?? process.cwd(), "tests/fixtures/review-evals");
    const fixtures = await loadReviewEvaluationFixtures(directory);
    const report = await new ReviewEvaluator().evaluate(fixtures);

    write(`Fixtures: ${fixtures.length}`);
    write(`Precision: ${report.metrics.precision.toFixed(2)}`);
    write(`Duplicate rate: ${report.metrics.duplicateRate.toFixed(2)}`);
    write(`Stale-rate proxy: ${report.metrics.staleRateProxy.toFixed(2)}`);
    write(
      `Negative reaction rate: ${report.metrics.negativeReactionRate.toFixed(2)}`,
    );
    write(
      `Comment count / review: ${report.metrics.commentCountPerReview.toFixed(2)}`,
    );
    write(
      `Suggestion eligibility rate: ${report.metrics.suggestionEligibilityRate.toFixed(2)}`,
    );
  }
}
