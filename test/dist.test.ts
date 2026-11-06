/* The built plugin in dist/, as a download of the repository holds it: the
   files the manifest names exist, the UI is one self-contained HTML file, and
   dist/code.js (not the source) runs in a Figma-like sandbox and imports a
   repository's tokens. dist/ is committed: after a source change, run
   `npm run build` and commit it, or this test fails on stale output. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAndPlan } from "../src/detect";
import { FakeFigma } from "./fake-figma";
import { fixtureTexts } from "./fixtures";

const root = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

describe("dist", () => {
  it("dist: the files the manifest names exist", () => {
    expect(existsSync(join(root, manifest.main))).toBe(true);
    expect(existsSync(join(root, manifest.ui))).toBe(true);
  });

  it("dist: ui.html loads nothing from outside: no script src, no stylesheet link", () => {
    const html = readFileSync(join(root, manifest.ui), "utf8");
    /* Only the document's own tags: the inlined script's text is left out (it holds strings that look like tags). */
    const tags = html.replace(/<script type="module">[\s\S]*?<\/script>/g, "<script></script>").replace(/<style>[\s\S]*?<\/style>/g, "<style></style>");
    expect(tags).not.toMatch(/<script[^>]*\ssrc=/);
    expect(tags).not.toMatch(/<link[\s>]/);
    expect(tags).toMatch(/<div id="root">/);
    expect(html).toMatch(/<script type="module">[\s\S]{100000,}<\/script>/);
  });

  it("dist: code.js runs in a Figma-like sandbox, answers the UI's calls and imports the tokens", async () => {
    const fig = new FakeFigma();
    const posted: Record<string, unknown>[] = [];
    let shown: { html: string; options: unknown } | null = null;
    const ui = { postMessage: (m: Record<string, unknown>) => void posted.push(m), onmessage: null as null | ((m: unknown) => Promise<void>), resize: () => {} };
    const figma = Object.assign(fig.api, { ui, showUI: (html: string, options: unknown) => void (shown = { html, options }) });
    new Function("figma", "__html__", readFileSync(join(root, manifest.main), "utf8"))(figma, "<html>ui</html>");
    expect(shown).toEqual({ html: "<html>ui</html>", options: { width: 420, height: 640, themeColors: true } });
    expect(typeof ui.onmessage).toBe("function");

    const callMain = async (id: number, method: string, params?: unknown) => {
      await ui.onmessage!({ type: "call", id, method, params });
      return posted.find((m) => m.type === "reply" && m.id === id) as { ok: boolean; data?: unknown; error?: string };
    };
    expect(await callMain(1, "dtcgLink")).toEqual({ type: "reply", id: 1, ok: true, data: null });

    const { plan, read } = readAndPlan(fixtureTexts("resolver"), { format: "resolver", remBase: 16, name: "tokens" });
    const link = { v: 1, repo: { owner: "acme", name: "tokens", folder: "tokens" }, branch: "main", format: "resolver", remBase: 16, library: false, adopt: false, name: "tokens", baseSha: "abc" };
    const r = await callMain(2, "dtcgApply", { plan, link, adopt: false, figmaRefs: read.figmaRefs });
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect((r.data as { incomplete: boolean }).incomplete).toBe(false);
    expect(fig.collections.map((c) => c.name)).toEqual(["Primitives", "Mode", "Viewport", "Semantic"]);
    expect(fig.variables.length).toBe(plan.variables.length);
    expect(fig.textStyles.length).toBe(plan.textStyles.length);
    expect(posted.some((m) => m.type === "progress")).toBe(true);
    /* The link is kept in the file, under the plugin's namespace. */
    expect((await callMain(3, "dtcgLink")).data).toMatchObject({ repo: link.repo, baseSha: "abc" });
    /* An unknown method is an error reply, not a crash. */
    expect((await callMain(4, "nope")).ok).toBe(false);
  });
});
