import { z } from "zod";

import {
  type DiagramSpec,
  defaultDiagramSpec,
  mergeDiagramSpecs,
  renderDiagramSpec,
} from "./diagram-renderer.js";
import { PromptBuilder } from "./prompt-builder.js";

const defaultMermaidDiagram = renderDiagramSpec(defaultDiagramSpec);
const defaultSummary = "nitpickr completed the review.";

const findingSchema = z.object({
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

const MAX_SUGGESTED_CHANGE_LINES = 12;
const MAX_SUGGESTED_CHANGE_CHARACTERS = 600;

const severityAliasMap: Record<
  string,
  z.infer<typeof findingSchema>["severity"]
> = {
  info: "low",
  trivial: "low",
  minor: "low",
  nit: "low",
  low: "low",
  moderate: "medium",
  medium: "medium",
  major: "high",
  high: "high",
  significant: "high",
  severe: "critical",
  blocker: "critical",
  blocking: "critical",
  critical: "critical",
};

const categoryAliasMap: Record<
  string,
  z.infer<typeof findingSchema>["category"]
> = {
  bug: "correctness",
  bugs: "correctness",
  correctness: "correctness",
  logic: "correctness",
  functionality: "correctness",
  functional: "correctness",
  robustness: "correctness",
  reliability: "correctness",
  stability: "correctness",
  performance: "performance",
  perf: "performance",
  scalability: "performance",
  efficiency: "performance",
  security: "security",
  vuln: "security",
  vulnerability: "security",
  maintainability: "maintainability",
  architecture: "maintainability",
  design: "maintainability",
  readability: "maintainability",
  refactor: "maintainability",
  cleanup: "maintainability",
  testing: "testing",
  test: "testing",
  tests: "testing",
  coverage: "testing",
  style: "style",
  formatting: "style",
  docs: "style",
  documentation: "style",
  nitpick: "style",
};

type ReviewFinding = z.infer<typeof findingSchema>;

function normalizeLine(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeSeverity(
  value: unknown,
): ReviewFinding["severity"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return severityAliasMap[value.trim().toLowerCase()];
}

function normalizeCategory(
  value: unknown,
): ReviewFinding["category"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return categoryAliasMap[value.trim().toLowerCase()];
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function maybeTrimSentenceCount(value: string, maxSentences: number): string {
  const sentences = value
    .match(/[^.!?]+[.!?]?/g)
    ?.map((part) => part.trim()) ?? [value];
  const trimmed = sentences
    .filter((part) => part.length > 0)
    .slice(0, maxSentences);

  return trimmed.join(" ").trim();
}

function withScopedFixPrompt(
  path: string,
  line: number,
  fixPrompt: string | undefined,
  title: string | undefined,
): string | undefined {
  const body = fixPrompt?.trim() ?? (title ? `Resolve: ${title}.` : undefined);
  if (!body) {
    return undefined;
  }

  const hasPath = body.includes(path);
  const hasLine = new RegExp(`\\bline\\s+${line}\\b`, "i").test(body);
  if (hasPath && hasLine) {
    return body;
  }

  return `In \`${path}\` around line ${line}, ${body}`;
}

function normalizeSuggestedChange(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const fenced = trimmed.match(/^```(?:suggestion|[\w-]+)?\n([\s\S]*?)\n```$/i);
  const normalized = (fenced?.[1] ?? trimmed)
    .replace(/\r\n/g, "\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");

  if (normalized.length === 0) {
    return undefined;
  }
  if (normalized.length > MAX_SUGGESTED_CHANGE_CHARACTERS) {
    return undefined;
  }
  if (normalized.split("\n").length > MAX_SUGGESTED_CHANGE_LINES) {
    return undefined;
  }

  return normalized;
}

function normalizeFinding(value: unknown): ReviewFinding | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const path = normalizeString(candidate.path);
  const line = normalizeLine(candidate.line);
  const severity = normalizeSeverity(candidate.severity);
  const category = normalizeCategory(candidate.category);
  const title = normalizeString(candidate.title);
  const body = normalizeString(candidate.body);
  const conciseBody = body ? maybeTrimSentenceCount(body, 2) : undefined;
  const fixPrompt =
    path && line
      ? withScopedFixPrompt(
          path,
          line,
          normalizeString(candidate.fixPrompt),
          title,
        )
      : undefined;
  const suggestedChange = normalizeSuggestedChange(candidate.suggestedChange);

  const parsed = findingSchema.safeParse({
    path,
    line,
    severity,
    category,
    title,
    body: conciseBody,
    fixPrompt,
    suggestedChange,
  });

  return parsed.success ? parsed.data : null;
}

function normalizeFindings(value: unknown): ReviewFinding[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const finding = normalizeFinding(entry);
    return finding ? [finding] : [];
  });
}

function normalizeLegacyMermaid(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeSequenceDiagram(
  value: Record<string, unknown>,
): DiagramSpec | null {
  const participants = Array.isArray(value.participants)
    ? value.participants.flatMap((participant) => {
        if (typeof participant === "string") {
          return [
            {
              id: participant,
              label: participant,
            },
          ];
        }

        if (
          typeof participant === "object" &&
          participant !== null &&
          typeof participant.id === "string"
        ) {
          return [
            {
              id: participant.id,
              label:
                typeof participant.label === "string"
                  ? participant.label
                  : participant.id,
            },
          ];
        }

        return [];
      })
    : [];

  const steps = Array.isArray(value.steps)
    ? value.steps.flatMap((step) => {
        if (
          typeof step !== "object" ||
          step === null ||
          typeof step.from !== "string" ||
          typeof step.to !== "string" ||
          typeof step.label !== "string"
        ) {
          return [];
        }

        return [
          {
            from: step.from,
            to: step.to,
            label: step.label,
          },
        ];
      })
    : [];

  if (participants.length === 0 || steps.length === 0) {
    return null;
  }

  const title = normalizeString(value.title);
  return {
    type: "sequence",
    ...(title ? { title } : {}),
    participants,
    steps,
  };
}

function normalizeFlowchartDiagram(
  value: Record<string, unknown>,
): DiagramSpec | null {
  const nodes = Array.isArray(value.nodes)
    ? value.nodes.flatMap((node) => {
        if (typeof node === "string") {
          return [
            {
              id: node,
              label: node,
            },
          ];
        }

        if (
          typeof node === "object" &&
          node !== null &&
          typeof node.id === "string"
        ) {
          return [
            {
              id: node.id,
              label: typeof node.label === "string" ? node.label : node.id,
            },
          ];
        }

        return [];
      })
    : [];

  const edges = Array.isArray(value.edges)
    ? value.edges.flatMap((edge) => {
        if (
          typeof edge !== "object" ||
          edge === null ||
          typeof edge.from !== "string" ||
          typeof edge.to !== "string"
        ) {
          return [];
        }

        return [
          {
            from: edge.from,
            to: edge.to,
            label: typeof edge.label === "string" ? edge.label : undefined,
          },
        ];
      })
    : [];

  if (nodes.length === 0 || edges.length === 0) {
    return null;
  }

  const title = normalizeString(value.title);
  return {
    type: "flowchart",
    ...(title ? { title } : {}),
    direction: value.direction === "TD" ? "TD" : "LR",
    nodes,
    edges,
  };
}

function normalizeDiagram(value: unknown): DiagramSpec | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.type === "sequence") {
    return normalizeSequenceDiagram(candidate);
  }

  if (candidate.type === "flowchart") {
    return normalizeFlowchartDiagram(candidate);
  }

  return null;
}

