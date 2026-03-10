export interface SequenceDiagramParticipant {
  id: string;
  label: string;
}

export interface SequenceDiagramStep {
  from: string;
  to: string;
  label: string;
}

export interface SequenceDiagramSpec {
  type: "sequence";
  title?: string;
  participants: SequenceDiagramParticipant[];
  steps: SequenceDiagramStep[];
}

export interface FlowchartNodeSpec {
  id: string;
  label: string;
}

export interface FlowchartEdgeSpec {
  from: string;
  to: string;
  label?: string;
}

export interface FlowchartDiagramSpec {
  type: "flowchart";
  direction?: "LR" | "TD";
  title?: string;
  nodes: FlowchartNodeSpec[];
  edges: FlowchartEdgeSpec[];
}

export type DiagramSpec = SequenceDiagramSpec | FlowchartDiagramSpec;

export const defaultDiagramSpec: SequenceDiagramSpec = {
  type: "sequence",
  title: "Review flow",
  participants: [
    {
      id: "pull_request",
      label: "Pull Request",
    },
    {
      id: "nitpickr",
      label: "nitpickr",
    },
  ],
  steps: [
    {
      from: "pull_request",
      to: "nitpickr",
      label: "Review requested",
    },
    {
      from: "nitpickr",
      to: "pull_request",
      label: "Publish review summary",
    },
  ],
};

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeLabel(value: string, fallback: string): string {
  const normalized = collapseWhitespace(value);
  const chosen = normalized.length === 0 ? fallback : normalized;
  const safeReservedWord = chosen.toLowerCase() === "end" ? "End" : chosen;

  return safeReservedWord.slice(0, 80);
}

function sanitizeIdentifier(value: string, fallback: string): string {
  const normalized = collapseWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const chosen = normalized.length === 0 ? fallback : normalized;
  const safeReservedWord = chosen === "end" ? "end_" : chosen;

  if (/^[0-9]/.test(safeReservedWord)) {
    return `n_${safeReservedWord}`;
  }

  return safeReservedWord;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function createIdMap(rawIds: string[]): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();

  for (const [index, rawId] of rawIds.entries()) {
    const base = sanitizeIdentifier(rawId, `node_${index + 1}`);
    let candidate = base;
    let suffix = 2;

    while (used.has(candidate)) {
      candidate = `${base}_${suffix++}`;
    }

    result.set(rawId, candidate);
    used.add(candidate);
  }

  return result;
}

function normalizeSequenceParticipants(
  spec: SequenceDiagramSpec,
): SequenceDiagramParticipant[] {
  const participants = [...spec.participants];
  const known = new Set(participants.map((participant) => participant.id));

  for (const step of spec.steps) {
    if (!known.has(step.from)) {
      participants.push({
        id: step.from,
        label: step.from,
      });
      known.add(step.from);
    }

    if (!known.has(step.to)) {
      participants.push({
        id: step.to,
        label: step.to,
      });
      known.add(step.to);
    }
  }

  return participants;
}

function normalizeFlowchartNodes(
  spec: FlowchartDiagramSpec,
): FlowchartNodeSpec[] {
  const nodes = [...spec.nodes];
  const known = new Set(nodes.map((node) => node.id));

  for (const edge of spec.edges) {
    if (!known.has(edge.from)) {
      nodes.push({
        id: edge.from,
        label: edge.from,
      });
      known.add(edge.from);
    }

    if (!known.has(edge.to)) {
      nodes.push({
        id: edge.to,
        label: edge.to,
      });
      known.add(edge.to);
    }
  }

  return nodes;
}

function renderSequence(spec: SequenceDiagramSpec): string {
  const participants = normalizeSequenceParticipants(spec);
  const idMap = createIdMap(participants.map((participant) => participant.id));
  const lines = ["sequenceDiagram"];
  const title = sanitizeLabel(spec.title ?? "Review flow", "Review flow");

  lines.push(`title ${quote(title)}`);

  for (const participant of participants.slice(0, 8)) {
    const id = idMap.get(participant.id);
    if (!id) {
      continue;
    }

    lines.push(
      `participant ${id} as ${quote(
        sanitizeLabel(participant.label, participant.id),
      )}`,
    );
  }

  for (const step of spec.steps.slice(0, 12)) {
    const from = idMap.get(step.from);
    const to = idMap.get(step.to);
    if (!from || !to) {
      continue;
    }

    lines.push(`${from}->>${to}: ${sanitizeLabel(step.label, "Review step")}`);
  }

  return lines.join("\n");
}

function renderFlowchart(spec: FlowchartDiagramSpec): string {
  const nodes = normalizeFlowchartNodes(spec);
  const idMap = createIdMap(nodes.map((node) => node.id));
  const lines = [`flowchart ${spec.direction ?? "LR"}`];

  for (const node of nodes.slice(0, 8)) {
    const id = idMap.get(node.id);
    if (!id) {
      continue;
    }

    lines.push(`${id}[${quote(sanitizeLabel(node.label, node.id))}]`);
  }

  for (const edge of spec.edges.slice(0, 12)) {
    const from = idMap.get(edge.from);
    const to = idMap.get(edge.to);
    if (!from || !to) {
      continue;
    }

    const label = edge.label
      ? `|${quote(sanitizeLabel(edge.label, "flows to"))}| `
      : "";
    lines.push(`${from} -->${label}${to}`);
  }

  return lines.join("\n");
}

function uniqueByKey<T>(values: T[], keyFn: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

function mergeSequenceDiagramSpecs(
  specs: SequenceDiagramSpec[],
): SequenceDiagramSpec {
  const title = specs[0]?.title;

  return {
    type: "sequence",
    ...(title ? { title } : {}),
    participants: uniqueByKey(
      specs.flatMap((spec) => spec.participants),
      (participant) => participant.id,
    ).slice(0, 8),
    steps: uniqueByKey(
      specs.flatMap((spec) => spec.steps),
      (step) => `${step.from}:${step.to}:${step.label}`,
    ).slice(0, 12),
  };
}

function mergeFlowchartDiagramSpecs(
  specs: FlowchartDiagramSpec[],
): FlowchartDiagramSpec {
  const title = specs[0]?.title;

  return {
    type: "flowchart",
    ...(title ? { title } : {}),
    direction: specs[0]?.direction ?? "LR",
    nodes: uniqueByKey(
      specs.flatMap((spec) => spec.nodes),
      (node) => node.id,
    ).slice(0, 8),
    edges: uniqueByKey(
      specs.flatMap((spec) => spec.edges),
      (edge) => `${edge.from}:${edge.to}:${edge.label ?? ""}`,
    ).slice(0, 12),
  };
}

export function mergeDiagramSpecs(specs: DiagramSpec[]): DiagramSpec {
  if (specs.length === 0) {
    return defaultDiagramSpec;
  }

  if (specs.every((spec) => spec.type === "sequence")) {
    return mergeSequenceDiagramSpecs(specs as SequenceDiagramSpec[]);
  }

  if (specs.every((spec) => spec.type === "flowchart")) {
    return mergeFlowchartDiagramSpecs(specs as FlowchartDiagramSpec[]);
  }

  return specs[0] ?? defaultDiagramSpec;
}

export function renderDiagramSpec(spec: DiagramSpec): string {
  if (spec.type === "sequence") {
    return renderSequence(spec);
  }

  return renderFlowchart(spec);
}
