import { audioCtx } from "./engine";

/*
 * Finding the lines in a raw video: where somebody speaks, by sound alone.
 *
 * It answers "when" and roughly "who", not "what": the result is a list of time spans, each
 * tagged with a voice. The idea for "when" is the one used for removing a character's voice: film
 * dialogue sits in the centre of the stereo picture and in the speech band, while music and
 * effects are spread to the sides. So the level that is tracked is the centred speech-band signal
 * minus what the sides carry, and a span is wherever that level rises clearly above the scene's
 * own quiet floor. "Who" is told by how high the voice is: spans whose pitch differs clearly
 * are different people (a man and a woman, an adult and a child); similar voices stay together.
 */

export interface SpeechSpan { start: number; end: number }

/** Seconds per analysis frame. */
const FRAME = 0.02;
const MAX_BYTES = 300 * 1024 * 1024;
/** Pauses shorter than this stay inside one line (a comma is a pause too; a change of speaker is usually longer). */
const JOIN_GAP = 0.45;
const MIN_LINE = 0.3;
/** A shorter sound this close to a line is part of it. */
const NEAR_WORD = 0.7;
/** Shorter than this and on its own: a click, not a word. */
const MIN_WORD = 0.18;
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
  // Short pauses belong to the same line.
  spans = spans.reduce<SpeechSpan[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    if (prev && s.start - prev.end <= JOIN_GAP) prev.end = s.end;
    else acc.push({ ...s });
    return acc;
  }, []);
  // A very short sound is a word ("Fine.") when a line follows or precedes it closely: it joins that
  // line. Alone, it is a word only if it isn't a mere click.
  for (let i = 0; i < spans.length;) {
    const s = spans[i], prev = spans[i - 1], next = spans[i + 1];
    if (s.end - s.start >= MIN_LINE) { i++; continue; }
    if (next && next.start - s.end <= NEAR_WORD) { next.start = s.start; spans.splice(i, 1); }
    else if (prev && s.start - prev.end <= NEAR_WORD) { prev.end = s.end; spans.splice(i, 1); }
    else if (s.end - s.start < MIN_WORD) spans.splice(i, 1);
    else i++;
  }

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

/* ---------- who: telling voices apart by pitch ---------- */

/** Rate the pitch tracker works at: plenty for fundamentals of 70–400 Hz. */
const PITCH_RATE = 8000;
/** Voices whose typical pitch is closer than this (semitones) are taken for one person. */
const VOICE_GAP = 4;
const MAX_VOICES = 3;
/** A "voice" that speaks less than this in total is noise or a shout, not a character. */
const MIN_VOICE_TIME = 0.8;

/** The centred signal, low-passed and thinned out to about PITCH_RATE. */
function pitchSignal(buf: AudioBuffer): { data: Float32Array; rate: number } {
  const step = Math.max(1, Math.round(buf.sampleRate / PITCH_RATE));
  const left = buf.getChannelData(0), right = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const lp = new Biquad("lowpass", 900, buf.sampleRate), hp = new Biquad("highpass", 60, buf.sampleRate);
  const data = new Float32Array(Math.floor(buf.length / step));
  for (let i = 0, o = 0; i < buf.length; i++) {
    const y = hp.step(lp.step(right ? (left[i] + right[i]) / 2 : left[i]));
    if (i % step === 0 && o < data.length) data[o++] = y;
  }
  return { data, rate: buf.sampleRate / step };
}

