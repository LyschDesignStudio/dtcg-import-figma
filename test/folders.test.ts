/* The plugin finds the folders that hold tokens, and what each is, from the repository's paths alone. */

import { describe, expect, it } from "vitest";
import { findTokenFolders } from "../src/detect";
import { readFolder } from "../src/readers/files";
import { mappingDoubts, suggestMapping } from "../src/readers/mapped";
import { fixtureTexts } from "./fixtures";

describe("dtcg format (folders)", () => {
  it("dtcg format: finds the folders that hold tokens, and which layout each is", () => {
    const paths = [
      "README.md", "tokens/sys/color.json", "tokens/ref/color.json", "design-system.json",
      ...Object.keys(fixtureTexts("resolver")).map((p) => `design/dtcg/${p}`),
      ...Object.keys(fixtureTexts("tokens-studio")).map((p) => `design/dtcg-studio/${p}`),
      ...Object.keys(fixtureTexts("mapped-files")).map((p) => `design/dtcg-mapped/${p}`),
      "node_modules/x/a.tokens.json", ".github/a.tokens.json",
    ];
    expect(findTokenFolders(paths)).toEqual([
      { folder: "design/dtcg", kind: "resolver" },
      { folder: "design/dtcg-studio", kind: "tokens-studio" },
      { folder: "design/dtcg-mapped", kind: "mapped" },
    ]);
    expect(findTokenFolders(["a/b/x.tokens.json", "a/y.tokens.json"])).toEqual([{ folder: "a", kind: "mapped" }]);
    expect(findTokenFolders(["README.md"])).toEqual([]);
  });

  it("dtcg mapped: assumes what the names say, and asks only what they don't", () => {
    const files = readFolder(fixtureTexts("mapped-files"));
    const m = suggestMapping(files);
    /* brand.premium alone: a context of brand, the base being its default. */
    expect(m.files["brand.premium.tokens.json"]).toEqual({ kind: "context", axis: "brand", context: "premium" });
    expect(m.axes!.brand).toEqual({ contexts: ["default", "premium"], default: "default" });
    expect(mappingDoubts(files, m)).toEqual({ files: [], axes: [] });
    const odd = readFolder({ ...fixtureTexts("mapped-files"), "vip.extra.tokens.json": JSON.stringify({ x: { $type: "number", $value: 1 } }) });
    expect(mappingDoubts(odd, suggestMapping(odd)).files).toEqual(["vip.extra.tokens.json"]);
  });
});
