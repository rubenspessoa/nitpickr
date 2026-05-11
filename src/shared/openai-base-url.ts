export function normalizeOpenAiBaseUrl(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}
