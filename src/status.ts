/* Where a file following a DTCG repository stands, from three snapshots: what the file held
   right after its last import (the plan at its commit), the file now, and the
   branch's head. Pure. */

import { stableStringify } from "./shared/stable";
import type { DtcgSnapshot, SnapToken } from "./model";

export interface TokenChange {
  path: string;
  kind: "added" | "removed" | "changed";
  from?: SnapToken;
  to?: SnapToken;
}

export type DtcgStatusKind = "in-step" | "repo-ahead" | "local-edits" | "diverged";

export interface DtcgStatus {
  status: DtcgStatusKind;
  /** The file against its last import: a variable the designer changed in Figma, or deleted. */
  local: TokenChange[];
  /** The repository since the file's commit. */
  repo: TokenChange[];
  /** Tokens edited locally that the repository changed too: the designer chooses, token by token. */
  both: string[];
}

const uniform = (t: SnapToken) => {
  const vals = Object.values(t.values).map((v) => stableStringify(v));
  return new Set(vals).size === 1 ? vals[0] : null;
};

/** The same token: same type, and the same values (one value in every mode counts as the same in any collection's modes). */
export function sameToken(a: SnapToken | undefined, b: SnapToken | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.type !== b.type) return false;
  if (stableStringify(a.values) === stableStringify(b.values)) return true;
  const ua = uniform(a);
  return ua !== null && ua === uniform(b);
}

export function tokenChanges(a: DtcgSnapshot, b: DtcgSnapshot): TokenChange[] {
  const out: TokenChange[] = [];
  for (const path of new Set([...Object.keys(a.tokens), ...Object.keys(b.tokens)])) {
    const from = a.tokens[path];
    const to = b.tokens[path];
    if (!from) out.push({ path, kind: "added", to });
    else if (!to) out.push({ path, kind: "removed", from });
    else if (!sameToken(from, to)) out.push({ path, kind: "changed", from, to });
  }
  return out.sort((x, y) => x.path.localeCompare(y.path));
}

/**
 * `base`: the plan at the file's commit; `file`: the file now (null when its
 * hash says it is as the last import left it); `head`: the plan at the
 * branch's head, null when the branch hasn't moved. `failed`: paths the last
 * import couldn't write, which aren't local edits.
 */
export function dtcgStatus(base: DtcgSnapshot, file: DtcgSnapshot | null, head: DtcgSnapshot | null, failed: string[] = []): DtcgStatus {
  const local = file ? tokenChanges(base, file).filter((c) => c.kind !== "added" && !failed.includes(c.path)) : [];
  const repo = head ? tokenChanges(base, head) : [];
  const repoPaths = new Set(repo.map((c) => c.path));
  const both = local.filter((c) => repoPaths.has(c.path) && !sameToken(c.to, head!.tokens[c.path])).map((c) => c.path);
  const status: DtcgStatusKind = local.length && repo.length ? "diverged" : local.length ? "local-edits" : repo.length ? "repo-ahead" : "in-step";
  return { status, local, repo, both };
}
