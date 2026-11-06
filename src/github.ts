/* GitHub, read only. Every call is a GET: no write call exists here. A public
   repository needs no token; a private one needs a fine-grained token with
   Contents: read (Metadata: read comes with it). Each of
   GitHub's refusals is told apart, with what to do about it. */

import { ApiError } from "./shared/api-error";
import { isCandidate } from "./readers/files";

export interface RepoRef {
  owner: string;
  name: string;
  /** The folder that holds the tokens; "" for the root. */
  folder: string;
}

export type GitHubErrorKind = "expired" | "sso" | "policy" | "forbidden" | "not_found" | "rate_limit" | "offline" | "github";

/** One of GitHub's refusals, in words that say what to do. */
export class GitHubError extends ApiError {
  constructor(public kind: GitHubErrorKind, status: number, message: string, public resetAt?: Date) {
    super(status, { error: kind, message });
  }
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- GitHub's replies, read where they are used

const two = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date) => `${two(d.getHours())}:${two(d.getMinutes())}`;

/** GitHub's answer → the error it means. `what` names the thing asked for, for a 404. */
export function githubError(status: number, headers: Headers, json: Json, what: string, repo?: RepoRef, token = "x"): GitHubError {
  const message = String(json.message ?? "");
  const org = repo?.owner ?? "the organization";
  const remaining = headers.get("x-ratelimit-remaining");
  const retry = headers.get("retry-after");
  if (status === 429 || ((status === 403 || status === 429) && (remaining === "0" || retry || /rate limit/i.test(message)))) {
    const reset = retry ? new Date(Date.now() + Number(retry) * 1000) : headers.get("x-ratelimit-reset") ? new Date(Number(headers.get("x-ratelimit-reset")) * 1000) : undefined;
    return new GitHubError("rate_limit", status, `GitHub's rate limit was reached${reset ? `; it resets at ${clock(reset)}` : ""}. Try again then.${token ? "" : " Without a token GitHub allows 60 requests an hour; any token (even one with no access) raises that to 5,000."}`, reset);
  }
  if (status === 401) return new GitHubError("expired", 401, "GitHub refused the token: it expired or was revoked. Make a new one and connect again.");
  /* Without a token, a private repository looks like one that doesn't exist. */
  if (status === 404 && !token) return new GitHubError("not_found", 404, `${what} wasn't found. If the repository is private, add a fine-grained token with Contents: read.`);
  if (status === 403) {
    const sso = headers.get("x-github-sso");
    if (sso) {
      const url = sso.match(/url=([^;\s]+)/)?.[1];
      return new GitHubError("sso", 403, `The token isn't authorized for ${org}'s single sign-on. On GitHub, open the token's settings, choose Configure SSO and authorize ${org}${url ? ` (${url})` : ""}, then connect again.`);
    }
    if (/fine-grained|personal access token|approv|policy|forbids|lifetime|organization/i.test(message)) {
      return new GitHubError("policy", 403, `${org} hasn't approved this token yet, or its policy blocks it ("${message}"). Ask an owner of ${org} to approve it, or make a token the policy allows.`);
    }
    return new GitHubError("forbidden", 403, `The token can't read ${what}. It needs Contents: read on the repository.`);
  }
  if (status === 404) return new GitHubError("not_found", 404, `${what} wasn't found: it doesn't exist, or the token can't see it.`);
  return new GitHubError("github", status, message || `GitHub answered ${status}.`);
}

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const SKIP_DIR = (name: string) => name === "node_modules" || name === "dist" || name === "build" || name.startsWith(".");

export class DtcgGitHub {
  private info: Promise<{ defaultBranch: string; login: string }> | null = null;
  /** Commits never change: their files are read once. */
  private cache = new Map<string, Record<string, string>>();

  /** `token`: "" for a public repository. */
  constructor(public repo: RepoRef, private token: string = "") {}

  private get base() {
    return `https://api.github.com/repos/${encodeURIComponent(this.repo.owner)}/${encodeURIComponent(this.repo.name)}`;
  }

  /** A GET (the only method this class uses): the answer, or the error it means. */
  private async get(path: string, what: string, root = this.base): Promise<Json> {
    let res: Response;
    try {
      const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
      if (this.token) headers.authorization = `Bearer ${this.token}`;
      res = await fetch(`${root}${path}`, { method: "GET", cache: "no-store", headers });
    } catch {
      throw new GitHubError("offline", 0, "Couldn't reach GitHub. Check the connection.");
    }
    const json = (await res.json().catch(() => ({}))) as Json;
    if (res.status >= 400) throw githubError(res.status, res.headers, json, what, this.repo, this.token);
    return json;
  }

