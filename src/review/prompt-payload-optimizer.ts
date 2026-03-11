import { normalize as normalizePath, posix, win32 } from "node:path";

export type ReviewScope = "full_pr" | "commit_delta";
export type PromptOptimizationMode = "off" | "balanced";

export interface PromptPayloadFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface PromptPayloadMemoryEntry {
  summary: string;
  path?: string;
}

export interface PromptUsageSnapshot {
  chunkCount: number;
  primaryPatchChars: number;
  contextPatchChars: number;
  instructionChars: number;
  memoryChars: number;
  estimatedPromptTokens: number;
}

interface ScopePromptBudgets {
  maxPrimaryPatchCharsTotal: number;
  maxPrimaryPatchCharsPerFile: number;
  maxContextFiles: number;
  maxContextPatchCharsTotal: number;
}

interface SharedPromptBudgets {
  maxInstructionChars: number;
  maxMemoryEntriesPerChunk: number;
  maxMemoryCharsPerChunk: number;
}

const balancedScopeBudgets: Record<ReviewScope, ScopePromptBudgets> = {
  commit_delta: {
    maxPrimaryPatchCharsTotal: 20_000,
    maxPrimaryPatchCharsPerFile: 6_000,
    maxContextFiles: 20,
    maxContextPatchCharsTotal: 0,
  },
  full_pr: {
    maxPrimaryPatchCharsTotal: 40_000,
    maxPrimaryPatchCharsPerFile: 8_000,
    maxContextFiles: 30,
    maxContextPatchCharsTotal: 0,
  },
};

const sharedPromptBudgets: SharedPromptBudgets = {
  maxInstructionChars: 4_000,
  maxMemoryEntriesPerChunk: 8,
  maxMemoryCharsPerChunk: 2_000,
};

const omissionMarkerReferenceChars = 1_000;

function buildOmissionMarker(omittedChars: number): string {
  return `... [omitted ${omittedChars} chars] ...`;
}

function minimumPatchCharactersForOmission(): number {
  const minimumEdgeCharacters = 8;
  // Use a stable reference so the minimum does not scale with full file size.
  const stableMarkerLength = `\n${buildOmissionMarker(
    omissionMarkerReferenceChars,
  )}`.length;
  return stableMarkerLength + minimumEdgeCharacters * 2;
}

function patchChars(patch: string | null): number {
  return patch?.length ?? 0;
}

function memoryEntryChars(entry: PromptPayloadMemoryEntry): number {
  return (entry.path?.length ?? 0) + entry.summary.length;
}

function sortContextFilesByPriority(
  contextFiles: PromptPayloadFile[],
): PromptPayloadFile[] {
  return [...contextFiles].sort((left, right) => {
    const leftChurn = left.additions + left.deletions;
    const rightChurn = right.additions + right.deletions;
    if (leftChurn !== rightChurn) {
      return rightChurn - leftChurn;
    }

    return left.path.localeCompare(right.path);
  });
}

function truncateTextHead(input: string, maxCharacters: number): string {
  if (input.length <= maxCharacters) {
    return input;
  }
  if (maxCharacters <= 0) {
    return "";
  }

  const omittedChars = input.length - maxCharacters;
  const marker = `\n${buildOmissionMarker(omittedChars)}`;
  if (marker.length >= maxCharacters) {
    return input.slice(input.length - maxCharacters);
  }

  return `${input.slice(0, maxCharacters - marker.length)}${marker}`;
}

function normalizeComparablePath(pathValue: string): string {
  const normalized = normalizePath(pathValue);
  const posixStyle = normalized.split(win32.sep).join(posix.sep);
  return posix.normalize(posixStyle);
}

function truncatePatchWithOmission(
  input: string,
  maxCharacters: number,
): string {
  if (input.length <= maxCharacters) {
    return input;
  }
  if (maxCharacters <= 0) {
    return "";
  }

  let marker = buildOmissionMarker(Math.max(1, input.length - maxCharacters));
  for (let index = 0; index < 6; index += 1) {
    const available = maxCharacters - marker.length;
    if (available < 2) {
      return input.slice(0, maxCharacters);
    }

    const minimumEdgeCharacters = Math.min(8, Math.floor(available / 2));
    let startCharacters = Math.max(1, Math.floor(available / 2));
    let endCharacters = Math.max(1, available - startCharacters);
    if (startCharacters < minimumEdgeCharacters) {
      startCharacters = minimumEdgeCharacters;
      endCharacters = available - startCharacters;
    }
    if (endCharacters < minimumEdgeCharacters) {
      endCharacters = minimumEdgeCharacters;
      startCharacters = available - endCharacters;
    }
    const omittedChars = input.length - startCharacters - endCharacters;
    if (omittedChars <= 0) {
      return input.slice(0, maxCharacters);
    }

    const nextMarker = buildOmissionMarker(omittedChars);
    if (nextMarker === marker) {
      return `${input.slice(0, startCharacters)}${marker}${input.slice(
        input.length - endCharacters,
      )}`;
    }

    marker = nextMarker;
  }

  return input.slice(0, maxCharacters);
}

