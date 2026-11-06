/* The import, run from the UI (the network is here, the document is main's):
   inspect a folder before connecting, the status of a connected file, import
   again, and the report for support. Read only: nothing here writes to the
   repository. */

import { call } from "./ui/bridge";
import { hash } from "./shared/stable";
import { type Adoption, type ApplyResult, type DtcgFileState, type Preview } from "./apply";
import { detect, readAndPlan, type Detection } from "./detect";
import { DtcgGitHub, type RepoRef } from "./github";
import type { DtcgLink, Format, Mapping, Plan, ReadResult } from "./model";
import { readFolder, type FolderFiles } from "./readers/files";
import { extensionKeysOf, suggestMapping, unmappedOf } from "./readers/mapped";
import { dtcgStatus, type DtcgStatus } from "./status";
import pkg from "../package.json";

export const PLUGIN_VERSION = (pkg as { version: string }).version;

/** What the connect screen shows before linking. */
export interface Inspection {
  repo: RepoRef;
  branch: string;
  sha: string;
  detection: Detection;
  files: FolderFiles;
  /** The mapping the names suggest (for `mapped`), and the extension keys that look like modes. */
  suggestion: Mapping;
  extensionKeys: Record<string, { axes: Record<string, string[]>; tokens: number }>;
}

export interface Choice {
  format: Format;
  resolver?: string;
  mapping?: Mapping;
  remBase: number;
  library?: boolean;
}

export interface Planned {
  read: ReadResult;
  plan: Plan;
  files: FolderFiles;
}

export interface DtcgLinked {
  kind: "linked";
  link: DtcgLink;
  headSha: string;
  moved: boolean;
  head: Planned;
  base: Planned;
  file: DtcgFileState;
  status: DtcgStatus;
  /** Token files the mapping doesn't place (mapped). */
  unmapped: string[];
  login: string;
}

export type DtcgState = DtcgLinked | { kind: "unlinked" };

export class DtcgSync {
  constructor(public gh: DtcgGitHub) {}

  /** Reads a folder at a branch: what it holds, and what the plugin suggests. */
  async inspect(branch: string): Promise<Inspection> {
    const sha = await this.gh.head(branch);
    const paths = (await this.gh.list(sha)).map((e) => e.path);
    const texts = await this.gh.read(sha);
    const files = readFolder(texts);
    return { repo: this.gh.repo, branch, sha, detection: detect(paths, files), files, suggestion: suggestMapping(files), extensionKeys: extensionKeysOf(files) };
  }

  /** The plan a choice makes of a commit. */
  async planAt(sha: string, choice: Choice, name: string): Promise<Planned> {
    const texts = await this.gh.read(sha);
    return readAndPlan(texts, { format: choice.format, resolver: choice.resolver, mapping: choice.mapping, remBase: choice.remBase, name });
  }

  preview = (plan: Plan): Promise<Preview> => call("dtcgPreview", { plan });
  adoption = (plan: Plan): Promise<Adoption> => call("dtcgAdoption", { plan });

  /** Links the file and brings it level with the branch. */
  async link(inspection: Inspection, choice: Choice, adopt: boolean): Promise<ApplyResult> {
    const name = inspection.repo.name;
    const { plan, read } = await this.planAt(inspection.sha, choice, name);
    const link: Omit<DtcgLink, "snapshotHash" | "syncedAt" | "incomplete"> = {
      v: 1,
      repo: inspection.repo,
      branch: inspection.branch,
      format: choice.format,
      ...(choice.resolver ? { resolver: choice.resolver } : {}),
      ...(choice.mapping ? { mapping: choice.mapping } : {}),
      remBase: choice.remBase,
      library: !!choice.library,
      adopt,
      name,
      baseSha: inspection.sha,
    };
    return call("dtcgApply", { plan, link, adopt, figmaRefs: read.figmaRefs });
  }

