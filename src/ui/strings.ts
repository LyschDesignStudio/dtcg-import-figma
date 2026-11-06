/* The text of the GitHub connection and of a file that follows a tokens
   repository. The seam for translations. Only what the designer needs. */

import type { FontStandIn } from "../model";

const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const and = (list: string[]) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`);

export const FORMAT_NAMES: Record<string, string> = {
  resolver: "DTCG with a resolver",
  "tokens-studio": "Tokens Studio",
  mapped: "DTCG token files",
};

export const d = {
  /* connect */
  connectTitle: "Connect a GitHub repository",
  connectHint: "The plugin finds the design tokens in it and imports them into this file as variables and styles. It only reads the repository.",
  address: "Repository",
  token: "GitHub token (optional)",
  tokenHint: "Leave empty for a public repository. For a private one, make a fine-grained token on GitHub with access to this repository and the Contents: read permission only. It is kept on this computer.",
  options: "Folder and branch",
  folder: "Folder",
  folderPlaceholder: "found by itself",
  branch: "Branch",
  branchPlaceholder: "the default branch",
  invalid: "Write the repository as owner/name, or paste its github.com address.",
  connect: "Connect",
  looking: "Looking for the tokens…",
  noTokens: (repo: string, branch: string) => `There are no design tokens in ${repo} on ${branch}. If they are in a folder the plugin skips, write it under Folder and branch.`,
  severalTitle: "Tokens are in more than one folder",
  severalHint: "Choose the one this file imports.",
  root: "the root",
  continue: "Continue",

  /* ready */
  readyTitle: "Ready to import",
  counts: (vars: number, styles: number) => `${s(vars, "variable")} · ${s(styles, "style")}`,
  from: (collections: string[], folder: string, branch: string) => `${and(collections)}, from ${folder || "the root"} on ${branch}.`,
  bring: "Import into Figma",
  reading: "Reading the tokens…",
  adoptQuestion: (things: string) => `This file already has ${things} with these names.`,
  adoptUse: "Use them, and keep what is bound to them",
  adoptNew: "Make new ones beside them",
  tokensStudio: "This file also holds Tokens Studio's data. Use one plugin per file, or both will write the same variables.",
  doubtTitle: (n: number) => `${n === 1 ? "A file" : `${n} files`} could be base or a mode`,
  doubtHint: "Say what each one is. The rest was read from the file names.",
  details: "Details",
  layout: "Read as",
  /* What each way of reading a folder takes the modes from: the same files, read another way, give other collections and modes. */
  layoutHint: {
    resolver: "Follows the folder's resolver file: it says which files are the base and which are modes (light and dark, brands, sizes). The way the repository means it to be read.",
    "tokens-studio": "Follows Tokens Studio's $themes: each theme group becomes the modes of a collection.",
    mapped: "Reads each file on its own and guesses its role from its name (color.dark.json is the dark mode). Use it when the folder has no resolver; check the file roles below.",
  },
  roles: "File roles",
  edit: "Edit",
  rolesHint: "A file is base, a mode of an axis (mode = dark), or left out.",
  base: "Base",
  context: "Mode of…",
  out: "Left out",
  axis: "axis",
  contextName: "mode",
  axisModes: (axis: string) => `${axis}: modes, the default first`,
  extension: "Modes inside tokens ($extensions)",
  extensionNone: "None",
  remBase: "1rem in px",
  library: "This file is a published library",
  libraryHint: "Before an import replaces anything, the plugin says what the files using it would lose.",
  collections: "Collections",
  staysOut: "Stays out of Figma",
  emptyAxis: "no tokens yet",
  notInFigma: (n: number) => `${s(n, "token")} Figma has no type for`,
  notes: "Notes",
  apply: "Apply",
  cancel: "Cancel",

  /* the file, linked */
  where: (folder: string, branch: string) => `${folder || "root"} · ${branch}`,
  title: {
    "in-step": "Up to date",
    "repo-ahead": (n: number) => `${s(n, "change")} in the repository`,
    "local-edits": (n: number) => `${s(n, "edit")} made in Figma`,
    diverged: "Changed on both sides",
    incomplete: "The last import didn't finish",
  },
  localHint: "Changed in this file only. Importing again replaces them with the repository's values.",
  repository: "Repository",
  figma: "Figma",
  deletedInFigma: "Deleted in Figma",
  incompleteHint: "Fix what's below, then import again.",
  more: (n: number) => `and ${n} more`,
  update: "Import",
  reimport: "Import again",
  reimportConfirm: (n: number) => `Import again? ${s(n, "edit")} made in Figma will be replaced by the repository's values.`,
  check: "Check for changes",
  checkAgain: "Check again",
  checking: "Checking the repository…",
  previewTitle: "This import will",
  preview: (c: number, ch: number, r: number, rep: number) =>
    and([...(c ? [`add ${s(c, "variable")}`] : []), ...(ch ? [`change ${ch}`] : []), ...(r ? [`list ${r} the repository removed`] : []), ...(rep ? [`replace ${rep} renamed`] : [])]) || "bring the file level",
  previewLibrary: "Files that use this library keep the old variables of what was renamed or removed.",
  selectAll: "Select all",
  fontStandIn: (wanted: string, used: string, weight: number | null, styles: string[]) =>
    `${weight === null ? `${wanted} isn't in this Figma` : `${wanted} has no weight ${weight} in this Figma`}: ${used} stands in for ${s(styles.length, "text style")} (${styles.length > 3 ? `${styles.slice(0, 3).join(", ")} and ${styles.length - 3} more` : and(styles)}). Install ${wanted} and import again.`,
  removedTitle: "Removed in the repository",
  removedHint: "Kept here because designs may still use them. A deleted variable leaves designs with its last value.",
  deleteSelected: (n: number) => (n ? `Delete ${s(n, "item")}` : "Delete"),
  deleteConfirm: (n: number) => `Delete ${s(n, "item")}? Designs that use them keep their last value.`,
  unmappedTitle: "New files",
  unmappedHint: "They stay out until you place them.",
  place: "Place them",
  addedInFigma: (n: number) => `${s(n, "variable")} added in Figma, left as they are`,
  misplaced: (n: number) => `${s(n, "variable")} kept in the collection they were made in`,
  menu: "More",
  settings: "Settings",
  configure: "Change configuration",
  configureHint: (repo: string) => `The same repository, ${repo}. Change its token, folder or branch; the settings follow.`,
  savedToken: "Saved for this repository. Paste a new one to replace it.",
  folderLoading: "Looking for the folders…",
  noFolders: "No folder of tokens on this branch.",
  copyReport: "Copy report for support",
  copied: "Report copied. It has no token.",
  cancelSync: "Disconnect",
  cancelSyncConfirm: (repo: string) => `Disconnect from ${repo}? The variables and styles already in this file stay as they are; they stop following the repository. You can then connect this file to another one.`,
  done: (v: number, t: number, e: number) => `Imported: ${s(v, "variable")}, ${s(t + e, "style")}.`,
};

/** One note per font that stood in, not one per style: "Söhne isn't in this Figma: Inter stands in for 18 text styles…". */
export function fontNotes(list: FontStandIn[]): string[] {
  const groups = new Map<string, FontStandIn[]>();
  for (const f of list) {
    const k = `${f.wanted}|${f.used}|${f.missing}|${f.missing === "weight" ? f.weight : ""}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  return [...groups.values()].map((g) => d.fontStandIn(g[0].wanted, g[0].used, g[0].missing === "weight" ? g[0].weight : null, g.map((f) => f.style)));
}