function compactPrimaryFiles(
  files: PromptPayloadFile[],
  budgets: ScopePromptBudgets,
): PromptPayloadFile[] {
  const maxLengths = files.map((file) => {
    if (file.patch === null) {
      return 0;
    }

    return Math.min(file.patch.length, budgets.maxPrimaryPatchCharsPerFile);
  });
  const totalCharacters = maxLengths.reduce(
    (total, length) => total + length,
    0,
  );
  if (totalCharacters <= budgets.maxPrimaryPatchCharsTotal) {
    return files.map((file, index) =>
      file.patch === null
        ? file
        : {
            ...file,
            patch: truncatePatchWithOmission(
              file.patch,
              maxLengths[index] ?? 0,
            ),
          },
    );
  }

  const minimumLengths = files.map((file, index) => {
    if (file.patch === null) {
      return 0;
    }

    const maxLength = maxLengths[index] ?? 0;
    const minimumTruncatedPatchCharacters = minimumPatchCharactersForOmission();
    if (file.patch.length <= minimumTruncatedPatchCharacters) {
      return Math.min(maxLength, file.patch.length);
    }

    return Math.min(maxLength, minimumTruncatedPatchCharacters);
  });

  const targetLengths = [...maxLengths];
  let remainingExcess = totalCharacters - budgets.maxPrimaryPatchCharsTotal;
  const reducible = files
    .map((file, index) => {
      const targetLength = targetLengths[index] ?? 0;
      const minimumLength = minimumLengths[index] ?? 0;
      return {
        index,
        path: file.path,
        available: Math.max(0, targetLength - minimumLength),
      };
    })
    .filter((entry) => entry.available > 0)
    .sort((left, right) => {
      const leftLength = targetLengths[left.index] ?? 0;
      const rightLength = targetLengths[right.index] ?? 0;
      if (leftLength !== rightLength) {
        return rightLength - leftLength;
      }

      return left.path.localeCompare(right.path);
    });

  for (const entry of reducible) {
    if (remainingExcess <= 0) {
      break;
    }

    const reduction = Math.min(entry.available, remainingExcess);
    targetLengths[entry.index] = (targetLengths[entry.index] ?? 0) - reduction;
    remainingExcess -= reduction;
  }

  if (remainingExcess > 0) {
    const fallbackReducible = files
      .map((file, index) => ({
        index,
        path: file.path,
      }))
      .filter(({ index }) => (targetLengths[index] ?? 0) > 1)
      .sort((left, right) => {
        const leftLength = targetLengths[left.index] ?? 0;
        const rightLength = targetLengths[right.index] ?? 0;
        if (leftLength !== rightLength) {
          return rightLength - leftLength;
        }

        return left.path.localeCompare(right.path);
      });

    for (const entry of fallbackReducible) {
      if (remainingExcess <= 0) {
        break;
      }

      const available = Math.max(0, (targetLengths[entry.index] ?? 0) - 1);
      const reduction = Math.min(available, remainingExcess);
      targetLengths[entry.index] =
        (targetLengths[entry.index] ?? 0) - reduction;
      remainingExcess -= reduction;
    }
  }

  return files.map((file, index) => {
    if (file.patch === null) {
      return file;
    }

    const lengthBudget = Math.max(1, targetLengths[index] ?? 1);
    return {
      ...file,
      patch: truncatePatchWithOmission(file.patch, lengthBudget),
    };
  });
}

function compactContextFiles(
  contextFiles: PromptPayloadFile[] | undefined,
  budgets: ScopePromptBudgets,
): PromptPayloadFile[] | undefined {
  if (!contextFiles || contextFiles.length === 0) {
    return undefined;
  }

  const selected = sortContextFilesByPriority(contextFiles).slice(
    0,
    budgets.maxContextFiles,
  );
  if (selected.length === 0) {
    return undefined;
  }

  if (budgets.maxContextPatchCharsTotal <= 0) {
    return selected.map((file) => ({
      ...file,
      patch: null,
    }));
  }

  let remainingBudget = budgets.maxContextPatchCharsTotal;
  return selected.map((file) => {
    if (file.patch === null) {
      return file;
    }

    const allowed = Math.max(0, Math.min(file.patch.length, remainingBudget));
    remainingBudget = Math.max(0, remainingBudget - allowed);
    return {
      ...file,
      patch:
        allowed === 0
          ? null
          : truncatePatchWithOmission(file.patch, Math.max(1, allowed)),
    };
  });
}

function isMemoryRelevantToChunk(
  memoryPath: string,
  chunkPaths: Set<string>,
): boolean {
  const normalizedMemoryPath = normalizeComparablePath(memoryPath);
  for (const path of chunkPaths) {
    const normalizedPath = normalizeComparablePath(path);
    if (
      normalizedPath === normalizedMemoryPath ||
      normalizedPath.startsWith(`${normalizedMemoryPath}/`)
    ) {
      return true;
    }
  }

  return false;
}

