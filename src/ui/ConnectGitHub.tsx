/* Connecting a GitHub repository: the designer gives the address (and a
   token for a private one), and the plugin finds the folder with the tokens
   and what it is (a resolver, Tokens Studio, plain token files). It asks only
   when the repository has more than one. The form starts from the last
   repository and token; the folder and the branch are there on request.
   Read only: no write call. */

import { useEffect, useState } from "react";
import { Callout, Field } from "./kit";
import { findTokenFolders, type TokenFolder } from "../detect";
import { DtcgGitHub, type RepoRef } from "../github";
import { lastDtcg } from "./keys";
import { d, FORMAT_NAMES } from "./strings";

export function parseRepo(input: string, folder = ""): RepoRef | null {
  const m = input.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "").replace(/\.git$/, "").match(/^([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+)$/);
  return m ? { owner: m[1], name: m[2], folder: folder.trim().replace(/^\/+|\/+$/g, "") } : null;
}

export interface Connected {
  repo: RepoRef;
  token: string;
  branch: string;
  kind: TokenFolder["kind"];
}

/** What a folder holds, in words. */
export const kindLine = (kind: TokenFolder["kind"]) => FORMAT_NAMES[kind];

export function ConnectGitHub({ onConnected }: { onConnected: (c: Connected) => Promise<void> }) {
  const [address, setAddress] = useState("");
  const [tk, setTk] = useState("");
  const [folder, setFolder] = useState("");
  const [branch, setBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [several, setSeveral] = useState<{ folders: TokenFolder[]; branch: string; repo: RepoRef } | null>(null);
  const [pick, setPick] = useState(0);

  /* The last repository and its token; the folder is left to be found, so a new file can follow another one. */
  useEffect(() => {
    lastDtcg().then((last) => {
      if (!last) return;
      setAddress((a) => a || `${last.repo.owner}/${last.repo.name}`);
      setTk((t) => t || last.token);
    }, () => {});
  }, []);

  const go = async (repo: RepoRef, b: string, f: TokenFolder) => {
    await onConnected({ repo: { ...repo, folder: f.folder }, token: tk.trim(), branch: b, kind: f.kind });
  };

  const connect = async () => {
    const r = parseRepo(address, folder);
    if (!r) return setError(d.invalid);
    setError(null);
    setSeveral(null);
    setWorking(true);
    try {
      const gh = new DtcgGitHub({ ...r, folder: "" }, tk.trim());
      const { defaultBranch } = await gh.connect();
      const b = branch.trim() || defaultBranch;
      const paths = (await gh.list(await gh.head(b))).map((e) => e.path);
      const inFolder = r.folder ? paths.filter((p) => p.startsWith(`${r.folder}/`)) : paths;
      let folders = findTokenFolders(inFolder);
      /* A folder the designer named is the one when it holds the tokens itself; when they are in folders inside it, the designer chooses among those. */
      const itself = folders.find((f) => f.folder === r.folder);
      if (r.folder && itself) folders = [itself];
      if (!folders.length) throw new Error(d.noTokens(`${r.owner}/${r.name}`, b));
      if (folders.length === 1) await go(r, b, folders[0]);
      else {
        setSeveral({ folders, branch: b, repo: r });
        setPick(0);
      }
    } catch (e) {
      setError((e as Error).message);
    }
    setWorking(false);
  };

  return (
    <section className="card connect">
      <div className="lead">
        <h2>{d.connectTitle}</h2>
        <p className="muted">{d.connectHint}</p>
      </div>
      <Field label={d.address} htmlFor="gh-address">
        <input id="gh-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="owner/name" spellCheck={false} />
      </Field>
      <Field label={d.token} htmlFor="gh-token" hint={d.tokenHint}>
        <input id="gh-token" type="password" value={tk} onChange={(e) => setTk(e.target.value)} placeholder="github_pat_…" spellCheck={false} />
      </Field>
      <details className="disclosure">
        <summary>{d.options}</summary>
        <div className="stack">
          <Field label={d.folder} htmlFor="gh-folder">
            <input id="gh-folder" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder={d.folderPlaceholder} spellCheck={false} />
          </Field>
          <Field label={d.branch} htmlFor="gh-branch">
            <input id="gh-branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={d.branchPlaceholder} spellCheck={false} />
          </Field>
        </div>
      </details>
      {error && <Callout tone="danger"><p>{error}</p></Callout>}
      {several ? (
        <div className="stack">
          <div>
            <p className="strong">{d.severalTitle}</p>
            <p className="muted">{d.severalHint}</p>
          </div>
          <div className="options" role="radiogroup" aria-label={d.severalTitle}>
            {several.folders.map((f, i) => (
              <label key={f.folder} className={`option${pick === i ? " on" : ""}`}>
                <input type="radio" name="gh-folder-pick" checked={pick === i} onChange={() => setPick(i)} />
                <span className="option-body">
                  <span className="strong">{f.folder || d.root}</span>
                  <span className="muted kind">{kindLine(f.kind)}</span>
                </span>
              </label>
            ))}
          </div>
          <button className="primary block" disabled={working} onClick={() => {
            setWorking(true);
            go(several.repo, several.branch, several.folders[pick]).catch((e) => {
              setError((e as Error).message);
            }).finally(() => setWorking(false));
          }}>{d.continue}</button>
        </div>
      ) : (
        <button className="primary block" disabled={working || !address.trim()} onClick={() => void connect()}>{working ? d.looking : d.connect}</button>
      )}
    </section>
  );
}
