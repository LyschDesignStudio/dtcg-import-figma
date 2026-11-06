/* The plugin never writes to GitHub: every request in the source is a GET to
   api.github.com, and the manifest allows that domain only. */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? sources(full) : /\.tsx?$/.test(name) ? [full] : [];
  });

describe("read only", () => {
  it("read only: the source makes no request but a GET", () => {
    const all = sources(join(root, "src")).map((f) => [f, readFileSync(f, "utf8")] as const);
    const fetches = all.flatMap(([f, s]) => [...s.matchAll(/fetch\(/g)].map(() => f));
    expect(fetches.map((f) => f.slice(root.length + 1))).toEqual(["src/github.ts"]);
    for (const [, s] of all) expect(s).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
    expect(readFileSync(join(root, "src/github.ts"), "utf8")).toMatch(/method: "GET"/);
  });

  it("read only: the manifest allows api.github.com only, with no permission it doesn't use", () => {
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    expect(manifest.networkAccess.allowedDomains).toEqual(["https://api.github.com"]);
    expect(manifest.networkAccess.devAllowedDomains).toBeUndefined();
    expect(manifest.permissions ?? []).toEqual([]);
  });
});
