/** Trim trailing slashes and make sure the URL ends in the `/v1` API prefix. */
export function normalizeModelBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}
