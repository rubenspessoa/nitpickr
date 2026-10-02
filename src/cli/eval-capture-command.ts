import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { LiveEvaluationFixture } from "../eval/live-review-evaluator.js";

/**
 * `eval:capture owner/repo#123` — snapshot a real pull request into a live
 * eval fixture (patches + file content at HEAD) so it can be replayed against
 * local models. `expectedFindings` is left empty for hand annotation.
 */

export type FetchLike = typeof fetch;

export interface EvalCaptureInput {
  reference: string;
  token: string;
  outDirectory: string;
  apiBaseUrl?: string;
  /** Skip file content fetches above this many bytes (default 60_000). */
  maxFileContentBytes?: number;
  fetchFn?: FetchLike;
  write?: (line: string) => void;
}

const REFERENCE_PATTERN =
  /^(?:https:\/\/github\.com\/)?([^/\s]+)\/([^/#\s]+)(?:#|\/pull\/)(\d+)$/;

export function parsePullReference(reference: string): {
  owner: string;
  repo: string;
  number: number;
} {
  const match = REFERENCE_PATTERN.exec(reference.trim());
  if (!match) {
    throw new Error(
      `Expected owner/repo#123 or a pull request URL, got "${reference}".`,
    );
  }
  return {
    owner: match[1] as string,
    repo: match[2] as string,
    number: Number.parseInt(match[3] as string, 10),
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

interface PullFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export class EvalCaptureCommand {
  async run(input: EvalCaptureInput): Promise<string> {
    const write = input.write ?? ((line: string) => console.log(line));
    const fetchFn = input.fetchFn ?? fetch;
    const apiBaseUrl = (input.apiBaseUrl ?? "https://api.github.com").replace(
      /\/+$/,
      "",
    );
    const maxBytes = input.maxFileContentBytes ?? 60_000;
    const { owner, repo, number } = parsePullReference(input.reference);
    const headers = {
      authorization: `Bearer ${input.token}`,
      accept: "application/vnd.github+json",
      "user-agent": "nitpickr-eval-capture",
    };
    const get = async <T>(path: string): Promise<T> => {
      const response = await fetchFn(`${apiBaseUrl}${path}`, { headers });
      if (!response.ok) {
        throw new Error(
          `GitHub request failed (${response.status}) for ${path}: ${(await response.text()).slice(0, 300)}`,
        );
      }
      return (await response.json()) as T;
    };

    const pull = await get<{ title: string; head: { sha: string } }>(
      `/repos/${owner}/${repo}/pulls/${number}`,
    );
    const files: PullFile[] = [];
    for (let page = 1; ; page += 1) {
      const batch = await get<PullFile[]>(
        `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
      );
      files.push(...batch);
      if (batch.length < 100) {
        break;
      }
    }

    const fixtureFiles: LiveEvaluationFixture["input"]["files"] = [];
    for (const file of files) {
      let fileContent: string | null = null;
      if (file.status !== "removed") {
        try {
          const contents = await get<{
            encoding?: string;
            content?: string;
            size?: number;
          }>(
            `/repos/${owner}/${repo}/contents/${encodeURIComponent(file.filename).replace(/%2F/g, "/")}?ref=${pull.head.sha}`,
          );
          if (
            contents.encoding === "base64" &&
            typeof contents.content === "string" &&
            (contents.size ?? 0) <= maxBytes
          ) {
            fileContent = Buffer.from(contents.content, "base64").toString(
              "utf8",
            );
          }
        } catch (error) {
          write(
            `  (skipping content for ${file.filename}: ${error instanceof Error ? error.message : String(error)})`,
          );
        }
      }
      fixtureFiles.push({
        path: file.filename,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch ?? null,
        fileContent,
      });
    }

    const fixture: LiveEvaluationFixture = {
      name: `${owner}-${repo}-${number}-${slugify(pull.title)}`,
      source: `https://github.com/${owner}/${repo}/pull/${number}`,
      input: {
        changeRequest: { title: pull.title, number },
        files: fixtureFiles,
        instructionText: "",
        memory: [],
        commentBudget: 10,
      },
      expectedFindings: [],
    };

    await mkdir(input.outDirectory, { recursive: true });
    const outPath = join(input.outDirectory, `${fixture.name}.json`);
    await writeFile(outPath, `${JSON.stringify(fixture, null, 2)}\n`);
    write(
      `Captured ${files.length} file(s) from ${fixture.source} → ${outPath}`,
    );
    write("Annotate expectedFindings before running the live eval.");
    return outPath;
  }
}
