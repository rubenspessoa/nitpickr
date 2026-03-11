// Diagnostic policies used by publisher error sanitization:
// - `MAX_SERIALIZED_LENGTH` bounds pre-sanitize payload size.
// - `SANITIZED_MAX_LENGTH` bounds final ASCII log string length.
// - `MAX_STRING_LENGTH` matches sanitized length intentionally so per-field
//   truncation and final truncation stay aligned.
// - truncation markers are lowercase for consistent log searching.
// - marker casing changed from `[Truncated]` to `[truncated]`; treat that as
//   a breaking change and document it in consumer-facing release notes.
export const DIAGNOSTIC_MAX_SERIALIZED_LENGTH = 1_000;
export const DIAGNOSTIC_SANITIZED_MAX_LENGTH = 200;
export const DIAGNOSTIC_MAX_STRING_LENGTH = DIAGNOSTIC_SANITIZED_MAX_LENGTH;
export const DIAGNOSTIC_OBJECT_BUDGET = 200;
export const DIAGNOSTIC_ELLIPSIS_TRUNCATION_MARKER = "...[truncated]";
export const DIAGNOSTIC_OBJECT_TRUNCATION_MARKER = "[truncated]";
export const DIAGNOSTIC_OBJECT_TRUNCATION_MARKER_DEPRECATED = "[Truncated]";
