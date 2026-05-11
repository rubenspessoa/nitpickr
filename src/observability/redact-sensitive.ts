// Defensive scrubber for objects we hand to external sinks (Sentry events,
// log fields, etc.). Walks **plain** objects/arrays recursively, replacing
// the values of keys that look sensitive with "[redacted]". Returns a fresh
// copy so the caller's object isn't mutated.
//
// Guards:
//   - Max recursion depth (6). Beyond the limit we return "[truncated]" so a
//     deeply-nested value can't sneak past the redactor as-is.
//   - WeakSet of seen objects to short-circuit circular references.
//   - Non-plain objects (Map/Set/Date/Buffer/class instances) are passed
//     through unchanged so downstream serialization handles them correctly
//     — Object.entries() on a Map returns []; walking those would silently
//     drop the data.

const MAX_DEPTH = 6;

const SENSITIVE_TOKENS = new Set([
  "apikey",
  "apikeys",
  "privatekey",
  "privatekeys",
  "webhooksecret",
  "webhooksecrets",
  "authorization",
  "secret",
  "secrets",
  "password",
  "passwords",
  "token",
  "tokens",
]);

function tokenizeKey(key: string): string[] {
  // camelCase boundary → underscore, then split on - or _
  return key
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_-]+/)
    .filter((token) => token.length > 0);
}

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (SENSITIVE_TOKENS.has(normalized)) {
    return true;
  }
  // "API_KEY" / "api-key" → "apikey"
  const compact = normalized.replace(/[_-]+/g, "");
  if (SENSITIVE_TOKENS.has(compact)) {
    return true;
  }

  const tokens = tokenizeKey(key);
  for (const token of tokens) {
    if (SENSITIVE_TOKENS.has(token)) {
      return true;
    }
  }
  // Compound terms split across two tokens, e.g. "api_key" → ["api","key"] → "apikey".
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (SENSITIVE_TOKENS.has(`${tokens[i]}${tokens[i + 1]}`)) {
      return true;
    }
  }
  return false;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function redactSensitive(value: unknown): unknown {
  return redact(value, 0, new WeakSet());
}

function redact(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_DEPTH) {
    return "[truncated]";
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[circular]";
    }
    seen.add(value);
    return value.map((entry) => redact(entry, depth + 1, seen));
  }
  // Map/Set/Date/Buffer/class instances: pass through so the downstream
  // serializer (Sentry's normalizer, JSON.stringify, etc.) handles them.
  if (!isPlainObject(value)) {
    return value;
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      result[key] = "[redacted]";
      continue;
    }
    result[key] = redact(raw, depth + 1, seen);
  }
  return result;
}
