import { audioCtx } from "./engine";

/*
 * Finding the lines in a raw video: where somebody speaks, by sound alone.
 *
 * It answers "when", not "what" or "who": the result is a list of time spans. The idea is the one
 * used for removing a character's voice: film dialogue sits in the centre of the stereo picture
 * and in the speech band, while music and effects are spread to the sides. So the level that is
 * tracked is the centred speech-band signal minus what the sides carry, and a span is wherever
 * that level rises clearly above the scene's own quiet floor.
 */

export interface SpeechSpan { start: number; end: number }

/** Seconds per analysis frame. */
const FRAME = 0.02;
const MAX_BYTES = 300 * 1024 * 1024;
/** Pauses shorter than this stay inside one line (a comma is a pause too; a change of speaker is usually longer). */
const JOIN_GAP = 0.45;
const MIN_LINE = 0.3;
/** A line longer than this is cut at its quietest moment: nobody can dub ten seconds in one breath. */
const MAX_LINE = 6.5;
const PAD_BEFORE = 0.06;
const PAD_AFTER = 0.12;

/** Second-order filter (RBJ cookbook), run sample by sample. */
class Biquad {
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  private b0: number; private b1: number; private b2: number; private a1: number; private a2: number;
  constructor(kind: "highpass" | "lowpass", freq: number, rate: number) {
    const w = (2 * Math.PI * Math.min(freq, rate * 0.45)) / rate, cos = Math.cos(w), alpha = Math.sin(w) / Math.SQRT2;
    const a0 = 1 + alpha;
    const k = kind === "highpass" ? (1 + cos) / 2 : (1 - cos) / 2;
    this.b0 = k / a0;
    this.b1 = (kind === "highpass" ? -(1 + cos) : 1 - cos) / a0;
    this.b2 = k / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  step(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** Per-frame level (dB) of centred speech-band sound. */
function voiceLevels(buf: AudioBuffer): Float32Array {
  const rate = buf.sampleRate, size = Math.max(1, Math.round(rate * FRAME));
  const left = buf.getChannelData(0), right = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const band = () => [new Biquad("highpass", 250, rate), new Biquad("lowpass", 3400, rate)] as const;
  const [mh, ml] = band(), [sh, sl] = band();
  const out = new Float32Array(Math.ceil(buf.length / size));
  for (let f = 0; f < out.length; f++) {
    let mid = 0, side = 0;
    const end = Math.min(buf.length, (f + 1) * size);
    for (let i = f * size; i < end; i++) {
      const l = left[i], r = right ? right[i] : l;
      const m = ml.step(mh.step((l + r) / 2));
      mid += m * m;
      if (right) { const s = sl.step(sh.step((l - r) / 2)); side += s * s; }
    }
    const n = Math.max(1, end - f * size);
    const m = Math.sqrt(mid / n), s = Math.sqrt(side / n);
    // What the sides carry is taken off, but never below a quarter of the centre: with music alone
    // the two are nearly equal, and their difference would be noise swinging over a huge range.
    out[f] = 20 * Math.log10(Math.max(m - s, m * 0.25) + 1e-5);
  }
  return out;
}

/** Moving average over `radius` frames each side. */
function smooth(a: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(a.length - 1, i + radius); j++) { sum += a[j]; n++; }
    out[i] = sum / n;
  }
  return out;
}

/** Spans of speech on the timeline of `levels` (one value per FRAME). Empty when nothing stands out. */
export function spansFromLevels(levels: Float32Array, duration: number): SpeechSpan[] {
  if (levels.length < 10) return [];
  const lv = smooth(levels, 2);
  const sorted = Float32Array.from(lv).sort();
  const floor = sorted[Math.floor(sorted.length * 0.15)], top = sorted[Math.floor(sorted.length * 0.97)];
  // No contrast between loud and quiet: wall-to-wall sound, there is no telling where lines are.
  if (top - floor < 9) return [];
  const threshold = floor + Math.max(7, Math.min(20, (top - floor) * 0.42));

  let spans: SpeechSpan[] = [];
  let from = -1;
  for (let i = 0; i <= lv.length; i++) {
    const on = i < lv.length && lv[i] > threshold;
    if (on && from < 0) from = i;
    if (!on && from >= 0) { spans.push({ start: from * FRAME, end: i * FRAME }); from = -1; }
  }
  // Short pauses belong to the same line; blips are not lines.
  spans = spans.reduce<SpeechSpan[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    if (prev && s.start - prev.end <= JOIN_GAP) prev.end = s.end;
    else acc.push({ ...s });
    return acc;
  }, []).filter((s) => s.end - s.start >= MIN_LINE);

  const split = (s: SpeechSpan): SpeechSpan[] => {
    if (s.end - s.start <= MAX_LINE) return [s];
    const a = Math.round((s.start + 1.5) / FRAME), b = Math.round((s.end - 1.5) / FRAME);
    let cut = a;
    for (let i = a; i <= b; i++) if (lv[i] < lv[cut]) cut = i;
    const at = cut * FRAME;
    return [...split({ start: s.start, end: at }), ...split({ start: at, end: s.end })];
  };
  spans = spans.flatMap(split);

  // A little air around each line, without touching its neighbours.
  return spans.map((s, i) => {
    const start = Math.max(0, i ? Math.max(spans[i - 1].end, s.start - PAD_BEFORE) : s.start - PAD_BEFORE);
    const end = Math.min(duration, i < spans.length - 1 ? Math.min(spans[i + 1].start, s.end + PAD_AFTER) : s.end + PAD_AFTER);
    return { start: Math.floor(start * 10) / 10, end: Math.max(Math.ceil(end * 10) / 10, Math.floor(start * 10) / 10 + 0.3) };
  }).map((s, i, all) => (i < all.length - 1 && s.end > all[i + 1].start ? { ...s, end: all[i + 1].start } : s))
    .filter((s) => s.end - s.start >= 0.2);
}

/** Where people speak in this video or audio file. Null when its sound can't be read. */
export async function findSpeech(media: Blob): Promise<SpeechSpan[] | null> {
  if (media.size > MAX_BYTES) return null;
  let buf: AudioBuffer;
  try { buf = await audioCtx().decodeAudioData(await media.arrayBuffer()); } catch { return null; }
  return spansFromLevels(voiceLevels(buf), buf.duration);
}

/**
 * Guess who says what: with several roles, a new voice is assumed after every real pause
 * (dialogue mostly alternates). Only a starting point, the author corrects it.
 */
export function dealRoles<T extends SpeechSpan>(spans: T[], roleIds: string[]): Array<T & { roleId: string }> {
  let turn = 0;
  return spans.map((s, i) => {
    if (i && roleIds.length > 1 && s.start - spans[i - 1].end >= 0.6) turn++;
    return { ...s, roleId: roleIds[turn % roleIds.length] ?? "" };
  });
}
