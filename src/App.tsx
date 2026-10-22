import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { Asker, askLeave } from "./components/Ask";
import { Icon } from "./components/Icon";
import { Toaster } from "./components/Toast";
import { UserMenu } from "./components/UserMenu";
import { useT } from "./i18n";
import { whenIdle } from "./lib/util";
import { leaveRoom, loadPeer, useRoom } from "./net/room";
import { useApp, type View } from "./state/app";
import { hasAnyRecording } from "./state/game";
import { useRoomDirector } from "./state/online";
import "./state/theme";
import { Home } from "./views/Home";

/*
 * Only Home is in the first chunk. The other screens are separate files, all fetched once the page is
 * idle: opening them is then instant, and a tab that's mid-game keeps working when a deploy replaces the files.
 */
const chunks = {
  online: () => import("./views/Online"),
  record: () => import("./views/Record"),
  screen: () => import("./views/Screening"),
  packs: () => import("./views/Packs"),
  editor: () => import("./views/Editor"),
  auth: () => import("./views/Auth"),
  profile: () => import("./views/Profile"),
  settings: () => import("./components/SettingsModal"),
};

const RELOADED = "dubl-chunk-reload";
/** A screen that fails to load (the site was updated since this tab opened): reload once to get the new files. */
function screen<T, P extends object>(load: () => Promise<T>, pick: (m: T) => ComponentType<P>) {
  return lazy(() => load().then((m) => ({ default: pick(m) }), (e) => {
    try {
      if (Date.now() - Number(sessionStorage.getItem(RELOADED) ?? 0) > 60_000) {
        sessionStorage.setItem(RELOADED, String(Date.now()));
        location.reload();
        return new Promise<never>(() => {});
      }
    } catch { /* storage blocked */ }
    throw e;
  }));
}

const Online = screen(chunks.online, (m) => m.Online);
const Record = screen(chunks.record, (m) => m.Record);
const Screening = screen(chunks.screen, (m) => m.Screening);
const Packs = screen(chunks.packs, (m) => m.Packs);
const Editor = screen(chunks.editor, (m) => m.Editor);
const Auth = screen(chunks.auth, (m) => m.Auth);
const Profile = screen(chunks.profile, (m) => m.Profile);
const SettingsModal = screen(chunks.settings, (m) => m.SettingsModal);

/** Screens where the game is running: navigation stays out of the way. */
const IN_GAME: View["name"][] = ["record", "screen"];

export function App() {
  const t = useT();
  const view = useApp((s) => s.view);
  const game = useApp((s) => s.game);
  const go = useApp((s) => s.go);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);
  useRoomDirector();
  const reconnecting = useRoom((s) => s.reconnecting);

  useEffect(() => whenIdle(() => {
    Object.values(chunks).forEach((load) => load().catch(() => {}));
    loadPeer().catch(() => {});
  }), []);

  // Invite links look like ?room=K7MXQ.
  useEffect(() => {
    const code = new URLSearchParams(location.search).get("room");
    if (!code) return;
    history.replaceState(null, "", location.pathname);
    go({ name: "online", code });
  }, [go]);

  // Warn before closing the tab with unsaved takes.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { const g = useApp.getState().game; if (g && !g.solo && hasAnyRecording(g)) e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  /** Navigating away from a room asks first. */
  const navigate = async (to: View) => {
    if (useRoom.getState().status === "open") {
      if (!(await askLeave())) return;
      leaveRoom();
      useApp.getState().setGame(null);
    }
    go(to);
  };

  const section = view.name === "packs" || view.name === "editor" ? "packs" : "play";
  const inGame = IN_GAME.includes(view.name);

  return (
    <div className={"app" + (inGame ? " in-game" : "")}>
      <header className="topbar">
        <button className="wordmark" onClick={() => navigate({ name: "home" })} aria-label={t.header.home}>Dub<b>Party</b><i>.</i></button>
        <nav className="top-nav" aria-label={t.header.home}>
          <button className={section === "play" ? "on" : ""} aria-current={section === "play" ? "page" : undefined} onClick={() => navigate({ name: "home" })}>{t.nav.play}</button>
          <button className={section === "packs" ? "on" : ""} aria-current={section === "packs" ? "page" : undefined} onClick={() => navigate({ name: "packs" })}>{t.nav.packs}</button>
        </nav>
        <div className="spacer" />
        <UserMenu />
        <button className="small ghost icon-btn" onClick={() => setSettingsOpen(true)} aria-label={t.header.settings} title={t.header.settings}><Icon name="gear" size={20} /></button>
      </header>

      {reconnecting && (
        <div className="wrap reconnect-banner" role="status">
          <div className="panel notice row"><div className="spinner" /><span>{t.online.reconnecting}</span></div>
        </div>
      )}
      {/* Keyed by mode too: "Регистрация" in the top bar must switch an open sign-in screen. */}
      <main className="view" key={view.name + ("packId" in view ? view.packId ?? "" : "") + ("mode" in view ? view.mode ?? "" : "")}>
        <Suspense fallback={<div className="wrap"><div className="spinner" aria-label={t.common.loading} /></div>}>
        {view.name === "home" && <Home />}
        {view.name === "packs" && <Packs />}
        {view.name === "editor" && <Editor packId={view.packId} />}
        {view.name === "record" && game && <Record />}
        {view.name === "screen" && game && <Screening />}
        {view.name === "auth" && <Auth mode={view.mode} />}
        {view.name === "profile" && <Profile />}
        {view.name === "online" && <Online code={view.code} packId={view.packId} intent={view.intent} />}
        </Suspense>
      </main>

      {!inGame && (
        <nav className="bottom-nav" aria-label={t.header.home}>
          <button className={section === "play" ? "on" : ""} aria-current={section === "play" ? "page" : undefined} onClick={() => navigate({ name: "home" })}>
            <Icon name="home" size={22} /><span>{t.nav.play}</span>
          </button>
          <button className={section === "packs" ? "on" : ""} aria-current={section === "packs" ? "page" : undefined} onClick={() => navigate({ name: "packs" })}>
            <Icon name="film" size={22} /><span>{t.nav.packs}</span>
          </button>
          <button onClick={() => setSettingsOpen(true)}>
            <Icon name="gear" size={22} /><span>{t.nav.settings}</span>
          </button>
        </nav>
      )}

      {settingsOpen && <Suspense fallback={null}><SettingsModal onClose={() => setSettingsOpen(false)} /></Suspense>}
      <Toaster />
      <Asker />
    </div>
  );
}
