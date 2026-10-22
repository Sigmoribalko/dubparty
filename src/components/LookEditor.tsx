import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { BODY_COLORS, LOOK_PARTS, PART_ORDER, randomLook, type Look, type LookPart } from "../lib/look";
import { setLook, useLook } from "../state/look";
import { Avatar, Nick } from "./Avatar";
import { Modal } from "./Modal";

/** Pick your avatar part by part (each option drawn on your own character) and a colour for your name. */
export function LookEditor({ name, onClose }: { name: string; onClose(): void }) {
  const t = useT();
  const [draft, setDraft] = useState(useLook.getState().look);
  const parts = useRef<HTMLDivElement>(null);
  // On phones each part is one scrolling row: bring the current choice into view.
  useEffect(() => {
    parts.current?.querySelectorAll<HTMLElement>(".look-options").forEach((row) => {
      const on = row.querySelector<HTMLElement>('[aria-checked="true"]');
      if (on) row.scrollLeft = on.offsetLeft - row.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
    });
  }, [draft]);
  const label: Record<LookPart, string> = { body: t.look.body, eyes: t.look.eyes, mouth: t.look.mouth, hat: t.look.hat, nick: t.look.nick };
  const option = (part: LookPart, i: number) => {
    if (part === "body") return <span className="look-swatch" style={{ background: BODY_COLORS[i] }} />;
    if (part === "nick") return <Nick name="Aa" look={{ ...draft, nick: i }} />;
    return <Avatar look={{ ...draft, [part]: i }} size={40} />;
  };
  return (
    <Modal
      title={t.look.title}
      onClose={onClose}
      actions={
        <>
          <button className="ghost" onClick={() => setDraft(randomLook())}>{t.look.random}</button>
          <div className="spacer" />
          <button onClick={onClose}>{t.common.cancel}</button>
          <button className="primary" onClick={() => { setLook(draft); onClose(); }}>{t.look.done}</button>
        </>
      }
    >
      <div className="look-preview">
        <Avatar key={PART_ORDER.map((k) => draft[k]).join()} look={draft} size={88} className="pop" />
        <b><Nick name={name.trim() || t.online.guest} look={draft} /></b>
      </div>
      <div className="stack" ref={parts}>
        {PART_ORDER.map((part) => (
          <div className="look-part" key={part} role="radiogroup" aria-label={label[part]}>
            <span className="muted fine">{label[part]}</span>
            <div className="look-options">
              {Array.from({ length: LOOK_PARTS[part] }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={draft[part] === i}
                  aria-label={t.look.option(i + 1)}
                  className={"look-option" + (part === "nick" ? " nick-option" : "")}
                  onClick={() => setDraft({ ...draft, [part]: i } as Look)}
                >
                  {option(part, i)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Your avatar as a button that opens the editor (lobby, name fields, profile). */
export function LookButton({ name, size = 32 }: { name: string; size?: number }) {
  const t = useT();
  const look = useLook((s) => s.look);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="look-btn" title={t.look.edit} aria-label={t.look.edit} onClick={() => setOpen(true)}>
        <Avatar look={look} size={size} />
        <span className="look-btn-pen" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
        </span>
      </button>
      {open && <LookEditor name={name} onClose={() => setOpen(false)} />}
    </>
  );
}
