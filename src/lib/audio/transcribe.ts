import { loadAI, type Progress } from "../ai";
import type { Line } from "../types";
import { soundForAI } from "./speech";

/*
 * The words of each line, by the speech model running in the browser (src/ai, Whisper base).
 * Slow-ish (a few seconds a line on a computer, more on a phone), so it reports progress line by
 * line, can be stopped, and hands each text over as soon as it's ready.
 */

/** What the model writes when there is nothing to hear: subtitle credits, "music", "thanks for watching". */
const NOT_SPEECH = /(субтитр|продолжение следует|dimatorzok|корректор|спасибо за просмотр|amara\.org|thank(s| you) for watching|^\W*$)/i;

function clean(text: string): string {
  const t = text.replace(/\[[^\]]*\]|\([^)]*\)|♪/g, " ").replace(/\s+/g, " ").trim();
  return NOT_SPEECH.test(t) ? "" : t;
}

export interface TranscribeEvents {
  /** First use: the model is being downloaded (about 77 MB, then cached by the browser). */
  onDownload?: Progress;
  /** A line is done (its text may be empty when nothing intelligible was said). */
  onLine?: (lineId: string, text: string, done: number, total: number) => void;
}

/** Recognise the text of `lines` in `media`. Stops early when `stop.requested` turns true. Null when the sound can't be read. */
export async function transcribeLines(media: Blob, lines: Line[], ev: TranscribeEvents = {}, stop: { requested: boolean } = { requested: false }): Promise<Record<string, string> | null> {
  const pcm = await soundForAI(media);
  if (!pcm) return null;
  const ai = await loadAI();
  await ai.prepareSpeech(ev.onDownload);
  const clip = (l: Line) => pcm.subarray(Math.max(0, Math.floor((l.start - 0.1) * 16000)), Math.min(pcm.length, Math.ceil((l.end + 0.15) * 16000)));

  // The language is taken from the longest line and then kept: short lines on their own are often misheard as a neighbour language.
  const order = [...lines].sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const out: Record<string, string> = {};
  let language: string | undefined;
  let done = 0;
  for (const l of [order[0], ...lines.filter((x) => x !== order[0])].filter(Boolean)) {
    if (stop.requested) break;
    const text = clean(await ai.transcribe(clip(l), language));
    if (language === undefined) language = /[а-яё]/i.test(text) ? "russian" : /[a-z]/i.test(text) ? "english" : undefined;
    out[l.id] = text;
    ev.onLine?.(l.id, text, ++done, lines.length);
  }
  return out;
}
