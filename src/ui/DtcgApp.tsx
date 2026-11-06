/* A Figma file that imports a tokens repository, as an assistant: what the
   plugin can work out (the folder, the layout, the mapping, the rem base) is
   assumed and kept under Details; the designer is asked only what it can't
   (an ambiguous file, adopting what's already in the file). Once connected,
   the panel says one thing (up to date, changes, edits) with the one action
   that goes with it, and the rest waits in sections that open on request.
   Nothing here writes to the repository. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { call, onProgress } from "./bridge";
import { Icon, type IconName } from "./icons";
import { Callout, Chip, Field, Menu } from "./kit";
import type { Adoption, ApplyResult, Preview, Progress } from "../apply";
import { findTokenFolders, type TokenFolder } from "../detect";
import { DtcgGitHub, type RepoRef } from "../github";
import type { DtcgLink, Format, Mapping, Plan, SnapValue } from "../model";
import type { TokenChange } from "../status";
import { mappingDoubts } from "../readers/mapped";
import { DtcgSync, report, type Choice, type DtcgLinked, type Inspection } from "../sync";
import { ConnectGitHub, kindLine, type Connected } from "./ConnectGitHub";
import { rememberDtcg, tokenOf } from "./keys";
import { d, fontNotes, FORMAT_NAMES } from "./strings";

export { DTCG_KEYS, rememberDtcg } from "./keys";

const title = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const named = (r: Pick<RepoRef, "owner" | "name">) => `${r.owner}/${r.name}`;

/**
 * The repository comes from the file's own link; a file with none follows what was just connected (`initial`), or
 * shows the connect form, which starts from the last repository and token but finds the folder again.
 */
