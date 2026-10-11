import { useRef } from "react";
import { ENV_RATE, loudness, type Envelope } from "../lib/audio/envelope";
import type { Line } from "../lib/types";
import { useAnimationFrame } from "./useAnimationFrame";

const LANE = 92;
const PAD = 10;
export const LINE_TRACK_HEIGHT = LANE + PAD * 2;

interface Props {
  /** The character's voice over the whole scene (null while it's being measured). */
  reference: Envelope | null;
  /** Your take of this line, on the scene timeline. */
  mine: Envelope | null;
  /** Your voice while recording, filled in frame by frame. */
  live: React.RefObject<Float32Array | null>;
  line: Line;
  /** The stretch of video shown: the line with its lead-in and tail. */
  from: number;
  to: number;
  color: string;
  time(): number;
  labels: { character: string; you: string; measuring: string };
}

/** Cheap stable per-frame jitter so bars look like real audio, not a smooth curve. */
const grain = (i: number) => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return 0.72 + (x - Math.floor(x)) * 0.28;
};

/**
 * One line, one track: the character's phrase as a waveform, and your voice drawn on top of it
 * as you speak. The whole line fits the width, the playhead runs across it.
 */
export function LineTrack({ reference, mine, live, line, from, to, color, time, labels }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useRef<{ rec: string; ink: string; muted: string; lane: string; film: string } | null>(null);

  useAnimationFrame(() => {
    const cv = canvas.current;
    if (!cv || !cv.offsetParent) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    if (!theme.current) {
      const cs = getComputedStyle(cv);
      const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
      theme.current = { rec: v("--rec", "#e8452c"), ink: "#efeee8", muted: "#8f8e86", lane: "rgba(255,255,255,0.06)", film: v("--film", "#141413") };
    }
    const c = theme.current;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const span = Math.max(0.1, to - from);
    const inner = w - PAD * 2;
    const x = (sec: number) => PAD + ((sec - from) / span) * inner;
    const step = inner / (span * ENV_RATE);
    const first = Math.max(0, Math.floor(from * ENV_RATE));
    const last = Math.ceil(to * ENV_RATE);
    const top = PAD, mid = top + LANE / 2, amp = LANE / 2 - 8;
    const t = time();

    // The lane, and inside it the stretch where the character speaks.
    ctx.fillStyle = c.lane;
    roundRect(ctx, PAD, top, inner, LANE, 8);
    ctx.fill();
    const a = x(line.start), b = x(line.end);
    ctx.fillStyle = withAlpha(color, 0.16);
    roundRect(ctx, a, top, Math.max(2, b - a), LANE, 6);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(a, top, Math.max(2, b - a), 2);

    const bars = (values: Float32Array, fill: string, scale: number, until = last) => {
      ctx.fillStyle = fill;
      for (let i = first; i <= until && i < values.length; i++) {
        const v = loudness(values[i]);
        if (v < 0.04) continue;
        const bh = Math.max(1, v * grain(i) * amp * scale);
        ctx.fillRect(x(i / ENV_RATE), mid - bh, Math.max(1, step - 1), bh * 2);
      }
    };

    // The phrase to repeat, wide and soft; your voice over it, narrower and bright.
    if (reference) bars(reference.values, withAlpha(color, 0.5), 1);
    const yours = live.current ?? mine?.values;
    const recording = !!live.current;
    if (yours) bars(yours, recording ? c.rec : withAlpha(c.ink, 0.92), 0.82, recording ? Math.floor(t * ENV_RATE) : last);

    const tab = (text: string, left: number, dot: string) => {
      ctx.font = "700 10px Manrope, system-ui, sans-serif";
      const tw = ctx.measureText(text).width + 14;
      ctx.fillStyle = withAlpha(c.film, 0.85);
      roundRect(ctx, left, top + 6, tw + 12, 16, 4);
      ctx.fill();
      ctx.fillStyle = dot;
      ctx.beginPath();
      ctx.arc(left + 9, top + 14, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.ink;
      ctx.textBaseline = "middle";
      ctx.fillText(text, left + 18, top + 14.5);
      return left + tw + 18;
    };
    const next = tab(labels.character.toUpperCase(), PAD + 6, color);
    if (yours) tab(labels.you.toUpperCase(), next, recording ? c.rec : c.ink);

    if (!reference) {
      ctx.fillStyle = c.muted;
      ctx.font = "600 12px Manrope, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(labels.measuring, a + 8, mid);
    }

    // Playhead.
    if (t >= from - 0.05 && t <= to + 0.05) {
      const px = Math.max(PAD, Math.min(PAD + inner, x(t)));
      ctx.fillStyle = c.rec;
      ctx.fillRect(px - 1, top - 4, 2, LANE + 8);
    }
  });

  return <canvas ref={canvas} className="voice-track" style={{ height: LINE_TRACK_HEIGHT }} aria-hidden="true" />;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/** "#rrggbb" → "rgba(r,g,b,a)"; other colour formats are returned unchanged. */
function withAlpha(col: string, a: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(col);
  if (!m) return col;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
