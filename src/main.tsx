import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initAuth } from "./lib/auth/auth";
import { store } from "./lib/store";
import { notify } from "./state/app";
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

store.init().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  hideSplash();
});
