/* What the plugin keeps of a GitHub connection on this computer (Figma's
   client storage, shared by every file): the last repository and branch, and
   a token for each private repository. It never says which folder a file follows:
   that is the file's own link, so two files of one repository each keep theirs. */

import { call } from "./bridge";
import type { RepoRef } from "../github";

export const DTCG_KEYS = {
  repo: "dtcg-import:repo",
  branch: "dtcg-import:branch",
  token: (r: Pick<RepoRef, "owner" | "name">) => `dtcg-import:token:${r.owner}/${r.name}`,
};

/** Keeps a connection, for the next form to start from. */
export async function rememberDtcg(c: { repo: RepoRef; token: string; branch: string }) {
  await call("storageSet", { key: DTCG_KEYS.token(c.repo), value: c.token });
  await call("storageSet", { key: DTCG_KEYS.repo, value: c.repo });
  await call("storageSet", { key: DTCG_KEYS.branch, value: c.branch });
}

/** The last repository connected, and its token, to prefill the next form. */
export async function lastDtcg(): Promise<{ repo: RepoRef; token: string } | null> {
  const repo = (await call("storageGet", { key: DTCG_KEYS.repo })) as RepoRef | undefined;
  if (!repo) return null;
  return { repo, token: ((await call("storageGet", { key: DTCG_KEYS.token(repo) })) as string | undefined) ?? "" };
}

export const tokenOf = async (r: Pick<RepoRef, "owner" | "name">) => ((await call("storageGet", { key: DTCG_KEYS.token(r) })) as string | undefined) ?? null;