  private get label() {
    return `${this.repo.owner}/${this.repo.name}`;
  }

  /** The repository, and who the token is (when there is one). */
  async connect(): Promise<{ login: string; defaultBranch: string }> {
    this.info ??= (async () => {
      const r = await this.get("", `The repository ${this.label}`);
      let login = "";
      if (this.token) try {
        login = String((await this.get("/user", "the token's user", "https://api.github.com")).login ?? login);
      } catch {
        /* A token may read a repository without reading its user. */
      }
      return { defaultBranch: String(r.default_branch ?? "main"), login };
    })();
    this.info.catch(() => (this.info = null));
    return this.info;
  }

  /** The branches, the default first. */
  async branches(): Promise<string[]> {
    const { defaultBranch } = await this.connect();
    const names: string[] = [];
    for (let page = 1; page <= 5; page++) {
      const list = (await this.get(`/branches?per_page=100&page=${page}`, `The branches of ${this.label}`)) as unknown as Json[];
      names.push(...list.map((b) => String(b.name)));
      if (list.length < 100) break;
    }
    return [defaultBranch, ...names.filter((n) => n !== defaultBranch).sort()];
  }

  /** A branch's head commit. */
  async head(branch: string): Promise<string> {
    const r = await this.get(`/git/ref/heads/${encodePath(branch)}`, `The branch ${branch}`);
    return String(r.object.sha);
  }

  /** The folder's files that may hold tokens, at a commit: from the folder's own tree, walking subfolders when GitHub truncates it. */
  async list(sha: string): Promise<{ path: string; sha: string }[]> {
    const commit = await this.get(`/git/commits/${sha}`, `The commit ${sha.slice(0, 7)}`);
    let tree = String(commit.tree.sha);
    for (const part of this.repo.folder.split("/").filter(Boolean)) {
      const t = await this.get(`/git/trees/${tree}`, `The folder ${this.repo.folder}`);
      const entry = ((t.tree ?? []) as Json[]).find((e) => e.type === "tree" && e.path === part);
      if (!entry) throw new GitHubError("not_found", 404, `There is no folder ${this.repo.folder} in ${this.label} at this commit.`);
      tree = String(entry.sha);
    }
    const out: { path: string; sha: string }[] = [];
    const walk = async (treeSha: string, prefix: string) => {
      const t = await this.get(`/git/trees/${treeSha}?recursive=1`, `The folder ${this.repo.folder || "/"}`);
      if (!t.truncated) {
        for (const e of (t.tree ?? []) as Json[]) if (e.type === "blob") out.push({ path: `${prefix}${e.path}`, sha: String(e.sha) });
        return;
      }
      /* Too large for one answer: this level, then each subfolder on its own. */
      const level = await this.get(`/git/trees/${treeSha}`, `The folder ${prefix || this.repo.folder || "/"}`);
      for (const e of (level.tree ?? []) as Json[]) {
        if (e.type === "blob") out.push({ path: `${prefix}${e.path}`, sha: String(e.sha) });
        else if (e.type === "tree" && !SKIP_DIR(String(e.path))) await walk(String(e.sha), `${prefix}${e.path}/`);
      }
    };
    await walk(tree, "");
    return out;
  }

  /** The texts of the folder's candidate files at a commit (a few requests at a time). */
  async read(sha: string): Promise<Record<string, string>> {
    const hit = this.cache.get(sha);
    if (hit) return hit;
    const entries = (await this.list(sha)).filter((e) => isCandidate(e.path));
    const texts: Record<string, string> = {};
    for (let i = 0; i < entries.length; i += 8) {
      await Promise.all(
        entries.slice(i, i + 8).map(async (e) => {
          const b = await this.get(`/git/blobs/${e.sha}`, e.path);
          texts[e.path] = b.encoding === "base64" ? new TextDecoder().decode(Uint8Array.from(atob(String(b.content).replace(/\s/g, "")), (c) => c.charCodeAt(0))) : String(b.content ?? "");
        }),
      );
    }
    this.cache.set(sha, texts);
    return texts;
  }
}
