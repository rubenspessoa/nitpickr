import { describe, expect, it } from "vitest";

import {
  flagBoolean,
  flagInteger,
  flagString,
  parseArgs,
} from "../../src/cli/args.js";

describe("parseArgs", () => {
  it("parses switches, flag values, equals form, and positionals", () => {
    const args = parseArgs([
      "owner/repo#12",
      "--live",
      "--model",
      "qwen3.6:35b-a3b-nvfp4",
      "--out=report.json",
      "--timeout-ms",
      "5000",
    ]);

    expect(args.positionals).toEqual(["owner/repo#12"]);
    expect(flagBoolean(args, "live")).toBe(true);
    expect(flagBoolean(args, "missing")).toBe(false);
    expect(flagString(args, "model")).toBe("qwen3.6:35b-a3b-nvfp4");
    expect(flagString(args, "out")).toBe("report.json");
    expect(flagInteger(args, "timeout-ms")).toBe(5000);
    expect(flagString(args, "live")).toBeUndefined();
  });

  it("rejects non-positive integers", () => {
    expect(() => flagInteger(parseArgs(["--n", "0"]), "n")).toThrow(
      /positive integer/,
    );
  });
});
