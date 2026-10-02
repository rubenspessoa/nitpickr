import { describe, expect, it, vi } from "vitest";

import {
  type EmbeddingPipelineLoader,
  LocalMemoryEmbedder,
} from "../../src/memory/local-memory-embedder.js";

function fakeLoader(dimensions: number, seen: string[] = []) {
  return vi.fn<EmbeddingPipelineLoader>(async () => async (text) => {
    seen.push(text);
    return Array.from({ length: dimensions }, () => 0.1);
  });
}

describe("LocalMemoryEmbedder", () => {
  it("adds nomic task prefixes for stored memories and search queries", async () => {
    const seen: string[] = [];
    const embedder = new LocalMemoryEmbedder(
      { model: "nomic-ai/nomic-embed-text-v1.5", expectedDimensions: 768 },
      fakeLoader(768, seen),
    );

    await embedder.embed("Prefer zod for input validation", "document");
    await embedder.embed("retry helper without jitter", "query");

    expect(seen).toEqual([
      "search_document: Prefer zod for input validation",
      "search_query: retry helper without jitter",
    ]);
  });

  it("sends text unchanged for models without task prefixes", async () => {
    const seen: string[] = [];
    const embedder = new LocalMemoryEmbedder(
      { model: "Xenova/all-MiniLM-L6-v2", expectedDimensions: 384 },
      fakeLoader(384, seen),
    );

    await embedder.embed("hello", "query");

    expect(seen).toEqual(["hello"]);
  });

  it("loads the model once and reuses it", async () => {
    const loader = fakeLoader(768);
    const embedder = new LocalMemoryEmbedder(
      { model: "nomic-ai/nomic-embed-text-v1.5", expectedDimensions: 768 },
      loader,
    );

    await Promise.all([embedder.embed("a"), embedder.embed("b")]);
    await embedder.embed("c");

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("rejects vectors that do not match the configured column width", async () => {
    const embedder = new LocalMemoryEmbedder(
      { model: "nomic-ai/nomic-embed-text-v1.5", expectedDimensions: 1536 },
      fakeLoader(768),
    );

    await expect(embedder.embed("a")).rejects.toThrow(
      /768 dimensions but NITPICKR_EMBEDDING_DIMENSIONS is 1536/,
    );
  });

  it("retries loading after a failed model load", async () => {
    const loader = vi
      .fn<EmbeddingPipelineLoader>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(async () => Array.from({ length: 768 }, () => 0));
    const embedder = new LocalMemoryEmbedder(
      { model: "nomic-ai/nomic-embed-text-v1.5", expectedDimensions: 768 },
      loader,
    );

    await expect(embedder.embed("a")).rejects.toThrow("network down");
    await expect(embedder.embed("a")).resolves.toHaveLength(768);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
