import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EvalCaptureCommand,
  parsePullReference,
} from "../../src/cli/eval-capture-command.js";

describe("parsePullReference", () => {
  it("accepts owner/repo#N and pull URLs", () => {
    expect(parsePullReference("acme/widgets#12")).toEqual({
      owner: "acme",
      repo: "widgets",
      number: 12,
    });
    expect(
      parsePullReference("https://github.com/acme/widgets/pull/7"),
    ).toEqual({ owner: "acme", repo: "widgets", number: 7 });
    expect(() => parsePullReference("nope")).toThrow(/owner\/repo#123/);
  });
});

describe("EvalCaptureCommand", () => {
  it("writes a live fixture with patches and file content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nitpickr-capture-"));
    const requested: string[] = [];
    const lines: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/pulls/5")) {
        return Response.json({ title: "Fix pager", head: { sha: "abc" } });
      }
      if (url.includes("/pulls/5/files")) {
        return Response.json([
          {
            filename: "src/pager.ts",
            status: "modified",
            additions: 3,
            deletions: 1,
            patch: "@@ -1 +1 @@\n+x",
          },
          {
            filename: "old.ts",
            status: "removed",
            additions: 0,
            deletions: 9,
          },
        ]);
      }
      if (url.includes("/contents/src/pager.ts")) {
        return Response.json({
          encoding: "base64",
          size: 5,
          content: Buffer.from("hello").toString("base64"),
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const outPath = await new EvalCaptureCommand().run({
      reference: "acme/widgets#5",
      token: "t",
      outDirectory: dir,
      fetchFn,
      write: (line) => lines.push(line),
    });

    const fixture = JSON.parse(await readFile(outPath, "utf8"));
    expect(fixture.name).toBe("acme-widgets-5-fix-pager");
    expect(fixture.source).toBe("https://github.com/acme/widgets/pull/5");
    expect(fixture.input.files).toEqual([
      {
        path: "src/pager.ts",
        additions: 3,
        deletions: 1,
        patch: "@@ -1 +1 @@\n+x",
        fileContent: "hello",
      },
      {
        path: "old.ts",
        additions: 0,
        deletions: 9,
        patch: null,
        fileContent: null,
      },
    ]);
    expect(fixture.expectedFindings).toEqual([]);
    expect(requested.some((url) => url.includes("ref=abc"))).toBe(true);
    expect(requested.some((url) => url.includes("/contents/old.ts"))).toBe(
      false,
    );
  });
});
