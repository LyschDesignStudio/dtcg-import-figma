/* A file following a DTCG repository on a fake GitHub, read only. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeHandlers, type Handlers } from "../src/handlers";
import { FakeFigma } from "./fake-figma";
import { FakeGitHub } from "./fake-github";
import { fixtureTexts, MAPPINGS } from "./fixtures";

let handlers: Handlers;
vi.mock("../src/ui/bridge", () => ({
  call: (method: string, params: unknown) => Promise.resolve((handlers as unknown as Record<string, (p: unknown) => unknown>)[method](params)),
  onProgress: () => () => {},
}));
const { DtcgGitHub, GitHubError } = await import("../src/github");
const { DtcgSync, report } = await import("../src/sync");
const { needsChoice } = await import("../src/detect");

const FOLDER = "design/tokens";
let fig: FakeFigma;
let gh: FakeGitHub;
let sync: InstanceType<typeof DtcgSync>;
const repo = { owner: "acme", name: "tokens", folder: FOLDER };

function setup(texts = fixtureTexts("resolver"), folder = FOLDER) {
  fig = new FakeFigma();
  handlers = makeHandlers(fig.api, () => {});
  gh = new FakeGitHub(folder ? `${folder}/` : "", texts);
  vi.stubGlobal("fetch", gh.fetch);
  sync = new DtcgSync(new DtcgGitHub({ ...repo, folder }, "tkn"));
}
const linked = async () => {
  const s = await sync.state();
  if (s.kind !== "linked") throw new Error("not linked");
  return s;
};
const linkResolver = async (branch = "trunk") => sync.link(await sync.inspect(branch), { format: "resolver", remBase: 16 }, false);
const fileOf = (path: string) => `${FOLDER}/${path}`;
const editJson = (path: string, change: (tree: Record<string, any>) => void, branch = "trunk") => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const head = gh.commits.get(gh.branches.get(branch)!)!.files[fileOf(path)];
  const tree = JSON.parse(head);
  change(tree);
  gh.edit(branch, fileOf(path), JSON.stringify(tree, null, 2));
};

beforeEach(() => setup());
afterEach(() => vi.unstubAllGlobals());

describe("dtcg connect", () => {
  it("dtcg connect: a token with only Contents read connects, with no write call", async () => {
    const c = await sync.gh.connect();
    expect(c).toEqual({ login: "octo", defaultBranch: "trunk" });
    const r = await linkResolver();
    expect(r.incomplete).toBe(false);
    expect(fig.collections.map((x) => x.name)).toEqual(["Primitives", "Mode", "Viewport", "Semantic"]);
    expect(gh.requests.filter((q) => q.method !== "GET")).toEqual([]);
    expect(gh.requests.every((q) => q.auth === "Bearer tkn")).toBe(true);
    /* The tree is read from the folder's own, not the whole repository. */
    expect(gh.requests.some((q) => /\/git\/trees\/[0-9a-f]+\?recursive=1/.test(q.path))).toBe(true);
  });

  it("dtcg connect: a public repository needs no token, and no Authorization header is sent", async () => {
    sync = new DtcgSync(new DtcgGitHub(repo));
    expect(await sync.gh.connect()).toEqual({ login: "", defaultBranch: "trunk" });
    await linkResolver();
    expect(fig.variables.length).toBeGreaterThan(30);
    expect(gh.requests.every((q) => q.auth === null)).toBe(true);
    expect(gh.requests.some((q) => q.path === "/user")).toBe(false);
  });

  it("dtcg connect: a private repository without a token says a token is needed", async () => {
    gh.private = true;
    await expect(new DtcgGitHub(repo).connect()).rejects.toThrow(/If the repository is private, add a fine-grained token with Contents: read/);
    await expect(new DtcgGitHub(repo, "tkn").connect()).resolves.toMatchObject({ defaultBranch: "trunk" });
  });

  it("dtcg connect: follows the branch the designer picks, the default one preselected", async () => {
    gh.branches.set("next", gh.branches.get("trunk")!);
    editJson("dimension.tokens.json", (d) => (d.spacing["100"].$value.value = 5), "next");
    expect((await sync.gh.branches())[0]).toBe("trunk");
    await linkResolver("next");
    const s = await linked();
    expect(s.link.branch).toBe("next");
    expect(s.status.status).toBe("in-step");
    expect(fig.variable("spacing/100").valuesByMode[fig.collection("Primitives").modes[0].modeId]).toBe(5);
  });

  it("dtcg connect: walks subfolders when GitHub truncates the folder's tree", async () => {
    gh.truncateOver = 5;
    await linkResolver();
    expect(fig.variables.length).toBeGreaterThan(30);
  });

  const failing = async (status: number, message: string, headers: Record<string, string> = {}) => {
    gh.failures.push({ match: /^GET \/repos\/acme\/tokens$/, status, message, headers, times: 1 });
    try {
      await new DtcgGitHub(repo, "tkn").connect();
    } catch (e) {
      return e as InstanceType<typeof GitHubError>;
    }
    throw new Error("connected");
  };

  it("dtcg connect: tells an SSO authorization apart", async () => {
    const e = await failing(403, "Resource protected by organization SAML enforcement.", { "x-github-sso": "required; url=https://github.com/orgs/acme/sso?authorization_request=abc" });
    expect(e.kind).toBe("sso");
    expect(e.message).toMatch(/isn't authorized for acme's single sign-on.*Configure SSO.*https:\/\/github\.com\/orgs\/acme\/sso/);
  });

  it("dtcg connect: tells an organization's approval or policy apart", async () => {
    const e = await failing(403, "Although you appear to have the correct authorization credentials, the `acme` organization has blocked access via a fine-grained personal access token pending approval.");
    expect(e.kind).toBe("policy");
    expect(e.message).toMatch(/acme hasn't approved this token yet, or its policy blocks it/);
  });

  it("dtcg connect: tells an expired token apart", async () => {
    const e = await failing(401, "Bad credentials");
    expect(e.kind).toBe("expired");
    expect(e.message).toMatch(/expired or was revoked/);
  });

  it("dtcg connect: tells a repository or folder not found apart", async () => {
    const e = await failing(404, "Not Found");
    expect(e.kind).toBe("not_found");
    expect(e.message).toMatch(/The repository acme\/tokens wasn't found/);
    const missing = new DtcgSync(new DtcgGitHub({ ...repo, folder: "nope" }, "tkn"));
    await expect(missing.inspect("trunk")).rejects.toThrow(/There is no folder nope in acme\/tokens/);
  });

  it("dtcg connect: tells the rate limit apart, with when it resets", async () => {
    const reset = Math.floor(new Date(2026, 10, 4, 15, 42).getTime() / 1000);
    const e = await failing(403, "API rate limit exceeded for user.", { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) });
    expect(e.kind).toBe("rate_limit");
    expect(e.message).toMatch(/rate limit was reached; it resets at 15:42/);
    const retry = await failing(429, "secondary", { "retry-after": "60" });
    expect(retry.kind).toBe("rate_limit");
    /* Without a token, the message says a token raises the limit. */
    gh.failures.push({ match: /^GET \/repos\/acme\/tokens$/, status: 403, message: "API rate limit exceeded", headers: { "x-ratelimit-remaining": "0" }, times: 1 });
    await expect(new DtcgGitHub(repo).connect()).rejects.toThrow(/60 requests an hour/);
  });
});

