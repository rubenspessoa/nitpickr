import { Agent, fetch as undiciFetch } from "undici";

export type FetchLike = typeof fetch;

/**
 * Build a `fetch` whose *whole* request may take up to `timeoutMs`.
 *
 * Node's built-in fetch uses undici defaults of 300 s for `headersTimeout` and
 * `bodyTimeout`. Non-streaming model servers (Ollama, vLLM, OpenAI without
 * `stream`) send no headers until generation is complete, so a slow local
 * model fails with a bare "fetch failed" at ~300 s no matter what
 * `AbortSignal` the caller passes. This wrapper routes through an undici Agent
 * with the timeouts raised to `timeoutMs`, and additionally aborts at
 * `timeoutMs` so the ceiling holds even when data trickles in.
 */
export function createTimeoutFetch(timeoutMs: number): FetchLike {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive number.");
  }
  const dispatcher = new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    connectTimeout: Math.min(timeoutMs, 30_000),
  });

  const timeoutFetch = async (
    input: Parameters<FetchLike>[0],
    init?: Parameters<FetchLike>[1],
  ): Promise<Response> => {
    const signal = init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    const response = await undiciFetch(
      input as Parameters<typeof undiciFetch>[0],
      {
        ...(init as Parameters<typeof undiciFetch>[1]),
        signal,
        dispatcher,
      },
    );
    // undici's Response and the global Response are the same shape at runtime.
    return response as unknown as Response;
  };

  return timeoutFetch as FetchLike;
}

/** True for abort-by-timeout and undici header/body/connect timeouts. */
export function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return true;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return (
      cause.name === "TimeoutError" ||
      code === "UND_ERR_HEADERS_TIMEOUT" ||
      code === "UND_ERR_BODY_TIMEOUT" ||
      code === "UND_ERR_CONNECT_TIMEOUT"
    );
  }
  return false;
}
