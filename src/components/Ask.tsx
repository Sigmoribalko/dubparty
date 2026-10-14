import { useEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { t as dict, useT } from "../i18n";
import { prefersReducedMotion } from "../lib/util";
import { useRoom } from "../net/room";

/*
 * Our own "are you sure?" dialog instead of window.confirm(): the browser's box looks foreign
 * (it even says "dubparty.ru" on top) and can't be animated. ask() opens it and resolves with
 * the answer once the dialog has animated away.
 */

type Kind = "leave" | "delete" | "kick" | "ban" | "redo";
export interface Question { title: string; text?: string; ok: string; kind: Kind; danger?: boolean }
interface Open extends Question { id: number; resolve(yes: boolean): void }

const useAsk = create<{ open: Open | null }>(() => ({ open: null }));
let seq = 0;
/** How long the closing animation runs (motion.css: `.modal.ask.out`). */
const OUT_MS = 190;

export function ask(q: Question): Promise<boolean> {
  return new Promise((resolve) => {
    useAsk.getState().open?.resolve(false);
    useAsk.setState({ open: { ...q, id: ++seq, resolve } });
  });
}

/** "Leave the room?" The host is told that the room closes for everyone. */
export const askLeave = () => ask({ ...dict().online.leaveConfirm(useRoom.getState().isHost), kind: "leave", danger: true });

/** Mount once: shows whatever ask() is waiting for. */
export function Asker() {
  const open = useAsk((s) => s.open);
  return open ? <Dialog key={open.id} q={open} /> : null;
}

function Dialog({ q }: { q: Open }) {
  const t = useT();
  const [answer, setAnswer] = useState<boolean | null>(null);
  const answered = useRef(false);
  const panel = useRef<HTMLDivElement>(null);

  const reply = useRef((yes: boolean) => {
    if (answered.current) return;
    answered.current = true;
    setAnswer(yes);
    const done = () => {
      if (useAsk.getState().open?.id === q.id) useAsk.setState({ open: null });
      q.resolve(yes);
    };
    if (prefersReducedMotion()) done();
    else setTimeout(done, OUT_MS);
  });

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // Destructive questions start on "Cancel", so a stray Enter doesn't do the damage.
    panel.current?.querySelector<HTMLElement>(q.danger ? "button.cancel" : "button.ok")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // a modal underneath stays open
        reply.current(false);
      } else if (e.key === "Tab") {
        const list = [...(panel.current?.querySelectorAll<HTMLElement>("button") ?? [])];
        if (!list.length) return;
        e.preventDefault();
        const i = list.indexOf(document.activeElement as HTMLElement);
        list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length].focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); prev?.focus?.(); };
  }, [q.danger]);

  const state = answer === null ? "" : answer ? " out yes" : " out";
  return (
    <div className={"modal ask" + state} onMouseDown={(e) => { if (e.target === e.currentTarget) reply.current(false); }}>
      <div
        className={`panel stack ask-panel ${q.kind}${q.danger ? " danger" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ask-title"
        aria-describedby={q.text ? "ask-text" : undefined}
        ref={panel}
      >
        <div className="ask-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {GLYPHS[q.kind]}
          </svg>
        </div>
        <h3 id="ask-title">{q.title}</h3>
        {q.text && <p id="ask-text" className="muted">{q.text}</p>}
        <div className="ask-actions">
          <button className="cancel" onClick={() => reply.current(false)}>{t.common.cancel}</button>
          <button className={"ok " + (q.danger ? "danger-fill" : "primary")} onClick={() => reply.current(true)}>{q.ok}</button>
        </div>
      </div>
    </div>
  );
}

/** Each picture has parts that move (motion.css): a door swings open, a lid lifts, a ban sign draws itself. */
const GLYPHS: Record<Kind, ReactNode> = {
  leave: (
    <>
      <path d="M5 21V3h10v18" />
      <g className="leaf">
        <path d="M5 3h10v18H5z" fill="currentColor" fillOpacity="0.16" />
        <circle cx="12.6" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
      </g>
      <path className="arr" d="M10 12.5h11m-3-3 3 3-3 3" />
    </>
  ),
  kick: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c.7-3.3 2.9-5.2 5.5-5.2s4.8 1.9 5.5 5.2" />
      <path className="arr" d="M15.5 11.5H21m-2.5-2.5 2.5 2.5-2.5 2.5" />
    </>
  ),
  ban: (
    <>
      <circle className="draw" cx="12" cy="12" r="8.5" pathLength={1} />
      <path className="draw slash" d="M6 6l12 12" pathLength={1} />
    </>
  ),
  delete: (
    <>
      <g className="lid">
        <path d="M4 6.5h16" />
        <path d="M9.5 6.5V4h5v2.5" />
      </g>
      <path d="M6 6.5 7 20h10l1-13.5" />
      <path d="M10 10.5V16M14 10.5V16" />
    </>
  ),
  redo: (
    <g className="spin">
      <path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3" />
      <path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3" />
      <path d="M17.5 3.5v3.3h-3.3" />
      <path d="M6.5 20.5v-3.3h3.3" />
    </g>
  ),
};
