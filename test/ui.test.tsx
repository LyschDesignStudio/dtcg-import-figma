// @vitest-environment jsdom
/* The panel, clicked through for a DTCG repository: connect, read the folder,
   see what was found, import, and import again later. */

import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeHandlers, type Handlers } from "../src/handlers";
import { FakeFigma } from "./fake-figma";
import { FakeGitHub } from "./fake-github";
import { fixtureTexts } from "./fixtures";

let handlers: Handlers;
vi.mock("../src/ui/bridge", () => ({
  call: (method: string, params: unknown) => Promise.resolve((handlers as unknown as Record<string, (p: unknown) => unknown>)[method](params)),
  onProgress: () => () => {},
}));
const { DtcgApp } = await import("../src/ui/DtcgApp");

configure({ asyncUtilTimeout: 10000 });
vi.setConfig({ testTimeout: 60000 });

let fig: FakeFigma;
let gh: FakeGitHub;
const click = async (name: RegExp | string) => {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
};
const WRITES = [/push/i, /pull request/i, /merge/i, /resolve/i, /commit/i, /revert/i, /discard/i, /^mine$/i];

beforeEach(() => {
  fig = new FakeFigma();
  handlers = makeHandlers(fig.api, () => {});
  gh = new FakeGitHub("design/tokens/", fixtureTexts("resolver"));
  vi.stubGlobal("fetch", gh.fetch);
  vi.stubGlobal("confirm", () => true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function connectAndLink(token = "tkn") {
  render(<DtcgApp />);
  /* One form, whatever the repository holds: the plugin finds the folder and what it is. */
  fireEvent.change(await screen.findByLabelText("Repository"), { target: { value: "acme/tokens" } });
  fireEvent.change(screen.getByLabelText(/GitHub token/), { target: { value: token } });
  await click("Connect");
  await screen.findByText("Ready to import");
  await screen.findByText(/^\d+ variables · 3 styles$/);
  await screen.findByText("Primitives, Mode, Viewport and Semantic, from design/tokens on trunk.");
  /* What was assumed waits under Details. */
  expect((screen.getByText("Details").closest("details") as HTMLDetailsElement).open).toBe(false);
  await click("Import into Figma");
  await screen.findByText("Up to date");
}

describe("dtcg panel", () => {
  it("dtcg connect: a public repository connects with the token left empty, and no Authorization header is sent", async () => {
    await connectAndLink("");
    expect(fig.collections.map((c) => c.name)).toEqual(["Primitives", "Mode", "Viewport", "Semantic"]);
    expect(gh.requests.every((q) => q.auth === null)).toBe(true);
  });

  it("dtcg connect: the token field says it is optional, and what a private repository needs", async () => {
    render(<DtcgApp />);
    await screen.findByLabelText("GitHub token (optional)");
    await screen.findByText(/Leave empty for a public repository.*Contents: read/);
  });

  it("dtcg read-only: nothing that writes to the repository is offered, in any state", async () => {
    await connectAndLink();
    for (const name of WRITES) expect(screen.queryByRole("button", { name })).toBeNull();
    /* A local edit and the repository moving: still nothing that writes. */
    fig.variable("spacing/100").setValueForMode(fig.collection("Primitives").modes[0].modeId, 7);
    gh.edit("trunk", "design/tokens/dimension.tokens.json", JSON.stringify({ spacing: { 100: { $type: "dimension", $value: { value: 6, unit: "px" } } } }));
    cleanup();
    render(<DtcgApp />);
    await screen.findByText("Changed on both sides");
    await screen.findByRole("button", { name: "Import" });
    for (const name of WRITES) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(gh.requests.filter((q) => q.method !== "GET")).toEqual([]);
  });

  it("dtcg panel: Import previews what it will do, and lists what the repository removed", async () => {
    await connectAndLink();
    const dim = JSON.parse(fixtureTexts("resolver")["dimension.tokens.json"]);
    delete dim.radius.sm;
    gh.edit("trunk", "design/tokens/dimension.tokens.json", JSON.stringify(dim));
    cleanup();
    render(<DtcgApp />);
    await screen.findByText("1 change in the repository");
    await click("Import");
    await screen.findByText(/list 1 the repository removed/);
    fireEvent.click(screen.getAllByRole("button", { name: "Import" }).at(-1)!);
    fireEvent.click(await screen.findByText("Removed in the repository"));
    fireEvent.click(await screen.findByLabelText(/radius\/sm/));
    await click("Delete 1 item");
    await waitFor(() => expect(fig.variables.some((v) => v.name === "radius/sm")).toBe(false));
  });

  it("dtcg panel: edits made only in Figma are listed, and Import again replaces them after a confirmation", async () => {
    const confirmText = vi.fn(() => true);
    await connectAndLink();
    vi.stubGlobal("confirm", confirmText);
    fig.variable("layout/columns").setValueForMode(fig.collection("Viewport").modes[0].modeId, 6);
    cleanup();
    render(<DtcgApp />);
    await screen.findByText("1 edit made in Figma");
    await screen.findByText("compact: Repository 4 · Figma 6");
    await click("Import again");
    expect((confirmText.mock.calls[0] as unknown as string[])[0]).toMatch(/1 edit made in Figma will be replaced/);
    await screen.findByText("Up to date");
    expect(fig.variable("layout/columns").valuesByMode[fig.collection("Viewport").modes[0].modeId]).toBe(4);
  });
});

describe("dtcg folders of one repository", () => {
  /* One repository with two folders of tokens: design/dtcg (a resolver) and design/dtcg-ts (Tokens Studio). */
  const twoFolders = () => new FakeGitHub("", {
    ...Object.fromEntries(Object.entries(fixtureTexts("resolver")).map(([p, t]) => [`design/dtcg/${p}`, t])),
    ...Object.fromEntries(Object.entries(fixtureTexts("tokens-studio")).map(([p, t]) => [`design/dtcg-ts/${p}`, t])),
  });
  /** A Figma file of its own, on the same computer (the same client storage). */
  const store = new Map<string, unknown>();
  const files = new Map<FakeFigma, Handlers>();
  const openFile = (file = new FakeFigma()) => {
    fig = file;
    file.storage = store;
    if (!files.has(file)) files.set(file, makeHandlers(file.api, () => {}));
    handlers = files.get(file)!;
    return file;
  };
  const connectTo = async (folder: string) => {
    await click("Connect");
    await screen.findByText("Tokens are in more than one folder");
    fireEvent.click(await screen.findByRole("radio", { name: new RegExp(`^${folder}(DTCG|Tokens)`) }));
    await click("Continue");
    await screen.findByText("Ready to import");
    await click("Import into Figma");
    await screen.findByText("Up to date");
  };
  const fill = async (folder?: string) => {
    fireEvent.change(await screen.findByLabelText("Repository"), { target: { value: "acme/tokens" } });
    fireEvent.change(screen.getByLabelText(/GitHub token/), { target: { value: "tkn" } });
    if (folder) fireEvent.change(screen.getByLabelText("Folder"), { target: { value: folder } });
  };
  beforeEach(() => {
    store.clear();
    gh = twoFolders();
    vi.stubGlobal("fetch", gh.fetch);
  });

  it("dtcg folders: a folder named on the form that holds folders of tokens asks which of them", async () => {
    openFile();
    render(<DtcgApp />);
    await fill("design");
    await click("Connect");
    await screen.findByText("Tokens are in more than one folder");
    expect(screen.getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual(["design/dtcgDTCG with a resolver", "design/dtcg-tsTokens Studio"]);
    expect(screen.queryByText("Ready to import")).toBeNull();
  });

  it("dtcg folders: two files connected to two folders of the same repository each keep their own", async () => {
    const a = openFile();
    render(<DtcgApp />);
    await fill();
    await connectTo("design/dtcg");
    await screen.findByText(/^design\/dtcg · trunk/);
    cleanup();

    /* The second file: the form, prefilled, not the first file's folder. */
    const b = openFile();
    render(<DtcgApp />);
    await waitFor(() => expect((screen.getByLabelText("Repository") as HTMLInputElement).value).toBe("acme/tokens"));
    expect((screen.getByLabelText(/GitHub token/) as HTMLInputElement).value).toBe("tkn");
    expect(screen.queryByText("Ready to import")).toBeNull();
    await connectTo("design/dtcg-ts");
    await screen.findByText(/^design\/dtcg-ts · trunk/);
    cleanup();

    /* Each file, opened again, follows its own folder. */
    for (const [file, folder] of [[a, "design/dtcg"], [b, "design/dtcg-ts"]] as const) {
      openFile(file);
      render(<DtcgApp />);
      await screen.findByText(new RegExp(`^${folder} · trunk`));
      cleanup();
    }
    expect(gh.requests.filter((q) => q.method !== "GET")).toEqual([]);
  });

  it("dtcg panel: Change configuration moves a connected file to another folder of the same repository", async () => {
    openFile();
    render(<DtcgApp />);
    await fill();
    await connectTo("design/dtcg");
    await screen.findByText(/^design\/dtcg · trunk/);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Change configuration" }));
    const select = (await screen.findByLabelText("Folder")) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(select.options).some((o) => o.value === "design/dtcg-ts")).toBe(true));
    fireEvent.change(select, { target: { value: "design/dtcg-ts" } });
    await click("Import into Figma");
    await screen.findByText("Up to date");
    await screen.findByText(/^design\/dtcg-ts · trunk/);
    expect(gh.requests.filter((q) => q.method !== "GET")).toEqual([]);
  });
});

describe("dtcg panel states", () => {
  it("dtcg panel: Check again reads the edits made since, in the edits-made-in-Figma state", async () => {
    await connectAndLink();
    fig.variable("layout/columns").setValueForMode(fig.collection("Viewport").modes[0].modeId, 6);
    cleanup();
    render(<DtcgApp />);
    await screen.findByText("1 edit made in Figma");
    fig.variable("spacing/100").setValueForMode(fig.collection("Primitives").modes[0].modeId, 7);
    await click("Check again");
    await screen.findByText("2 edits made in Figma");
  });

  it("dtcg panel: a connected file says it is checking the repository before it says where it stands", async () => {
    await connectAndLink();
    cleanup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      await gate;
      return gh.fetch(input, init);
    });
    render(<DtcgApp />);
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Checking the repository…");
    expect(screen.queryByText("Up to date")).toBeNull();
    release();
    await screen.findByText("Up to date");
    expect(screen.queryByText("Checking the repository…")).toBeNull();
  });

  it("dtcg panel: Disconnect keeps the variables, forgets the link and shows the connect form", async () => {
    const confirmText = vi.fn(() => true);
    await connectAndLink();
    vi.stubGlobal("confirm", confirmText);
    const before = fig.variables.length;
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Disconnect" }));
    expect(confirmText).toHaveBeenCalledTimes(1);
    expect((confirmText.mock.calls[0] as unknown as string[])[0]).toMatch(/variables and styles already in this file stay/);
    await screen.findByText("Connect a GitHub repository");
    expect(fig.variables.length).toBe(before);
    expect(await handlers.dtcgLink()).toBeFalsy();
  });
});
