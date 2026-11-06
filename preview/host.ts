/* Looks at the panel in a browser: the real UI (src/ui) over the fake Figma
   document and a fake GitHub, with the scene the address asks for
   (?scene=…&theme=dark). Not part of the plugin; nothing here ships.

   Scenes: connect (an empty form), new-file (the form with the last
   repository and token), found, mapped and tokens-studio (Ready to import,
   each layout), several (a repository with two folders: the folder list),
   loading (opening a connected file), linked, menu (the More menu),
   configure (Change configuration), ahead (click Import for the preview),
   local, diverged, incomplete, removed, error-sso. */

import { makeHandlers } from "../src/handlers";
import { FakeFigma, INTER } from "../test/fake-figma";
import { FakeGitHub } from "../test/fake-github";

const q = new URLSearchParams(location.search);
const scene = q.get("scene") ?? "connect";
document.documentElement.dataset.theme = q.get("theme") === "dark" ? "dark" : "light";

const MONO = ["Regular", "Medium"].map((style) => ({ family: "IBM Plex Mono", style }));
const fig = new FakeFigma({ fonts: [...INTER, ...MONO], name: "Example file" });
const handlers = makeHandlers(fig.api, () => {}) as unknown as Record<string, (p: unknown) => unknown>;

/* The plugin's main: answers the UI's calls. */
window.addEventListener("message", async (e: MessageEvent) => {
  const msg = e.data?.pluginMessage;
  if (msg?.type !== "call") return;
  try {
    const data = await handlers[msg.method](msg.params);
    window.postMessage({ pluginMessage: { type: "reply", id: msg.id, ok: true, data } }, "*");
  } catch (err) {
    window.postMessage({ pluginMessage: { type: "reply", id: msg.id, ok: false, error: (err as Error).message } }, "*");
  }
});

/* The made-up fixtures of test/repos, served from a repository of their own. */
const fixtures = import.meta.glob("../test/repos/**/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const layoutTexts = (layout: string) => {
  const prefix = `../test/repos/${layout}/`;
  return Object.fromEntries(Object.entries(fixtures).filter(([p]) => p.startsWith(prefix)).map(([p, t]) => [p.slice(prefix.length), t]));
};
const LAYOUT = scene === "mapped" ? "mapped-files" : scene === "tokens-studio" ? "tokens-studio" : "resolver";
const under = (folder: string, texts: Record<string, string>) => Object.fromEntries(Object.entries(texts).map(([p, t]) => [`${folder}/${p}`, t]));
const gh = scene === "several"
  ? new FakeGitHub("", { ...under("design/dtcg", layoutTexts("resolver")), ...under("design/dtcg-ts", layoutTexts("tokens-studio")) }, "acme/tokens")
  : new FakeGitHub("design/", layoutTexts(LAYOUT), "acme/tokens");
/* loading: GitHub never answers once the panel opens, so it stays on its loading state. */
let hang = false;
const real = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => (String(input).startsWith("https://api.github.com") ? (hang ? new Promise(() => {}) : gh.fetch(input, init)) : real(input, init))) as typeof fetch;

/** What a scene clicks once the panel is up, in order: a button or a label, by its text. */
let clicks: string[] = [];

async function setup() {
  if (scene === "connect") return;
  const folder = LAYOUT === "resolver" ? "design/tokens" : "design";
  const r = { owner: "acme", name: "tokens", folder };
  fig.storage.set("dtcg-import:repo", r);
  fig.storage.set("dtcg-import:token:acme/tokens", "");
  if (scene === "new-file") return;
  if (["found", "mapped", "tokens-studio", "several"].includes(scene)) return void (clicks = ["Connect"]);
  if (scene === "error-sso") {
    gh.failures.push({ match: /^GET \/repos\/acme\/tokens\/(branches|git\/ref\/)/, status: 403, message: "Resource protected by organization SAML enforcement.", headers: { "x-github-sso": "required; url=https://github.com/orgs/acme/sso?authorization_request=example" }, times: 99 });
    return;
  }
  const { DtcgGitHub } = await import("../src/github");
  const { DtcgSync } = await import("../src/sync");
  const sync = new DtcgSync(new DtcgGitHub(r));
  await sync.link(await sync.inspect("trunk"), { format: "resolver", remBase: 16 }, false);
  if (scene === "linked") return;
  if (scene === "loading") return void (hang = true);
  if (scene === "menu") return void (clicks = ["More"]);
  if (scene === "configure") return void (clicks = ["More", "Change configuration"]);
  const edit = (path: string, change: (t: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const full = `${folder}/${path}`;
    const tree = JSON.parse(gh.commits.get(gh.branches.get("trunk")!)!.files[full]);
    change(tree);
    gh.edit("trunk", full, `${JSON.stringify(tree, null, 2)}\n`);
  };
  const prim = () => fig.collection("Primitives").modes[0].modeId;
  if (scene === "ahead" || scene === "removed") {
    edit("dimension.tokens.json", (d) => {
      d.spacing.lg = d.spacing["600"];
      delete d.spacing["600"];
      d.spacing["100"].$value.value = 5;
      delete d.radius.sm;
    });
    if (scene === "ahead") return;
    const s = await sync.state();
    if (s.kind === "linked") await sync.update(s);
    return;
  }
  if (scene === "local" || scene === "diverged") {
    fig.variable("spacing/100").setValueForMode(prim(), 7);
    fig.variable("spacing/200").setValueForMode(prim(), 10);
    if (scene === "diverged") edit("dimension.tokens.json", (d) => (d.spacing["100"].$value.value = 6));
    return;
  }
  if (scene === "incomplete") {
    fig.failValuesOf.add("spacing/400");
    edit("dimension.tokens.json", (d) => (d.spacing["400"].$value.value = 18));
    const s = await sync.state();
    if (s.kind === "linked") await sync.update(s);
    fig.failValuesOf.clear();
  }
}

async function play() {
  for (const text of clicks) {
    for (let i = 0; i < 200; i++) {
      const el = [...document.querySelectorAll<HTMLElement>("button, label, [role=menuitem]")].find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === text || b.textContent?.trim().startsWith(`${text} `));
      if (el && !(el as HTMLButtonElement).disabled) {
        el.click();
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

setup()
  .then(() => import("../src/ui/main"))
  .then(() => play())
  .catch((e) => {
    document.body.insertAdjacentHTML("beforeend", `<pre style="color:red;padding:16px">${(e as Error).stack}</pre>`);
  });