const modelResponseSchema = z
  .object({
    summary: z.preprocess((value) => {
      if (value === null || value === undefined) {
        return defaultSummary;
      }

      if (typeof value === "string" && value.trim().length === 0) {
        return defaultSummary;
      }

      return value;
    }, z.string().min(1)),
    diagram: z.unknown().optional(),
    mermaid: z.unknown().optional(),
    findings: z.preprocess(
      (value) => normalizeFindings(value),
      z.array(findingSchema),
    ),
  })
  .transform((value) => ({
    summary: value.summary,
    diagram: normalizeDiagram(value.diagram),
    legacyMermaid: normalizeLegacyMermaid(value.mermaid),
    findings: value.findings,
  }));

export interface ReviewModel {
  generateStructuredReview(input: {
    system: string;
    user: string;
  }): Promise<unknown>;
}

export interface ReviewEngineInput {
  changeRequest: {
    title: string;
    number: number;
  };
  files: Array<{
    path: string;
    additions: number;
    deletions: number;
    patch: string | null;
  }>;
  instructionText: string;
  memory: Array<{
    summary: string;
    path?: string;
  }>;
  commentBudget: number;
}

export interface ReviewEngineResult {
  summary: string;
  mermaid: string;
  findings: ReviewFinding[];
}

export interface ReviewEngineOptions {
  maxPatchCharactersPerChunk?: number;
}