export class PromptPayloadOptimizer {
  optimize(input: {
    scope: ReviewScope;
    mode: PromptOptimizationMode;
    files: PromptPayloadFile[];
    contextFiles?: PromptPayloadFile[];
    instructionText: string;
    memory: PromptPayloadMemoryEntry[];
  }): {
    files: PromptPayloadFile[];
    contextFiles?: PromptPayloadFile[];
    instructionText: string;
    memory: PromptPayloadMemoryEntry[];
  } {
    if (input.mode === "off") {
      return {
        files: input.files.map((file) => ({ ...file })),
        ...(input.contextFiles
          ? {
              contextFiles: input.contextFiles.map((file) => ({ ...file })),
            }
          : {}),
        instructionText: input.instructionText,
        memory: input.memory.map((entry) =>
          entry.path
            ? {
                path: entry.path,
                summary: entry.summary,
              }
            : {
                summary: entry.summary,
              },
        ),
      };
    }

    const scopeBudgets = balancedScopeBudgets[input.scope];
    const optimizedContextFiles = input.contextFiles
      ? compactContextFiles(input.contextFiles, scopeBudgets)
      : undefined;
    return {
      files: compactPrimaryFiles(input.files, scopeBudgets),
      ...(optimizedContextFiles === undefined
        ? {}
        : { contextFiles: optimizedContextFiles }),
      instructionText: truncateTextHead(
        input.instructionText,
        sharedPromptBudgets.maxInstructionChars,
      ),
      memory: input.memory.map((entry) =>
        entry.path
          ? {
              path: entry.path,
              summary: entry.summary,
            }
          : {
              summary: entry.summary,
            },
      ),
    };
  }

  selectChunkMemory(input: {
    mode: PromptOptimizationMode;
    files: PromptPayloadFile[];
    memory: PromptPayloadMemoryEntry[];
  }): PromptPayloadMemoryEntry[] {
    if (input.mode === "off") {
      return input.memory.map((entry) =>
        entry.path
          ? {
              path: entry.path,
              summary: entry.summary,
            }
          : {
              summary: entry.summary,
            },
      );
    }

    const chunkPaths = new Set(input.files.map((file) => file.path));
    const matchingMemory = input.memory.filter(
      (entry) =>
        typeof entry.path === "string" &&
        isMemoryRelevantToChunk(entry.path, chunkPaths),
    );
    const globalMemory = input.memory.filter(
      (entry) => entry.path === undefined,
    );
    const orderedMemory = [...matchingMemory, ...globalMemory];

    const selected: PromptPayloadMemoryEntry[] = [];
    let consumedCharacters = 0;
    for (const entry of orderedMemory) {
      if (selected.length >= sharedPromptBudgets.maxMemoryEntriesPerChunk) {
        break;
      }

      const remainingCharacters =
        sharedPromptBudgets.maxMemoryCharsPerChunk - consumedCharacters;
      if (remainingCharacters <= 0) {
        break;
      }

      const candidateCharacters = memoryEntryChars(entry);
      if (candidateCharacters <= remainingCharacters) {
        selected.push(
          entry.path
            ? {
                path: entry.path,
                summary: entry.summary,
              }
            : {
                summary: entry.summary,
              },
        );
        consumedCharacters += candidateCharacters;
        continue;
      }

      const summaryBudget = remainingCharacters - (entry.path?.length ?? 0);
      if (summaryBudget <= 0) {
        break;
      }

      const truncated = truncateTextHead(entry.summary, summaryBudget).trim();
      if (truncated.length === 0) {
        break;
      }

      const compactEntry = entry.path
        ? {
            path: entry.path,
            summary: truncated,
          }
        : {
            summary: truncated,
          };
      selected.push(compactEntry);
      consumedCharacters += memoryEntryChars(compactEntry);
      break;
    }

    return selected;
  }

  estimatePromptUsage(input: {
    chunks: PromptPayloadFile[][];
    contextFiles?: PromptPayloadFile[];
    instructionText: string;
    chunkMemory: PromptPayloadMemoryEntry[][];
  }): PromptUsageSnapshot {
    const chunkCount = input.chunks.length;
    const primaryPatchChars = input.chunks.reduce(
      (total, chunk) =>
        total +
        chunk.reduce(
          (chunkTotal, file) => chunkTotal + patchChars(file.patch),
          0,
        ),
      0,
    );
    const contextPatchChars =
      (input.contextFiles ?? []).reduce(
        (total, file) => total + patchChars(file.patch),
        0,
      ) * chunkCount;
    const instructionChars = input.instructionText.length * chunkCount;
    const memoryChars = input.chunkMemory.reduce(
      (total, entries) =>
        total +
        entries.reduce(
          (entryTotal, entry) => entryTotal + memoryEntryChars(entry),
          0,
        ),
      0,
    );
    const estimatedPromptTokens = Math.ceil(
      (primaryPatchChars + contextPatchChars + instructionChars + memoryChars) /
        4,
    );

    return {
      chunkCount,
      primaryPatchChars,
      contextPatchChars,
      instructionChars,
      memoryChars,
      estimatedPromptTokens,
    };
  }
}
