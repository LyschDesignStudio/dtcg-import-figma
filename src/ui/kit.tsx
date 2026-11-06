/* The panel's small parts, shared by its screens: a callout for what the
   person should notice, a chip for a name, a labelled
   field, a menu. They carry the look; the screens carry the words. */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_ICON: Record<Tone, IconName> = { neutral: "info", info: "info", success: "check", warning: "alert", danger: "alert" };

/** What the person should notice: a state, a result, an error, with what they can do about it. */
export function Callout({ tone = "neutral", icon, children, actions }: { tone?: Tone; icon?: IconName | null; children: ReactNode; actions?: ReactNode }) {
  const name = icon === undefined ? TONE_ICON[tone] : icon;
  return (
    <div className={`callout ${tone}`} role={tone === "danger" ? "alert" : undefined}>
      {name && <span className="callout-icon"><Icon name={name} /></span>}
      <div className="callout-body">
        {children}
        {actions ? <div className="row">{actions}</div> : null}
      </div>
    </div>
  );
}

/** A name that is code: a branch, a folder. */
export function Chip({ icon, children }: { icon?: IconName; children: ReactNode }) {
  return (
    <span className="chip">
      {icon && <Icon name={icon} size={12} />}
      <code>{children}</code>
    </span>
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/** The less common actions of a screen, out of the way: a button that opens a short list. */
export function Menu({ label, items }: { label: string; items: { label: string; icon?: IconName; onSelect: () => void; danger?: boolean; disabled?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "pointerdown" && box.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  if (!items.length) return null;
  return (
    <div className="menu" ref={box}>
      <button type="button" className="icon-only quiet" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="more" size={14} />
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {items.map((i) => (
            <button key={i.label} type="button" role="menuitem" className={i.danger ? "danger" : ""} disabled={i.disabled} onClick={() => { setOpen(false); i.onSelect(); }}>
              {i.icon && <Icon name={i.icon} size={14} />}
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
