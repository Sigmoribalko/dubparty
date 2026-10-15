import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initAuth } from "./lib/auth/auth";
import { store } from "./lib/store";
import { notify } from "./state/app";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/motion.css";

store.onWarning = notify;
initAuth();

if (import.meta.env.DEV) {
  // Handles for poking at the app from the devtools console.
  Promise.all([import("./state/app"), import("./state/game"), import("./lib/audio/engine"), import("./lib/pack/import")]).then(
    ([app, game, engine, pack]) => Object.assign(window, { __dubl: { ...app, ...game, ...engine, ...pack, store } }),
  );
}

/** The loading screen from index.html stays for a beat (so it reads as an intro, not a flicker), then fades out. */
function hideSplash() {
  const el = document.getElementById("splash");
  if (!el) return;
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 450);
  }, Math.max(0, 900 - performance.now()));
}

/**
 * Clickjacking: another site could load DubParty in an invisible frame and trick people into
 * clicking "Забанить" or "Удалить". GitHub Pages can't send frame-ancestors, so the page refuses
 * to run inside someone else's frame and offers a link to open it properly.
 */
function framedByStranger(): boolean {
  if (window.top === window.self) return false;
  try { return window.top!.location.origin !== location.origin; } catch { return true; }
}

if (framedByStranger()) {
  document.getElementById("splash")?.remove();
  const root = document.getElementById("root")!;
  root.replaceChildren();
  const a = document.createElement("a");
  a.href = location.origin + "/";
  a.target = "_top";
  a.rel = "noopener";
  a.textContent = "Открыть DubParty";
  a.style.cssText = "display:block;margin:40px auto;text-align:center;font:600 18px system-ui;color:inherit";
  root.append(a);
} else store.init().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  hideSplash();
});
