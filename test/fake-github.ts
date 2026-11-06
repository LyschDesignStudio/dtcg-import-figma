/* A fake GitHub for the plugin's tests: commits (each a whole tree) and branches, answering the read-only REST calls the plugin makes through `fetch`. Any other call is answered 404, so a write would show. */

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
export const sha = (n: number) => n.toString(16).padStart(40, "0");

export class FakeGitHub {
  commits = new Map<string, { files: Record<string, string>; parent: string | null; message: string }>();
  branches = new Map<string, string>();
  requests: { method: string; path: string; auth: string | null; cache?: RequestCache }[] = [];
  /** A private repository: without a token, GitHub answers 404 as if it didn't exist. */
  private = false;
  /** Answers the test makes GitHub give: to requests matching `match` ("GET /repos/…"), `times` times. */
  failures: { match: RegExp; status: number; message: string; headers?: Record<string, string>; times: number }[] = [];
  /** A recursive tree with more entries than this comes back truncated, as GitHub's does past its limit. */
  truncateOver = Infinity;
  private dirs = new Map<string, { files: Record<string, string>; prefix: string }>();
  private n = 1;
  private blobs = new Map<string, string>();

  constructor(prefix: string, files: Record<string, unknown>, public full = "acme/tokens") {
    const c = this.addCommit(Object.fromEntries(Object.entries(files).map(([p, v]) => [`${prefix}${p}`, typeof v === "string" ? v : `${JSON.stringify(v, null, 2)}\n`])), null, "seed");
    this.branches.set("trunk", c);
  }
  private addCommit(files: Record<string, string>, parent: string | null, message: string) {
    const id = sha(this.n++);
    this.commits.set(id, { files, parent, message });
    return id;
  }
  /** A save made on GitHub itself. */
  edit(branch: string, path: string, content: string) {
    const head = this.branches.get(branch)!;
    this.branches.set(branch, this.addCommit({ ...this.commits.get(head)!.files, [path]: content }, head, "edit on GitHub"));
  }
  fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("authorization");
    this.requests.push({ method, path: url.pathname + url.search, auth, cache: init?.cache });
    const reply = (status: number, json: unknown, headers?: Record<string, string>) => new Response(JSON.stringify(json), { status, headers });
    const failure = this.failures.find((f) => f.times > 0 && f.match.test(`${method} ${url.pathname}`));
    if (failure) {
      failure.times--;
      return reply(failure.status, { message: failure.message }, failure.headers);
    }
    if (method !== "GET") return reply(404, { message: `unexpected ${method} ${url.pathname}` });
    if (url.pathname === "/user") return auth ? reply(200, { login: "octo" }) : reply(401, { message: "Requires authentication" });
    if (this.private && !auth) return reply(404, { message: "Not Found" });
    const m = url.pathname.match(new RegExp(`^/repos/${this.full}(/.*)?$`));
    if (!m) return reply(404, { message: "Not Found" });
    const rest = m[1] ?? "";
    let g: RegExpMatchArray | null;
    if (rest === "") return reply(200, { default_branch: "trunk" });
    if ((g = rest.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const h = this.branches.get(decodeURIComponent(g[1]));
      return h ? reply(200, { object: { sha: h } }) : reply(404, { message: "Not Found" });
    }
    if ((g = rest.match(/^\/git\/commits\/([0-9a-f]+)$/))) {
      const c = this.commits.get(g[1]);
      return c ? reply(200, { message: c.message, tree: { sha: g[1] }, parents: c.parent ? [{ sha: c.parent }] : [], author: { name: "Octo", date: "2026-10-22T10:00:00Z" } }) : reply(404, { message: "Not Found" });
    }
    if ((g = rest.match(/^\/git\/trees\/([0-9a-f]+)$/))) {
      const root = this.commits.get(g[1])?.files;
      const t = root ? { files: root, prefix: "" } : this.dirs.get(g[1]);
      if (!t) return reply(404, { message: "Not Found" });
      const under = Object.entries(t.files).filter(([p]) => p.startsWith(t.prefix)).map(([p, c]) => [p.slice(t.prefix.length), c] as const);
      const blob = (path: string, content: string) => {
        const s = sha(this.n++);
        this.blobs.set(s, content);
        return { path, type: "blob", sha: s };
      };
      const dir = (path: string) => {
        const s = sha(this.n++);
        this.dirs.set(s, { files: t.files, prefix: `${t.prefix}${path}/` });
        return { path, type: "tree", sha: s };
      };
      if (url.searchParams.get("recursive")) {
        const folders = [...new Set(under.flatMap(([p]) => p.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))))];
        const tree = [...under.map(([p, c]) => blob(p, c)), ...folders.map(dir)];
        return reply(200, { truncated: tree.length > this.truncateOver, tree: tree.slice(0, Math.min(tree.length, this.truncateOver)) });
      }
      const names = [...new Set(under.filter(([p]) => p.includes("/")).map(([p]) => p.split("/")[0]))];
      return reply(200, { truncated: false, tree: [...under.filter(([p]) => !p.includes("/")).map(([p, c]) => blob(p, c)), ...names.map(dir)] });
    }
    if ((g = rest.match(/^\/git\/blobs\/([0-9a-f]+)$/))) return reply(200, { encoding: "base64", content: b64(this.blobs.get(g[1])!) });
    if (rest.startsWith("/branches")) return reply(200, [...this.branches].map(([name, s]) => ({ name, commit: { sha: s } })));
    return reply(404, { message: `unexpected ${method} ${rest}` });
  };
}
