import { t } from "../i18n";
import { encodeWav } from "../lib/audio/compose";
import { store } from "../lib/store";
import type { Pack, Scene } from "../lib/types";
import { createGame, type Game } from "./game";

/*
 * The tutorial: a practice round on this device alone, on a scene of our own. The character
 * ("Точка", the red dot from the logo) is a clip we drew (public/tutorial.mp4, made by
 * scripts/make-tutorial-clip.py); its babbling "voice" is synthesised here, so no film footage
 * and no recorded speech is involved.
 */

type Syllable = [onset: number, length: number];
/** Every syllable in seconds of video. Mirrors SYLLABLES in scripts/make-tutorial-clip.py (the mouth). */
const LINE1: Syllable[] = [[1.0, 0.2], [1.22, 0.24], [1.62, 0.22], [1.95, 0.2], [2.2, 0.34]];
const LINE2: Syllable[] = [...Array.from({ length: 11 }, (_, i): Syllable => [3.8 + i * 0.19, 0.17]), [3.8 + 11 * 0.19, 0.3]];
/** The tune each line is babbled to (Hz). */
const TUNE1 = [330, 392, 349, 440, 330];
const TUNE2 = [294, 330, 392, 349, 440, 392, 330, 349, 294, 330, 392, 262];

const SCENE_ID = "tutorial-scene";
const ROLE_ID = "dot";
const span = (s: Syllable[]): [number, number] => [s[0][0], s[s.length - 1][0] + s[s.length - 1][1]];

/** A cartoon voice: one short buzzy note per syllable, shaped by a vowel-like filter. */
async function babble(syllables: Syllable[], tune: number[]): Promise<Blob> {
  const [start, end] = span(syllables);
  const rate = 24000;
  const oc = new OfflineAudioContext(1, Math.ceil((end - start + 0.15) * rate), rate);
  syllables.forEach(([onset, length], i) => {
    const at = onset - start;
    const note = tune[i % tune.length];
    const osc = oc.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(note * 1.07, at);
    osc.frequency.exponentialRampToValueAtTime(note * 0.93, at + length);
    const vowel = oc.createBiquadFilter();
    vowel.type = "bandpass";
    vowel.frequency.value = 650 + 180 * ((i * 3) % 5);
    vowel.Q.value = 2.2;
    const gain = oc.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(1.4, at + 0.025);
    gain.gain.setValueAtTime(1.4, at + length * 0.55);
    gain.gain.linearRampToValueAtTime(0, at + length);
    osc.connect(vowel).connect(gain).connect(oc.destination);
    osc.start(at);
    osc.stop(at + length + 0.02);
  });
  return encodeWav(await oc.startRendering());
}

/** Build the practice round. Null when the clip can't be loaded (e.g. the page was opened as a file). */
export async function buildTutorial(): Promise<Game | null> {
  try {
    const res = await fetch(new URL("tutorial.mp4", document.baseURI));
    if (!res.ok) return null;
    const tr = t().tutorial;
    const lines = [LINE1, LINE2].map((syl, i) => {
      const [start, end] = span(syl);
      return { id: `tutorial-l${i + 1}`, roleId: ROLE_ID, start, end, text: tr.lines[i], clip: `tutorial-voice-${i + 1}` };
    });
    await store.putMedia(SCENE_ID, new Blob([await res.blob()], { type: "video/mp4" }));
    await store.putMedia(lines[0].clip, await babble(LINE1, TUNE1));
    await store.putMedia(lines[1].clip, await babble(LINE2, TUNE2));
    const scene: Scene = { id: SCENE_ID, title: tr.sceneTitle, mediaType: "video/mp4", ext: "mp4", duration: 7.2, roles: [{ id: ROLE_ID, name: tr.role, color: "#e8452c" }], lines };
    // Not saved as a pack: it never shows up in the library or in room scene lists.
    const pack: Pack = { id: "tutorial", name: tr.sceneTitle, scenes: [scene], updated: 0 };
    const res2 = await createGame({ pack, scene, round: 0, cast: { [ROLE_ID]: tr.you }, myRoleId: ROLE_ID });
    if (!res2) return null;
    res2.game.solo = true;
    return res2.game;
  } catch {
    return null;
  }
}

/* ---------- first visit: what the newcomer has already been through ---------- */

const KEY = "dubl-onboard";
export interface Onboarding {
  /** Chose "play as a guest" on the welcome screen. */
  guest?: boolean;
  /** The practice round was finished or skipped. */
  tutorial?: "done" | "skipped";
}

export function readOnboarding(): Onboarding {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Onboarding | null;
    if (saved && typeof saved === "object") return saved;
    // Someone who played before this screen existed doesn't need the introduction.
    if (localStorage.getItem("dubl-name") || localStorage.getItem("dubl-player-key")) return { guest: true, tutorial: "skipped" };
  } catch { /* private mode: just show the welcome each time */ }
  return {};
}

export function saveOnboarding(patch: Onboarding): Onboarding {
  const next = { ...readOnboarding(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}
