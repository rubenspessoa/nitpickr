import { describe, expect, it } from "vitest";

import {
  mergeDiagramSpecs,
  renderDiagramSpec,
} from "../../src/review/diagram-renderer.js";

describe("diagram-renderer", () => {
  it("renders GitHub-safe sequence diagrams", () => {
    const mermaid = renderDiagramSpec({
      type: "sequence",
      title: "Webhook review flow",
      participants: [
        {
          id: "github-app",
          label: "GitHub App",
        },
        {
          id: "worker service",
          label: "Worker service",
        },
      ],
      steps: [
        {
          from: "github-app",
          to: "worker service",
          label: "Parse webhook & enqueue",
        },
        {
          from: "worker service",
          to: "github-app",
          label: "Publish review summary",
        },
      ],
    });

    expect(mermaid).toContain("sequenceDiagram");
    expect(mermaid).toContain('participant github_app as "GitHub App"');
    expect(mermaid).toContain('participant worker_service as "Worker service"');
    expect(mermaid).toContain(
      "github_app->>worker_service: Parse webhook & enqueue",
    );
  });

  it("renders flowcharts with quoted labels and sanitized reserved words", () => {
    const mermaid = renderDiagramSpec({
      type: "flowchart",
      direction: "LR",
      nodes: [
        {
          id: "end",
          label: "end",
        },
        {
          id: "review summary",
          label: "Review summary",
        },
      ],
      edges: [
        {
          from: "end",
          to: "review summary",
          label: "ships",
        },
      ],
    });

    expect(mermaid).toContain("flowchart LR");
    expect(mermaid).toContain('end_["End"]');
    expect(mermaid).toContain('review_summary["Review summary"]');
    expect(mermaid).toContain('end_ -->|"ships"| review_summary');
  });

  it("merges multiple sequence specs into one compact graph", () => {
    const merged = mergeDiagramSpecs([
      {
        type: "sequence",
        title: "Review flow",
        participants: [
          {
            id: "github",
            label: "GitHub",
          },
          {
            id: "api",
            label: "API",
          },
        ],
        steps: [
          {
            from: "github",
            to: "api",
            label: "POST webhook",
          },
        ],
      },
      {
        type: "sequence",
        title: "Review flow",
        participants: [
          {
            id: "api",
            label: "API",
          },
          {
            id: "worker",
            label: "Worker",
          },
        ],
        steps: [
          {
            from: "api",
            to: "worker",
            label: "Enqueue review",
          },
        ],
      },
    ]);

    expect(merged).toEqual({
      type: "sequence",
      title: "Review flow",
      participants: [
        {
          id: "github",
          label: "GitHub",
        },
        {
          id: "api",
          label: "API",
        },
        {
          id: "worker",
          label: "Worker",
        },
      ],
      steps: [
        {
          from: "github",
          to: "api",
          label: "POST webhook",
        },
        {
          from: "api",
          to: "worker",
          label: "Enqueue review",
        },
      ],
    });
  });
});
