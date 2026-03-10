import {
  type RepositoryConfig,
  defaultRepositoryConfig,
  parseRepositoryConfigDocument,
} from "../config/repository-config-loader.js";

export interface InstructionSource {
  readFile(path: string): Promise<string | null>;
  listFiles(prefix: string): Promise<string[]>;
}

export interface InstructionDocument {
  path: string;
  content: string;
}

export interface InstructionBundle {
  config: RepositoryConfig;
  documents: InstructionDocument[];
  combinedText: string;
}

const CONFIG_CANDIDATES = [".nitpickr.yml", ".nitpickr.yaml"];
const DOCUMENT_PREFIX = ".nitpickr/";

function renderConfigSummary(config: RepositoryConfig): string {
  return [
    "nitpickr repository config:",
    `strictness: ${config.review.strictness}`,
    `maxComments: ${config.review.maxComments}`,
    `maxFiles: ${config.review.maxFiles}`,
    `maxHunks: ${config.review.maxHunks}`,
    `summaryOnlyThreshold: ${config.review.summaryOnlyThreshold}`,
    `focusAreas: ${config.review.focusAreas.join(", ") || "none"}`,
    `ignorePaths: ${config.review.ignorePaths.join(", ") || "none"}`,
  ].join("\n");
}

export class InstructionLoader {
  async load(source: InstructionSource): Promise<InstructionBundle> {
    let config: RepositoryConfig = {
      ...defaultRepositoryConfig,
      source: null,
    };

    for (const candidate of CONFIG_CANDIDATES) {
      const contents = await source.readFile(candidate);
      if (contents === null) {
        continue;
      }

      config = parseRepositoryConfigDocument(contents, candidate);
      break;
    }

    const [agentsContents, nitpickrFiles] = await Promise.all([
      source.readFile("AGENTS.md"),
      source.listFiles(DOCUMENT_PREFIX),
    ]);

    const documents: InstructionDocument[] = [];
    for (const path of nitpickrFiles) {
      if (!path.endsWith(".md")) {
        continue;
      }

      const contents = await source.readFile(path);
      if (contents === null) {
        continue;
      }

      documents.push({
        path,
        content: contents,
      });
    }

    if (agentsContents !== null) {
      documents.push({
        path: "AGENTS.md",
        content: agentsContents,
      });
    }

    return {
      config,
      documents,
      combinedText: [
        renderConfigSummary(config),
        ...documents.map(
          (document) => `${document.path}\n${document.content.trim()}`,
        ),
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  }
}
