export interface FindingFingerprintInput {
  path: string;
  line: number;
  category: string;
  title: string;
}

export function fingerprintFinding(input: FindingFingerprintInput): string {
  return [
    input.path.trim().toLowerCase(),
    input.line,
    input.category,
    input.title.trim().toLowerCase().replace(/\s+/g, "_"),
  ].join(":");
}
