import { create } from "zustand";
import { saveUserData, useAuth } from "../lib/auth/auth";
import { cleanLook, randomLook, sameLook, type Look } from "../lib/look";

/*
 * This browser's look (avatar + name colour). Everyone starts with a random one; it's kept in
 * localStorage and, when signed in, with the account (user metadata), so it follows the player.
 */

const KEY = "dubl-look";

function load(): Look {
  try {
    const saved = cleanLook(JSON.parse(localStorage.getItem(KEY) ?? "null"));
    if (saved) return saved;
  } catch { /* storage unavailable or corrupt */ }
  const fresh = randomLook();
  keep(fresh);
  return fresh;
}

function keep(look: Look) {
  try { localStorage.setItem(KEY, JSON.stringify(look)); } catch { /* private mode */ }
}

export const useLook = create<{ look: Look }>(() => ({ look: load() }));
export const myLook = () => useLook.getState().look;

export function setLook(look: Look) {
  if (sameLook(look, myLook())) return;
  useLook.setState({ look });
  keep(look);
  saveUserData({ look }).catch(() => { /* offline: stays on this device */ });
}

// Signing in: the account's look wins; an account without one takes this device's.
useAuth.subscribe((s, prev) => {
  if (!s.user || s.user.id === prev.user?.id) return;
  const account = cleanLook(s.user.user_metadata?.look);
  if (account) { if (!sameLook(account, myLook())) { useLook.setState({ look: account }); keep(account); } }
  else saveUserData({ look: myLook() }).catch(() => {});
});