export function DtcgApp({ initial }: { initial?: Connected | null }) {
  const [repo, setRepo] = useState<RepoRef | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [link, setLink] = useState<DtcgLink | null>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<DtcgLinked | null>(null);
  const [checked, setChecked] = useState<Date | null>(null);
  const [unlinked, setUnlinked] = useState(false);
  const [settings, setSettings] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => onProgress(setProgress), []);

  const sync = useMemo(() => (repo ? new DtcgSync(new DtcgGitHub(repo, token ?? "")) : null), [repo, token]);

  /* The file's link says which folder it follows; the computer's storage only gives the token for that repository. */
  useEffect(() => {
    (async () => {
      const l = await call("dtcgLink");
      setLink(l);
      const r = l?.repo ?? initial?.repo ?? null;
      if (r) {
        const tk = !l && initial ? initial.token : await tokenOf(r);
        setRepo(r);
        setToken(tk);
        setBranch(l?.branch ?? initial?.branch ?? null);
      }
      setReady(true);
    })().catch((e) => {
      setError((e as Error).message);
      setReady(true);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    if (!sync) return;
    try {
      const s = await sync.state();
      setState(s.kind === "linked" ? s : null);
      if (s.kind === "linked") setLink(s.link);
      setUnlinked(s.kind !== "linked");
      setChecked(new Date());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [sync]);
  useEffect(() => void refresh(), [refresh]);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>, after: "refresh" | "none" = "refresh") => {
      setBusy(label);
      setError(null);
      setDone(null);
      setProgress(null);
      try {
        const r = (await fn()) as ApplyResult | undefined;
        if (r && "incomplete" in r && !r.incomplete) setDone(d.done(r.state.counts.variables, r.state.counts.textStyles, r.state.counts.effectStyles));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (after === "refresh") await refresh();
        setBusy(null);
      }
    },
    [refresh],
  );

  /* The variables stay; only the link goes, and the panel goes back to the first screen. */
  const cancelSync = async () => {
    const r = link?.repo ?? repo;
    if (!r || !confirm(d.cancelSyncConfirm(named(r)))) return;
    await call("dtcgSetLink", { link: null });
    setLink(null);
    setState(null);
    setRepo(null);
    setToken(null);
    setConfiguring(false);
    setSettings(false);
    setUnlinked(false);
    setError(null);
    setDone(null);
  };

  if (!ready) return <Loading />;
  if (!repo) {
    return (
      <ConnectGitHub
        onConnected={async (c) => {
          await rememberDtcg(c);
          setRepo(c.repo);
          setBranch(c.branch);
          setToken(c.token);
        }}
      />
    );
  }

  const linkedHere = !!link;
  const loading = !!sync && !state && !unlinked && !error && !configuring;
  const menu = [
    ...(linkedHere ? [{ label: d.configure, onSelect: () => { setSettings(false); setConfiguring(true); } }] : []),
    ...(state ? [{ label: d.copyReport, onSelect: () => {
      void navigator.clipboard?.writeText(report(state)).catch(() => {});
      setDone(d.copied);
    } }] : []),
    ...(linkedHere ? [{ label: d.cancelSync, danger: true, disabled: !!busy, onSelect: () => void cancelSync() }] : []),
  ];

  return (
    <div className="dtcg">
      <header className="dtcg-head">
        <Chip icon="github">{named(repo)}</Chip>
        <div className="grow" />
        {menu.length > 0 && !loading && <Menu label={d.menu} items={menu} />}
      </header>
      {busy && <div className="progress"><div style={{ width: progress?.total ? `${Math.round((progress.done / progress.total) * 100)}%` : "30%" }} className={progress?.total ? "" : "indeterminate"} /></div>}
      {error && <Callout tone="danger"><p>{error}</p></Callout>}
      {done && <Callout tone="success"><p>{done}</p></Callout>}
      {loading && <Loading />}
      {configuring && (
        <Configure
          repo={link?.repo ?? repo}
          token={token}
          branch={link?.branch ?? branch}
          current={state}
          busy={busy}
          onCancel={state ? () => setConfiguring(false) : undefined}
          onApply={(next, nextSync, insp, choice, adopt, same) => run(same ? d.apply : d.bring, async () => {
            const r = same && state ? await nextSync.remap(state, choice) : await nextSync.link(insp, choice, adopt);
            await rememberDtcg(next);
            setConfiguring(false);
            setState(null);
            setUnlinked(false);
            setRepo(next.repo);
            setToken(next.token);
            setBranch(next.branch);
            return r;
          }, "none")}
        />
      )}
      {!configuring && sync && (unlinked || settings) && (
        <Ready
          sync={sync}
          branch={branch}
          current={settings ? state : null}
          busy={busy}
          onLink={(insp, choice, adopt) => run(settings ? d.apply : d.bring, async () => {
            const r = settings && state ? await sync.remap(state, choice) : await sync.link(insp, choice, adopt);
            setSettings(false);
            return r;
          })}
          onCancel={settings ? () => setSettings(false) : undefined}
        />
      )}
      {!configuring && sync && state && !settings && <Panel s={state} sync={sync} busy={busy} checked={checked} run={run} onPlace={() => setSettings(true)} onCheck={() => void run(d.check, async () => {})} />}
    </div>
  );
}

/** While the panel reads the repository and the file, before it can say where the file stands. */
function Loading() {
  return (
    <section className="card loading-state" role="status" aria-live="polite">
      <p className="working"><i className="spinner" aria-hidden /> {d.checking}</p>
    </section>
  );
}

/* ───── change configuration: the same repository, another token, folder or branch; then the settings ───── */

function Configure({ repo, token, branch: linkBranch, current, busy, onApply, onCancel }: {
  repo: RepoRef;
  token: string | null;
  branch: string | null;
  current: DtcgLinked | null;
  busy: string | null;
  onApply: (next: { repo: RepoRef; token: string; branch: string }, sync: DtcgSync, insp: Inspection, choice: Choice, adopt: boolean, same: boolean) => void;
  onCancel?: () => void;
}) {
  const [typed, setTyped] = useState(token ?? "");
  const [tk, setTk] = useState(token ?? "");
  const [branch, setBranch] = useState(linkBranch ?? "");
  const [branches, setBranches] = useState<string[]>([]);
  const [folder, setFolder] = useState(repo.folder);
  const [folders, setFolders] = useState<TokenFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const whole = useMemo(() => new DtcgGitHub({ ...repo, folder: "" }, tk), [repo, tk]);

  useEffect(() => {
    let live = true;
    setError(null);
    whole.branches().then((list) => {
      if (!live) return;
      setBranches(list);
      setBranch((b) => b || list[0]);
    }, (e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [whole]);

  /* The folders of tokens on that branch. */
  useEffect(() => {
    if (!branch) return;
    let live = true;
    setFolders(null);
    whole.head(branch).then((sha) => whole.list(sha)).then((entries) => {
      if (!live) return;
      setFolders(findTokenFolders(entries.map((e) => e.path)));
    }, (e) => live && (setFolders([]), setError((e as Error).message)));
    return () => {
      live = false;
    };
  }, [whole, branch]);

  const options = folders ? (folders.some((f) => f.folder === folder) || !folder ? folders : [{ folder, kind: current?.link.format ?? "mapped" } as TokenFolder, ...folders]) : [];
  const target = { ...repo, folder };
  const same = !!current && folder === current.link.repo.folder && branch === current.link.branch;
  const sync = useMemo(() => new DtcgSync(new DtcgGitHub(target, tk)), [tk, folder, repo]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <section className="card configure">
        <div className="lead">
          <h2>{d.configure}</h2>
          <p className="muted">{d.configureHint(named(repo))}</p>
        </div>
        <Field label={d.token} htmlFor="cfg-token" hint={token ? d.savedToken : d.tokenHint}>
          <input id="cfg-token" type="password" value={typed} onChange={(e) => setTyped(e.target.value)} onBlur={() => setTk(typed.trim())} onKeyDown={(e) => e.key === "Enter" && setTk(typed.trim())} placeholder="github_pat_…" spellCheck={false} />
        </Field>
        <Field label={d.branch} htmlFor="cfg-branch">
          <select id="cfg-branch" value={branch} disabled={!branches.length} onChange={(e) => setBranch(e.target.value)}>
            {(branches.length ? branches : [branch]).map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label={d.folder} htmlFor="cfg-folder" hint={folders === null ? d.folderLoading : folders && !folders.length ? d.noFolders : undefined}>
          <select id="cfg-folder" value={folder} disabled={!options.length} onChange={(e) => setFolder(e.target.value)}>
            {(options.length ? options : [{ folder, kind: "mapped" } as TokenFolder]).map((f) => <option key={f.folder} value={f.folder}>{`${f.folder || d.root} · ${kindLine(f.kind)}`}</option>)}
          </select>
        </Field>
        {error && <Callout tone="danger"><p>{error}</p></Callout>}
      </section>
      {branch && !error && (
        <Ready
          key={`${folder}@${branch}:${tk}`}
          sync={sync}
          branch={branch}
          branchFixed
          current={same ? current : null}
          busy={busy}
          onLink={(insp, choice, adopt) => onApply({ repo: target, token: tk, branch }, sync, insp, choice, adopt, same)}
          onCancel={onCancel}
        />
      )}
      {(!branch || error) && onCancel && <button className="quiet block" onClick={onCancel}>{d.cancel}</button>}
    </>
  );
}

/* ───── ready: what will come in, the questions that need an answer, the rest under Details ───── */

function Ready({ sync, branch: initialBranch, branchFixed, current, busy, onLink, onCancel }: { sync: DtcgSync; branch: string | null; branchFixed?: boolean; current: DtcgLinked | null; busy: string | null; onLink: (i: Inspection, c: Choice, adopt: boolean) => void; onCancel?: () => void }) {
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState(current?.link.branch ?? initialBranch ?? "");
  const [insp, setInsp] = useState<Inspection | null>(null);
  const [format, setFormat] = useState<Format | null>(current?.link.format ?? null);
  const [mapping, setMapping] = useState<Mapping | undefined>(current?.link.mapping);
  const [resolver, setResolver] = useState<string | undefined>(current?.link.resolver);
  const [remBase, setRemBase] = useState(current?.link.remBase ?? 16);
  const [library, setLibrary] = useState(!!current?.link.library);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [adoption, setAdoption] = useState<Adoption | null>(null);
  const [adopt, setAdopt] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (branchFixed) return;
    sync.gh.branches().then((list) => {
      setBranches(list);
      setBranch((b) => b || list[0]);
    }, (e) => setError((e as Error).message));
  }, [sync]);

  /* Read the folder at the branch, and assume what it says. */
  useEffect(() => {
    if (!branch) return;
    let live = true;
    setInsp(null);
    setPlan(null);
    sync.inspect(branch).then((i) => {
      if (!live) return;
      setInsp(i);
      const fits = i.detection.candidates;
      setFormat((f) => (f && fits.includes(f) ? f : i.detection.suggested ?? fits[0] ?? null));
      setResolver((r) => r ?? i.detection.resolvers[0]);
      setMapping((m) => m ?? i.suggestion);
    }, (e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [branch]); // eslint-disable-line react-hooks/exhaustive-deps

  const choice: Choice | null = format ? { format, resolver, mapping: format === "mapped" ? mapping : undefined, remBase, library } : null;
  useEffect(() => {
    if (!insp || !choice) return;
    let live = true;
    sync.planAt(insp.sha, choice, insp.repo.name).then(
      async ({ plan: p }) => {
        if (!live) return;
        setPlan(p);
        setError(null);
        const a = await sync.adoption(p);
        if (live) setAdoption(a);
      },
      (e) => live && (setPlan(null), setError((e as Error).message)),
    );
    return () => {
      live = false;
    };
  }, [insp, format, resolver, mapping, remBase, library]); // eslint-disable-line react-hooks/exhaustive-deps

  const doubts = insp && format === "mapped" && mapping ? mappingDoubts(insp.files, mapping) : { files: [], axes: [] };
  const adoptable = adoption && (adoption.collections.length || adoption.variables || adoption.styles.length) ? adoption : null;
  const candidates = insp ? insp.detection.candidates : [];
  const styles = plan ? plan.textStyles.length + plan.effectStyles.length : 0;
  const things = adoptable
    ? [
        ...(adoptable.collections.length ? [`the ${adoptable.collections.join(", ")} collection${adoptable.collections.length === 1 ? "" : "s"}`] : []),
        ...(adoptable.variables ? [`${adoptable.variables} variable${adoptable.variables === 1 ? "" : "s"}`] : []),
        ...(adoptable.styles.length ? [`${adoptable.styles.length} style${adoptable.styles.length === 1 ? "" : "s"}`] : []),
      ].join(", ")
    : "";

  return (
    <section className="card ready">
      <div className="lead">
        <h2>{current ? d.settings : d.readyTitle}</h2>
        {plan && insp ? (
          <>
            <p className="figure">{d.counts(plan.variables.length, styles)}</p>
            <p className="muted">{d.from(plan.collections.map((c) => c.name), sync.gh.repo.folder, insp.branch)}</p>
          </>
        ) : (
          !error && <p className="muted working"><i className="spinner" aria-hidden /> {d.reading}</p>
        )}
      </div>
      {error && <Callout tone="danger"><p>{error}</p></Callout>}

      {doubts.files.length > 0 && mapping && (
        <div className="question">
          <p className="strong">{d.doubtTitle(doubts.files.length)}</p>
          <p className="muted">{d.doubtHint}</p>
          <RoleRows files={doubts.files} mapping={mapping} onChange={setMapping} />
        </div>
      )}
      {adoptable && !current && (
        <div className="question">
          <p className="strong">{d.adoptQuestion(things)}</p>
          <div className="options" role="radiogroup">
            <label className={`option${adopt ? " on" : ""}`}><input type="radio" name="adopt" checked={adopt} onChange={() => setAdopt(true)} /><span>{d.adoptUse}</span></label>
            <label className={`option${!adopt ? " on" : ""}`}><input type="radio" name="adopt" checked={!adopt} onChange={() => setAdopt(false)} /><span>{d.adoptNew}</span></label>
          </div>
        </div>
      )}
      {adoption?.tokensStudio && <Callout tone="warning"><p>{d.tokensStudio}</p></Callout>}

      <div className="actions">
        <button className="primary block" disabled={!!busy || !plan || !choice || !insp} onClick={() => insp && choice && onLink(insp, choice, adopt)}>{busy ?? (current ? d.apply : d.bring)}</button>
        {onCancel && <button className="quiet block" onClick={onCancel}>{d.cancel}</button>}
      </div>

      <details className="disclosure" open={current ? true : undefined}>
        <summary>{d.details}</summary>
        <div className="stack">
          {plan && (
            <dl className="facts">
              <dt>{d.collections}</dt>
              <dd>{plan.collections.map((c) => <span key={c.key}>{c.name}{c.modes.length > 1 ? <span className="muted"> · {c.modes.map((m) => m.name).join(", ")}</span> : null}</span>)}</dd>
              {(plan.axesOut.length > 0 || plan.notInFigma.length > 0) && (
                <>
                  <dt>{d.staysOut}</dt>
                  <dd>
                    {plan.axesOut.map((a) => <span key={a.name}>{title(a.name)} <span className="muted">· {a.reason === "empty" ? d.emptyAxis : d.notInFigma(a.count)}</span></span>)}
                    {plan.notInFigma.length > plan.axesOut.reduce((n, a) => n + a.count, 0) && <span className="muted">{d.notInFigma(plan.notInFigma.length)}</span>}
                  </dd>
                </>
              )}
            </dl>
          )}
          {!branchFixed && (
            <Field label={d.branch} htmlFor="dtcg-branch">
              <select id="dtcg-branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
                {(branches.length ? branches : [branch]).map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
          )}
          {candidates.length > 1 && (
            <Field label={d.layout} htmlFor="dtcg-layout" hint={format ? d.layoutHint[format as keyof typeof d.layoutHint] : undefined}>
              <select id="dtcg-layout" value={format ?? ""} onChange={(e) => setFormat(e.target.value as Format)}>
                {candidates.map((c) => <option key={c} value={c}>{FORMAT_NAMES[c]}</option>)}
              </select>
            </Field>
          )}
          {format === "resolver" && insp && insp.detection.resolvers.length > 1 && (
            <Field label="Resolver" htmlFor="dtcg-resolver">
              <select id="dtcg-resolver" value={resolver} onChange={(e) => setResolver(e.target.value)}>
                {insp.detection.resolvers.map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
          )}
          {format === "mapped" && mapping && insp && <MappingEditor files={insp.files.tokenFiles} extensionKeys={Object.keys(insp.extensionKeys)} mapping={mapping} onChange={setMapping} />}
          <Field label={d.remBase} htmlFor="dtcg-rem">
            <input id="dtcg-rem" className="short" type="number" min={1} value={remBase} onChange={(e) => setRemBase(Number(e.target.value) || 16)} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={library} onChange={(e) => setLibrary(e.target.checked)} />
            <span className="check-body"><span>{d.library}</span><span className="hint">{d.libraryHint}</span></span>
          </label>
          {plan && plan.issues.length > 0 && (
            <div className="stack tight">
              <p className="label">{d.notes}</p>
              <ul className="notes">{plan.issues.slice(0, 50).map((i, n) => <li key={n} className={i.level}>{i.message}</li>)}</ul>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

function RoleRows({ files, mapping, onChange }: { files: string[]; mapping: Mapping; onChange: (m: Mapping) => void }) {
  const set = (file: string, value: Mapping["files"][string]) => {
    const next: Mapping = { ...mapping, files: { ...mapping.files, [file]: value }, axes: { ...(mapping.axes ?? {}) } };
    if (value.kind === "context" && value.axis && value.context) {
      const a = next.axes![value.axis] ?? { contexts: [], default: "" };
      const contexts = a.contexts.includes(value.context) ? a.contexts : [...a.contexts, value.context];
      next.axes![value.axis] = contexts.length === 1 ? { contexts: ["default", ...contexts], default: "default" } : { contexts, default: a.default || contexts[0] };
    }
    onChange(next);
  };
  return (
    <div className="roles-list">
      {files.map((f) => {
        const m = mapping.files[f] ?? { kind: "out" as const };
        return (
          <div key={f} className="role">
            <code className="file">{f}</code>
            <div className="role-fields">
              <select aria-label={`${f}: role`} value={m.kind} onChange={(e) => set(f, e.target.value === "context" ? { kind: "context", axis: "", context: "" } : { kind: e.target.value as "base" | "out" })}>
                <option value="base">{d.base}</option>
                <option value="context">{d.context}</option>
                <option value="out">{d.out}</option>
              </select>
              {m.kind === "context" && (
                <>
                  <input aria-label={`${f}: ${d.axis}`} placeholder={d.axis} value={m.axis} onChange={(e) => set(f, { ...m, axis: e.target.value.trim() })} />
                  <input aria-label={`${f}: ${d.contextName}`} placeholder={d.contextName} value={m.context} onChange={(e) => set(f, { ...m, context: e.target.value.trim() })} />
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MappingEditor({ files, extensionKeys, mapping, onChange }: { files: string[]; extensionKeys: string[]; mapping: Mapping; onChange: (m: Mapping) => void }) {
  const [editing, setEditing] = useState(false);
  const roleOf = (f: string) => {
    const m = mapping.files[f];
    return !m || m.kind === "out" ? d.out : m.kind === "base" ? d.base : `${m.axis} · ${m.context}`;
  };
  if (!editing) {
    return (
      <div className="stack tight">
        <div className="row between">
          <p className="label">{d.roles}</p>
          <button className="link" onClick={() => setEditing(true)}>{d.edit}</button>
        </div>
        <dl className="facts roles-summary">
          {files.map((f) => (
            <div key={f} className="fact-row"><dt><code>{f}</code></dt><dd>{roleOf(f)}</dd></div>
          ))}
        </dl>
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="stack tight">
        <p className="label">{d.roles}</p>
        <p className="hint">{d.rolesHint}</p>
      </div>
      <RoleRows files={files} mapping={mapping} onChange={onChange} />
      {Object.entries(mapping.axes ?? {}).map(([axis, a]) => (
        <Field key={axis} label={d.axisModes(axis)} htmlFor={`dtcg-axis-${axis}`}>
          <input
            id={`dtcg-axis-${axis}`}
            value={[a.default, ...a.contexts.filter((c) => c !== a.default)].join(", ")}
            onChange={(e) => {
              const list = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
              onChange({ ...mapping, axes: { ...mapping.axes, [axis]: { contexts: list, default: list[0] ?? "" } } });
            }}
          />
        </Field>
      ))}
      {extensionKeys.length > 0 && (
        <Field label={d.extension} htmlFor="dtcg-ext">
          <select id="dtcg-ext" value={mapping.extension?.key ?? ""} onChange={(e) => onChange({ ...mapping, extension: e.target.value ? { key: e.target.value, defaults: mapping.extension?.defaults ?? {} } : null })}>
            <option value="">{d.extensionNone}</option>
            {extensionKeys.map((k) => <option key={k}>{k}</option>)}
          </select>
        </Field>
      )}
    </div>
  );
}

/* ───── the linked file: one state, one action; the rest on request ───── */

const shown = (v: SnapValue | undefined) => (!v ? "—" : "alias" in v ? `{${v.alias}}` : String(v.literal));
/** "Repository 4 · Figma 6": the first mode where the edit differs (and its name, when the token has several). */
function editOf(c: TokenChange): string {
  if (!c.to) return d.deletedInFigma;
  const modes = Object.keys(c.from?.values ?? c.to.values);
  const mode = modes.find((m) => JSON.stringify(c.from?.values[m]) !== JSON.stringify(c.to?.values[m])) ?? modes[0];
  const where = modes.length > 1 ? `${mode.split("|").map((p) => p.split("=")[1]).join(" · ")}: ` : "";
  return `${where}${d.repository} ${shown(c.from?.values[mode])} · ${d.figma} ${shown(c.to.values[mode])}`;
}

const STATE_ICON: Record<string, { icon: IconName; tone: string }> = {
  "in-step": { icon: "check", tone: "success" },
  "repo-ahead": { icon: "info", tone: "info" },
  "local-edits": { icon: "alert", tone: "warning" },
  diverged: { icon: "alert", tone: "warning" },
  incomplete: { icon: "alert", tone: "danger" },
};

function Panel({ s, sync, busy, checked, run, onPlace, onCheck }: { s: DtcgLinked; sync: DtcgSync; busy: string | null; checked: Date | null; run: (label: string, fn: () => Promise<unknown>) => Promise<void>; onPlace: () => void; onCheck: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const st = s.status;
  const kind = s.link.incomplete ? "incomplete" : st.status;
  const heading = kind === "incomplete" ? d.title.incomplete : kind === "repo-ahead" ? d.title["repo-ahead"](st.repo.length) : kind === "local-edits" ? d.title["local-edits"](st.local.length) : kind === "diverged" ? d.title.diverged : d.title["in-step"];
  const needsUpdate = kind !== "in-step";
  const doUpdate = () => {
    setPreview(null);
    return run(d.update, () => sync.update(s));
  };
  const toDelete = Object.keys(selected).filter((k) => selected[k]);
  const p = s.head.plan;
  const notes = [
    ...fontNotes(s.link.fonts ?? []),
    ...p.axesOut.map((a) => `${title(a.name)}: ${a.reason === "empty" ? d.emptyAxis : d.notInFigma(a.count)}`),
    ...(s.file.added.length ? [d.addedInFigma(s.file.added.length)] : []),
    ...(s.file.misplaced.length ? [d.misplaced(s.file.misplaced.length)] : []),
    ...p.issues.map((i) => i.message),
  ];
  const { icon, tone } = STATE_ICON[kind];
  const time = checked ? `${String(checked.getHours()).padStart(2, "0")}:${String(checked.getMinutes()).padStart(2, "0")}` : "";

  return (
    <>
      <section className="card state">
        <div className="state-head">
          <span className={`state-icon ${tone}`}><Icon name={icon} size={16} /></span>
          <div className="grow">
            <h2>{heading}</h2>
            <p className="muted">{d.where(s.link.repo.folder, s.link.branch)}{time ? ` · ${time}` : ""}</p>
          </div>
        </div>

        {s.link.incomplete && (
          <div className="stack tight">
            <p className="muted">{d.incompleteHint}</p>
            <ul className="notes">
              {s.link.incomplete.issues.slice(0, 5).map((i, n) => <li key={n} className="error">{i.message}</li>)}
              {s.link.incomplete.issues.length > 5 && <li className="muted">{d.more(s.link.incomplete.issues.length - 5)}</li>}
            </ul>
          </div>
        )}

        {st.local.length > 0 && (
          <div className="stack tight">
            <p className="muted">{d.localHint}</p>
            <ul className="list tight">
              {st.local.map((c) => (
                <li key={c.path}>
                  <div className="edit">
                    <code>{c.path}</code>
                    <span className="muted">{editOf(c)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {preview ? (
          <div className="confirm">
            <p><span className="strong">{d.previewTitle}</span> {d.preview(preview.created, preview.changed, preview.removed.length, preview.replaced.length)}.</p>
            {preview.replaced.length > 0 && <ul className="notes">{preview.replaced.map((r) => <li key={r.from}><code>{r.from}</code> → <code>{r.to}</code></li>)}</ul>}
            {s.link.library && (preview.removed.length > 0 || preview.replaced.length > 0) && <p className="warning">{d.previewLibrary}</p>}
            <div className="row">
              <button className="primary" disabled={!!busy} onClick={() => void doUpdate()}>{d.update}</button>
              <button className="quiet" onClick={() => setPreview(null)}>{d.cancel}</button>
            </div>
          </div>
        ) : (
          <div className="row">
            {needsUpdate && (
              <button className="primary" disabled={!!busy} onClick={async () => {
                /* Edits made in Figma are replaced: say so first. */
                if (st.local.length && !confirm(d.reimportConfirm(st.local.length))) return;
                const pv = await sync.preview(p);
                /* Nothing removed, renamed or refused: no need to ask. */
                if (!pv.removed.length && !pv.replaced.length && !pv.refused) void doUpdate();
                else setPreview(pv);
              }}>{kind === "local-edits" ? d.reimport : d.update}</button>
            )}
            {/* More edits since: the list is read again from the file. */}
            {kind === "local-edits" && <button className="quiet" disabled={!!busy} onClick={onCheck}>{d.checkAgain}</button>}
            {kind === "in-step" && <button className="link" disabled={!!busy} onClick={onCheck}>{d.check}</button>}
          </div>
        )}
      </section>

      {s.file.removed.length > 0 && (
        <details className="card section">
          <summary>{d.removedTitle}<span className="count">{s.file.removed.length}</span></summary>
          <div className="stack">
            <p className="muted">{d.removedHint}</p>
            <label className="check all">
              <input type="checkbox" checked={toDelete.length === s.file.removed.length} ref={(el) => { if (el) el.indeterminate = toDelete.length > 0 && toDelete.length < s.file.removed.length; }} onChange={(e) => setSelected(Object.fromEntries(s.file.removed.map((r) => [r.id, e.target.checked])))} />
              <span className="strong">{d.selectAll}</span>
            </label>
            <div className="checks">
              {s.file.removed.map((r) => (
                <label key={r.id} className="check">
                  <input type="checkbox" checked={!!selected[r.id]} onChange={(e) => setSelected({ ...selected, [r.id]: e.target.checked })} />
                  <span>{r.name}{r.of ? <span className="muted"> · {r.of}</span> : null}</span>
                </label>
              ))}
            </div>
            <button className="danger" disabled={!!busy || !toDelete.length} onClick={() => confirm(d.deleteConfirm(toDelete.length)) && void run(d.deleteSelected(toDelete.length), async () => {
              await sync.deleteRemoved(toDelete);
              setSelected({});
            })}>{d.deleteSelected(toDelete.length)}</button>
          </div>
        </details>
      )}

      {s.unmapped.length > 0 && (
        <details className="card section" open>
          <summary>{d.unmappedTitle}<span className="count">{s.unmapped.length}</span></summary>
          <div className="stack">
            <p className="muted">{d.unmappedHint}</p>
            <ul className="notes">{s.unmapped.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
            <button onClick={onPlace}>{d.place}</button>
          </div>
        </details>
      )}

      {notes.length > 0 && (
        <details className="card section">
          <summary>{d.notes}<span className="count">{notes.length}</span></summary>
          <ul className="notes">{notes.slice(0, 100).map((n, i) => <li key={i}>{n}</li>)}</ul>
        </details>
      )}
    </>
  );
}
