import { z } from "zod";

/**
 * A timestamptz column as an ISO-8601 string. The postgres driver returns
 * `Date` objects, while fakes and JSON payloads use strings; accept both.
 */
export const isoTimestampSchema = z
  .union([z.string().min(1), z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));
