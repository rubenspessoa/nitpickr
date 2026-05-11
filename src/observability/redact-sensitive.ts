// Defensive scrubber for objects we hand to external sinks (Sentry events,
// log fields, etc.). Walks the structure recursively, replacing the values
// of keys that look sensitive with "[redacted]". Returns a fresh copy so the
// caller's object isn't mutated.
//
// Guards: max recursion depth (6) + WeakSet of seen objects to short-circuit
// circular references.

const SENSITIVE_KEY_PATTERN =
  /api[_-]?key|private[_-]?key|webhook[_-]?secret|authorization|secret/i;

const MAX_DEPTH = 6;

export function redactSensitive(value: unknown): unknown {
  return redact(value, 0, new WeakSet());
}

function redact(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_DEPTH) {
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[circular]";
    }
    seen.add(value);
    return value.map((entry) => redact(entry, depth + 1, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[circular]";
    }
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = "[redacted]";
        continue;
      }
      result[key] = redact(raw, depth + 1, seen);
    }
    return result;
  }
  return value;
}