describe("dtcg format (repository)", () => {
  it("dtcg format: lets the designer choose when more than one fits, or none, and keeps the choice in the link", async () => {
    const i = await sync.inspect("trunk");
    expect(i.detection.candidates).toEqual(["resolver", "mapped"]);
    expect(needsChoice(i.detection)).toBe(true);
    /* Chosen: mapped, though a resolver is there. Kept in the link. */
    await sync.link(i, { format: "mapped", mapping: i.suggestion, remBase: 16 }, false);
    const s = await linked();
    expect(s.link.format).toBe("mapped");
    expect(s.link.mapping).toEqual(i.suggestion);
    /* A folder with no token: nothing fits. */
    setup({ "README.json": "{}" });
    const none = await sync.inspect("trunk");
    expect(none.detection.suggested).toBeNull();
    expect(needsChoice(none.detection)).toBe(true);
  });
});

describe("dtcg mapped (repository)", () => {
  beforeEach(() => setup(fixtureTexts("mapped-files"), ""));

  it("dtcg mapped: applies nothing before the mapping is confirmed, and keeps it in the link", async () => {
    const i = await sync.inspect("trunk");
    expect(i.detection.suggested).toBe("mapped");
    expect(i.suggestion.files["mode.dark.tokens.json"]).toEqual({ kind: "context", axis: "mode", context: "dark" });
    expect(fig.collections).toEqual([]);
    expect(await sync.state()).toEqual({ kind: "unlinked" });
    await sync.link(i, { format: "mapped", mapping: MAPPINGS["mapped-files"], remBase: 16 }, false);
    expect((await linked()).link.mapping).toEqual(MAPPINGS["mapped-files"]);
    expect(fig.collection("Semantic").modes.map((m) => m.name)).toEqual(["Standard · Light", "Standard · Dark", "Premium · Light", "Premium · Dark"]);
  });

  it("dtcg mapped: reports a new unmapped file and keeps it out until it is mapped or left out", async () => {
    await sync.link(await sync.inspect("trunk"), { format: "mapped", mapping: MAPPINGS["mapped-files"], remBase: 16 }, false);
    gh.edit("trunk", "brand.vip.tokens.json", JSON.stringify({ content: { brand: { $type: "color", $value: "#ff0000" } } }));
    const s = await linked();
    expect(s.unmapped).toEqual(["brand.vip.tokens.json"]);
    expect(s.head.read.issues).toEqual(expect.arrayContaining([expect.objectContaining({ file: "brand.vip.tokens.json", message: expect.stringMatching(/isn't in the mapping/) })]));
    await sync.update(s);
    expect(fig.collection("Semantic").modes).toHaveLength(4);
    const mapping = { ...MAPPINGS["mapped-files"], files: { ...MAPPINGS["mapped-files"].files, "brand.vip.tokens.json": { kind: "out" as const } } };
    await sync.remap(await linked(), { format: "mapped", mapping, remBase: 16 });
    expect((await linked()).unmapped).toEqual([]);
  });
});

describe("dtcg read-only", () => {
  it("dtcg read-only: a local edit shows as a local edit, and importing again replaces it", async () => {
    await linkResolver();
    const mode = fig.collection("Primitives").modes[0].modeId;
    fig.variable("spacing/100").setValueForMode(mode, 7);
    let s = await linked();
    expect(s.status.status).toBe("local-edits");
    expect(s.status.local.map((c) => c.path)).toEqual(["spacing.100"]);
    await sync.update(s);
    s = await linked();
    expect(s.status.status).toBe("in-step");
    expect(fig.variable("spacing/100").valuesByMode[mode]).toBe(4);
    expect(gh.requests.filter((q) => q.method !== "GET")).toEqual([]);
  });

  it("dtcg read-only: the repository moving with local edits shows both, and importing takes the repository's values", async () => {
    await linkResolver();
    const mode = fig.collection("Primitives").modes[0].modeId;
    fig.variable("spacing/100").setValueForMode(mode, 7);
    fig.variable("spacing/200").setValueForMode(mode, 11);
    editJson("dimension.tokens.json", (d) => {
      d.spacing["100"].$value.value = 6;
      d.spacing["400"].$value.value = 20;
    });
    let s = await linked();
    expect(s.status.status).toBe("diverged");
    expect(s.status.both).toEqual(["spacing.100"]);
    expect(s.status.repo.map((c) => c.path)).toEqual(["spacing.100", "spacing.400"]);
    await sync.update(s);
    expect(fig.variable("spacing/100").valuesByMode[mode]).toBe(6);
    expect(fig.variable("spacing/200").valuesByMode[mode]).toBe(8);
    expect(fig.variable("spacing/400").valuesByMode[mode]).toBe(20);
    s = await linked();
    expect(s.moved).toBe(false);
    expect(s.status.status).toBe("in-step");
    expect(gh.requests.filter((q) => q.method !== "GET")).toEqual([]);
  });

  it("dtcg read-only: the repository moving on shows, and importing brings the file level", async () => {
    await linkResolver();
    editJson("dimension.tokens.json", (d) => (d.spacing["400"].$value.value = 18));
    const s = await linked();
    expect(s.status.status).toBe("repo-ahead");
    await sync.update(s);
    expect((await linked()).status.status).toBe("in-step");
  });
});

describe("dtcg report", () => {
  it("dtcg report: Copy report gives the format, branch, commit, mapping, counts, issues and version, and no token", async () => {
    setup(fixtureTexts("mapped-files"), "");
    await sync.link(await sync.inspect("trunk"), { format: "mapped", mapping: MAPPINGS["mapped-files"], remBase: 16 }, false);
    const s = await linked();
    const text = report(s);
    expect(text).toMatch(/DTCG Import for Figma 1\.0\.0/);
    expect(text).toMatch(/Format: mapped/);
    expect(text).toContain(`Branch: trunk · commit ${s.headSha}`);
    expect(text).toMatch(/Mapping:\n {2}color\.tokens\.json: base/);
    expect(text).toMatch(/mode\.dark\.tokens\.json: mode = dark/);
    expect(text).toMatch(/Counts: \d+ variables in 4 collections/);
    expect(text).toMatch(/Issues \(\d+\):[\s\S]*broken\.tokens\.json/);
    expect(text).not.toContain("tkn");
  });
});