  async state(): Promise<DtcgState> {
    const file = await call("dtcgRead");
    const link = file.link;
    if (!link) return { kind: "unlinked" };
    const { login } = await this.gh.connect();
    const headSha = await this.gh.head(link.branch);
    const choice: Choice = { format: link.format, resolver: link.resolver, mapping: link.mapping, remBase: link.remBase };
    const head = await this.planAt(headSha, choice, link.name);
    const moved = headSha !== link.baseSha;
    const base = moved ? await this.planAt(link.baseSha, choice, link.name) : head;
    /* The hash is the shortcut: a file as its last Update left it has no local edit. */
    const untouched = hash(file.snapshot as never) === link.snapshotHash;
    const failed = (link.incomplete?.issues ?? []).map((i) => i.path).filter((p): p is string => !!p);
    const status = dtcgStatus(base.plan.snapshot, untouched ? null : file.snapshot, moved ? head.plan.snapshot : null, failed);
    const unmapped = link.format === "mapped" && link.mapping ? unmappedOf(head.files, link.mapping) : [];
    return { kind: "linked", link, headSha, moved, head, base, file, status, unmapped, login };
  }

  /** Import again: the branch's head into the file. Edits made in Figma to imported values are replaced. */
  async update(s: DtcgLinked): Promise<ApplyResult> {
    const link = { ...stripState(s.link), baseSha: s.headSha };
    return call("dtcgApply", { plan: s.head.plan, link, adopt: !!s.link.adopt, figmaRefs: s.head.read.figmaRefs });
  }

  /** A new mapping (or format, or rem base) for the same repository: applied as an import. */
  async remap(s: DtcgLinked, choice: Choice): Promise<ApplyResult> {
    const { plan, read } = await this.planAt(s.headSha, choice, s.link.name);
    const link = { ...stripState(s.link), format: choice.format, resolver: choice.resolver, mapping: choice.mapping, remBase: choice.remBase, library: !!choice.library, baseSha: s.headSha };
    return call("dtcgApply", { plan, link, adopt: !!s.link.adopt, figmaRefs: read.figmaRefs });
  }

  deleteRemoved = (ids: string[]) => call("dtcgDelete", { ids });
  unlink = () => call("dtcgSetLink", { link: null });
}

const stripState = ({ snapshotHash: _h, syncedAt: _s, incomplete: _i, ...rest }: DtcgLink) => rest; // eslint-disable-line @typescript-eslint/no-unused-vars

/** The text Copy report puts in the clipboard: everything support needs, and never the token. */
export function report(s: DtcgLinked): string {
  const { link, head } = s;
  const lines = [
    `DTCG Import for Figma ${PLUGIN_VERSION} · report`,
    `Repository: ${link.repo.owner}/${link.repo.name}${link.repo.folder ? ` · folder ${link.repo.folder}` : ""}`,
    `Format: ${link.format}${link.resolver ? ` (${link.resolver})` : ""}`,
    `Branch: ${link.branch} · commit ${s.headSha}${s.moved ? ` (the file is at ${link.baseSha})` : ""}`,
    `rem base: ${link.remBase}px${link.library ? " · library file" : ""}`,
  ];
  if (link.mapping) {
    lines.push("Mapping:");
    for (const [f, m] of Object.entries(link.mapping.files)) lines.push(`  ${f}: ${m.kind === "context" ? `${m.axis} = ${m.context}` : m.kind}`);
    if (link.mapping.extension) lines.push(`  $extensions key: ${link.mapping.extension.key}`);
  }
  const p = head.plan;
  lines.push(
    `Counts: ${p.variables.length} variables in ${p.collections.length} collections (${p.collections.map((c) => `${c.name}: ${c.modes.length} mode${c.modes.length === 1 ? "" : "s"}`).join(", ")}) · ${p.textStyles.length} text styles · ${p.effectStyles.length} effect styles`,
    `In the file: ${s.file.counts.variables} variables · ${s.file.counts.textStyles} text styles · ${s.file.counts.effectStyles} effect styles`,
    `Not in Figma: ${p.notInFigma.length} · refused: ${p.refused.length} · axes out: ${p.axesOut.map((a) => `${a.name} (${a.reason})`).join(", ") || "none"}`,
    `Status: ${s.status.status}${link.incomplete ? " · import incomplete" : ""} · local edits ${s.status.local.length} · repository changes ${s.status.repo.length} · removed in the repository ${s.file.removed.length}`,
  );
  const issues = [...p.issues, ...(link.incomplete?.issues ?? [])];
  lines.push(`Issues (${issues.length}):`, ...issues.slice(0, 200).map((i) => `  [${i.level}] ${i.message}`));
  return lines.join("\n");
}