/** Typical pitch of one span, in semitones above 100 Hz. Null when it isn't clearly voiced. */
function spanPitch(sig: { data: Float32Array; rate: number }, span: SpeechSpan): number | null {
  const { data, rate } = sig;
  const size = Math.round(rate * 0.048), hop = Math.round(rate * 0.024);
  const minLag = Math.floor(rate / 400), maxLag = Math.ceil(rate / 70);
  const from = Math.max(0, Math.floor(span.start * rate)), to = Math.min(data.length - size - maxLag, Math.floor(span.end * rate));
  const frames: Array<{ at: number; rms: number }> = [];
  for (let at = from; at < to; at += hop) {
    let e = 0;
    for (let i = 0; i < size; i++) e += data[at + i] * data[at + i];
    frames.push({ at, rms: Math.sqrt(e / size) });
  }
  const loud = Math.max(0, ...frames.map((f) => f.rms)) * 0.3;
  const found: number[] = [];
  for (const f of frames) {
    if (f.rms < loud || f.rms < 1e-4) continue;
    let e0 = 0;
    for (let i = 0; i < size; i++) e0 += data[f.at + i] * data[f.at + i];
    let best = 0;
    const corr = new Float32Array(maxLag + 1);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let xy = 0, e1 = 0;
      for (let i = 0; i < size; i++) { const b = data[f.at + i + lag]; xy += data[f.at + i] * b; e1 += b * b; }
      corr[lag] = xy / Math.sqrt(e0 * e1 + 1e-12);
      if (corr[lag] > best) best = corr[lag];
    }
    if (best < 0.55) continue; // not a steady tone: a consonant, noise, several voices at once
    // The shortest period that repeats nearly as well as the best one (longer ones are its multiples).
    let lag = minLag;
    while (lag < maxLag && !(corr[lag] >= best * 0.9 && corr[lag] >= corr[lag + 1])) lag++;
    found.push(12 * Math.log2(rate / lag / 100));
  }
  if (found.length < 4) return null;
  found.sort((a, b) => a - b);
  return found[found.length >> 1];
}

/** Give every span a voice number (0, 1, …, by first appearance) from its pitch. */
function tellVoices(buf: AudioBuffer, spans: SpeechSpan[]): { voice: number[]; voices: number } {
  const sig = pitchSignal(buf);
  const pitch = spans.map((s) => spanPitch(sig, s));
  const known = spans.map((s, i) => ({ i, p: pitch[i], time: s.end - s.start })).filter((x): x is { i: number; p: number; time: number } => x.p != null).sort((a, b) => a.p - b.p);
  const group = new Array<number>(spans.length).fill(-1);
  if (known.length) {
    // Cut the sorted pitches at the widest gaps (at most MAX_VOICES groups, only where the gap is real).
    const cuts = known.slice(1).map((x, k) => ({ k: k + 1, gap: x.p - known[k].p })).filter((c) => c.gap >= VOICE_GAP).sort((a, b) => b.gap - a.gap).slice(0, MAX_VOICES - 1).map((c) => c.k).sort((a, b) => a - b);
    let g = 0;
    known.forEach((x, k) => { if (cuts.includes(k)) g++; group[x.i] = g; });
    // A group that barely speaks joins the group nearest in pitch.
    for (;;) {
      const ids = [...new Set(group.filter((v) => v >= 0))];
      if (ids.length < 2) break;
      const stat = ids.map((id) => { const m = known.filter((x) => group[x.i] === id); return { id, time: m.reduce((n, x) => n + x.time, 0), p: m.reduce((n, x) => n + x.p, 0) / m.length }; });
      const weak = stat.filter((x) => x.time < MIN_VOICE_TIME).sort((a, b) => a.time - b.time)[0];
      if (!weak) break;
      const near = stat.filter((x) => x.id !== weak.id).sort((a, b) => Math.abs(a.p - weak.p) - Math.abs(b.p - weak.p))[0];
      known.forEach((x) => { if (group[x.i] === weak.id) group[x.i] = near.id; });
    }
  }
  // No clear pitch (a whisper, a shout over music): assume the person who spoke just before.
  for (let i = 0; i < group.length; i++) if (group[i] < 0) group[i] = i ? group[i - 1] : (group.find((v) => v >= 0) ?? 0);
  const order: number[] = [];
  const voice = group.map((id) => { if (!order.includes(id)) order.push(id); return order.indexOf(id); });
  return { voice, voices: Math.max(1, order.length) };
}

export interface FoundSpeech {
  /** Where somebody speaks, each with the number of the voice it sounds like. */
  spans: Array<SpeechSpan & { voice: number }>;
  /** How many different voices were told apart (at least 1). */
  voices: number;
}

/** Where people speak in this video or audio file, and which voice each time. Null when its sound can't be read. */
export async function findSpeech(media: Blob): Promise<FoundSpeech | null> {
  if (media.size > MAX_BYTES) return null;
  let buf: AudioBuffer;
  try { buf = await audioCtx().decodeAudioData(await media.arrayBuffer()); } catch { return null; }
  const spans = spansFromLevels(voiceLevels(buf), buf.duration);
  const { voice, voices } = tellVoices(buf, spans);
  return { spans: spans.map((s, i) => ({ ...s, voice: voice[i] })), voices };
}
