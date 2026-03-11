// Diagnostic policies used by publisher error sanitization:
// - `MAX_SERIALIZED_LENGTH` bounds pre-sanitize payload size.
// - `SANITIZED_MAX_LENGTH` bounds final ASCII log string length.
// - `MAX_STRING_LENGTH` matches sanitized length intentionally so per-field
//   truncation and final truncation stay aligned.
// - canonical truncation markers are lowercase for consistent log searching.
// - marker casing changed from `[Truncated]` to `[truncated]`; treat that as
//   a breaking change and document it in consumer-facing release notes.
// - deprecated aliases remain exported for compatibility during migration.
// - the `VARIANTS` list and `SET` export preserve backward-compatible marker
//   detection for code that still sees legacy literals.
export const DIAGNOSTIC_MAX_SERIALIZED_LENGTH = 1_000;
export const DIAGNOSTIC_SANITIZED_MAX_LENGTH = 200;
export const DIAGNOSTIC_MAX_STRING_LENGTH = DIAGNOSTIC_SANITIZED_MAX_LENGTH;
export const DIAGNOSTIC_OBJECT_BUDGET = 200;
export const DIAGNOSTIC_ELLIPSIS_TRUNCATION_MARKER = "...[truncated]";
export const DIAGNOSTIC_OBJECT_TRUNCATION_MARKER = "[truncated]";
export const DIAGNOSTIC_OBJECT_TRUNCATION_MARKER_DEPRECATED = "[Truncated]";
export const DIAGNOSTIC_OBJECT_TRUNCATION_MARKER_VARIANTS = [
  DIAGNOSTIC_OBJECT_TRUNCATION_MARKER,
  DIAGNOSTIC_OBJECT_TRUNCATION_MARKER_DEPRECATED,
] as const;
export const DIAGNOSTIC_OBJECT_TRUNCATION_MARKER_SET: ReadonlySet<string> =
  new Set(DIAGNOSTIC_OBJECT_TRUNCATION_MARKER_VARIANTS);