function splitIntoChunks(
  files: ReviewEngineInput["files"],
  maxPatchCharactersPerChunk: number,
): Array<ReviewEngineInput["files"]> {
  const chunks: Array<ReviewEngineInput["files"]> = [];
  let currentChunk: ReviewEngineInput["files"] = [];
  let currentSize = 0;

  for (const file of files) {
    const fileSize = file.patch?.length ?? 0;
    const wouldOverflow =
      currentChunk.length > 0 &&
      currentSize + fileSize > maxPatchCharactersPerChunk;

    if (wouldOverflow) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentSize = 0;
    }

    currentChunk.push(file);
    currentSize += fileSize;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function severityWeight(severity: ReviewFinding["severity"]): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function dedupeKey(finding: ReviewFinding): string {
  return [
    finding.path.trim().toLowerCase(),
    finding.line,
    finding.category,
    finding.title.trim().toLowerCase(),
  ].join(":");
}

function compareFindings(left: ReviewFinding, right: ReviewFinding): number {
  const severityDifference =
    severityWeight(right.severity) - severityWeight(left.severity);
  if (severityDifference !== 0) {
    return severityDifference;
  }

  const pathComparison = left.path.localeCompare(right.path);
  if (pathComparison !== 0) {
    return pathComparison;
  }

  if (left.line !== right.line) {
    return left.line - right.line;
  }

  const categoryComparison = left.category.localeCompare(right.category);
  if (categoryComparison !== 0) {
    return categoryComparison;
  }

  return left.title.localeCompare(right.title);
}

function dedupeAndRankFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const deduped = new Map<string, ReviewFinding>();

  for (const finding of findings) {
    const key = dedupeKey(finding);
    const current = deduped.get(key);
    if (!current || compareFindings(finding, current) < 0) {
      deduped.set(key, finding);
    }
  }

  return [...deduped.values()].sort(compareFindings);
}

function mergeMermaid(diagrams: string[]): string {
  if (diagrams.length === 0) {
    return defaultMermaidDiagram;
  }

  if (diagrams.some((diagram) => !diagram.trim().startsWith("flowchart"))) {
    return diagrams[0] ?? defaultMermaidDiagram;
  }

  const lines = new Set<string>();
  let hasHeader = false;

  for (const diagram of diagrams) {
    for (const line of diagram.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      if (trimmed.startsWith("flowchart")) {
        hasHeader = true;
        continue;
      }

      lines.add(trimmed);
    }
  }

  const header = hasHeader ? "flowchart TD" : "flowchart TD";
  return [header, ...lines].join("\n");
}

function renderMergedDiagram(
  responses: Array<{
    diagram: DiagramSpec | null;
    legacyMermaid: string | null;
  }>,
): string {
  const diagrams = responses.flatMap((response) =>
    response.diagram ? [response.diagram] : [],
  );
  if (diagrams.length === responses.length && diagrams.length > 0) {
    return renderDiagramSpec(mergeDiagramSpecs(diagrams));
  }
  if (diagrams.length > 0) {
    return renderDiagramSpec(diagrams[0] ?? defaultDiagramSpec);
  }

  const legacyMermaid = responses.flatMap((response) =>
    response.legacyMermaid ? [response.legacyMermaid] : [],
  );
  if (legacyMermaid.length > 0) {
    return mergeMermaid(legacyMermaid);
  }

  return defaultMermaidDiagram;
}

export class ReviewEngine {
  readonly #model: ReviewModel;
  readonly #promptBuilder: PromptBuilder;
  readonly #maxPatchCharactersPerChunk: number;

  constructor(model: ReviewModel, options: ReviewEngineOptions = {}) {
    this.#model = model;
    this.#promptBuilder = new PromptBuilder();
    this.#maxPatchCharactersPerChunk =
      options.maxPatchCharactersPerChunk ?? 12000;
  }

  async review(input: ReviewEngineInput): Promise<ReviewEngineResult> {
    if (input.files.length === 0) {
      throw new Error("Review input must contain at least one file.");
    }

    const chunks = splitIntoChunks(
      input.files,
      this.#maxPatchCharactersPerChunk,
    );

    const responses = await Promise.all(
      chunks.map(async (files, index) => {
        const prompt = this.#promptBuilder.build({
          changeRequest: input.changeRequest,
          chunk: {
            index,
            total: chunks.length,
            files,
          },
          instructionText: input.instructionText,
          memory: input.memory,
          commentBudget: input.commentBudget,
        });

        const response = await this.#model.generateStructuredReview(prompt);
        return modelResponseSchema.parse(response);
      }),
    );

    const mergedFindings = dedupeAndRankFindings(
      responses.flatMap((response) => response.findings),
    ).slice(0, input.commentBudget);

    return {
      summary: responses.map((response) => response.summary).join("\n\n"),
      mermaid: renderMergedDiagram(responses),
      findings: mergedFindings,
    };
  }
}
