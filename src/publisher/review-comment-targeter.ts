export interface ReviewCommentTargetInput {
  requestedLine: number;
  patch: string | null;
  maxLineDistance?: number;
}

function extractChangedLines(patch: string): number[] {
  const changedLines: number[] = [];
  const lines = patch.split("\n");
  let newLine = 0;
  let inHunk = false;

  for (const line of lines) {
    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch) {
      newLine = Number(hunkMatch[1]);
      inHunk = true;
      continue;
    }

    if (!inHunk || line.length === 0) {
      continue;
    }

    const marker = line[0];
    if (marker === "+") {
      changedLines.push(newLine);
      newLine += 1;
      continue;
    }

    if (marker === " ") {
      newLine += 1;
    }
  }

  return changedLines;
}

export function targetReviewCommentLine(
  input: ReviewCommentTargetInput,
): number | null {
  if (input.patch === null) {
    return null;
  }

  const changedLines = extractChangedLines(input.patch);
  if (changedLines.length === 0) {
    return null;
  }

  if (changedLines.includes(input.requestedLine)) {
    return input.requestedLine;
  }

  const maxLineDistance = input.maxLineDistance ?? 3;
  let closestLine: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const changedLine of changedLines) {
    const distance = Math.abs(changedLine - input.requestedLine);
    if (distance < closestDistance) {
      closestLine = changedLine;
      closestDistance = distance;
    }
  }

  if (closestDistance > maxLineDistance) {
    return null;
  }

  return closestLine;
}
