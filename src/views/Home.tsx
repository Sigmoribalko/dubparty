import { useState } from "react";
import { Mascot } from "../components/Mascot";
import { useT } from "../i18n";
import { unlockAudio } from "../lib/audio/engine";
import { authEnabled, useAuth } from "../lib/auth/auth";
import { forgetLastRoom, lastRoom, normalizeCode, resumeRoom } from "../net/room";
import { notify, useApp } from "../state/app";
import { buildTutorial, readOnboarding, saveOnboarding } from "../state/tutorial";

/**
 * The first screen. A newcomer is led in three short steps: sign in or play as a guest,
 * try dubbing on a practice scene, then the two ways to play. Anyone who has been here
 * before (or came back for a room) lands on the last one straight away.
 */
export function Home() {
  const { ready, user } = useAuth();
  const [ob, setOb] = useState(readOnboarding);
  const [last, setLast] = useState(lastRoom);
  // The session is still being restored: don't flash the welcome at someone who is signed in.
  if (!ready) return <div className="wrap" />;
  if (authEnabled && !user && !ob.guest && !last) return <div className="wrap"><Welcome onGuest={() => setOb(saveOnboarding({ guest: true }))} /></div>;
  if (!ob.tutorial && !last) return <div className="wrap"><TutorialOffer onSkip={() => setOb(saveOnboarding({ tutorial: "skipped" }))} /></div>;
  return <Play last={last} setLast={setLast} />;
}

/* ---------- step 1: sign in or play as a guest ---------- */

/** Voice effects drifting in the background: a hint at what the game does with your voice. */
const FLOATERS = ["chipmunk", "robot", "giant", "echo", "radio", "underwater"] as const;

function Welcome({ onGuest }: { onGuest(): void }) {
  const t = useT();
  const go = useApp((s) => s.go);
  return (
    <section className="welcome">
      <div className="floaters" aria-hidden="true">
        {FLOATERS.map((id, i) => <span key={id} className="floater" style={{ ["--i" as string]: i }}>{t.effects[id][0]}</span>)}
      </div>
      <Mascot size={84} talking />
      <h1>{t.home.title}</h1>
      <p>{t.welcome.lead}</p>
      <div className="float-actions">
        <button className="float-btn guest" onClick={onGuest}>{t.welcome.guest}</button>
        <button className="float-btn signin" onClick={() => go({ name: "auth", mode: "signin" })}>{t.welcome.signIn}</button>
      </div>
      <p className="muted fine">
        {t.welcome.guestHint} <button className="link" onClick={() => go({ name: "auth", mode: "signup" })}>{t.welcome.signUp}</button>
      </p>
    </section>
  );
}

/* ---------- step 2: try it on a practice scene ---------- */

/** Start the practice round (a scene of our own, on this device only). */
function useTutorial(onUnavailable?: () => void): [busy: boolean, start: () => void] {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    if (busy) return;
    setBusy(true);
    await unlockAudio();
    const game = await buildTutorial();
    setBusy(false);
    if (!game) { notify(t.tutorial.unavailable); onUnavailable?.(); return; }
    useApp.getState().setGame(game);
    useApp.getState().go({ name: "record" });
  };
  return [busy, start];
}

function TutorialOffer({ onSkip }: { onSkip(): void }) {
  const t = useT();
  const [busy, start] = useTutorial(onSkip);
  return (
    <section className="welcome">
      <Mascot size={112} talking />
      <h1 className="smaller">{t.tutorial.offerTitle}</h1>
      <p>{t.tutorial.offerText}</p>
      <div className="float-actions">
        {busy ? (
          <div className="row"><div className="spinner" /><span className="muted">{t.tutorial.loading}</span></div>
        ) : (
          <>
            <button className="float-btn guest" onClick={start}>{t.tutorial.start}</button>
            <button className="ghost" onClick={onSkip}>{t.tutorial.skip}</button>
          </>
        )}
      </div>
    </section>
  );
}

/* ---------- step 3: play with strangers, or with your own friends ---------- */

function Play({ last, setLast }: { last: ReturnType<typeof lastRoom>; setLast(v: null): void }) {
  const t = useT();
  const h = t.home;
  const go = useApp((s) => s.go);
  const [code, setCode] = useState("");
  const [busy, startTutorial] = useTutorial();
  return (
    <div className="wrap stack home">
      {last && (
        <section className="panel notice stack" aria-live="polite">
          <p><b>{last.host ? t.online.resumeHost(last.code) : t.online.resumeGuest(last.code)}</b>{last.scene ? <span className="muted"> · {last.scene}</span> : null}</p>
          <div className="row">
            <button className="primary" onClick={() => {
              if (last.host) { resumeRoom(); go({ name: "online" }); }
              else go({ name: "online", code: last.code });
            }}>{t.online.resume}</button>
            <button className="ghost" onClick={() => { forgetLastRoom(); setLast(null); }}>{t.online.resumeForget}</button>
          </div>
        </section>
      )}
      <header className="hero">
        <h1>{h.title}</h1>
        <p>{h.lead}</p>
      </header>

      <div className="mode-cards">
        <button className="mode-card mode-find" onClick={() => go({ name: "online", intent: "find" })}>
          <span className="mode-kicker">{h.findKicker}</span>
          <span className="mode-title">{h.findGame}</span>
          <span className="mode-text">{h.findText}</span>
          <span className="mode-cta">{h.findCta} <span aria-hidden="true">→</span></span>
        </button>

        <section className="mode-card mode-friends" aria-labelledby="friends-h">
          <span className="mode-kicker">{h.friendsKicker}</span>
          <h2 className="mode-title" id="friends-h">{h.friendsTitle}</h2>
          <span className="mode-text">{h.friendsText}</span>
          <form className="code-form" onSubmit={(e) => { e.preventDefault(); if (code.length === 5) go({ name: "online", code }); }}>
            <input
              className="code-input" value={code} onChange={(e) => setCode(normalizeCode(e.target.value))}
              placeholder="K7MXQ" aria-label={t.online.joinTitle}
              autoCapitalize="characters" autoComplete="off" spellCheck={false} inputMode="text"
            />
            <button className="dark" disabled={code.length !== 5}>{t.online.join}</button>
          </form>
          <button className="link on-color" onClick={() => go({ name: "online", intent: "create" })}>{h.createRoom}</button>
        </section>
      </div>


      <section aria-labelledby="how-h">
        <div className="row" style={{ marginBottom: 12 }}>
          <h3 id="how-h" className="section-kicker" style={{ flex: 1, margin: 0 }}>{h.howTitle}</h3>
          {busy ? <div className="spinner" /> : <button className="small" onClick={startTutorial}>{t.tutorial.again}</button>}
        </div>
        <ol className="steps">
          {h.steps.map(([title, text]) => <li key={title}><b>{title}</b><span className="muted">{text}</span></li>)}
        </ol>
      </section>
    </div>
  );
}
