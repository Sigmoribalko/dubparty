import { useEffect } from "react";

/*
 * Many clips carry black bars baked into the picture (letterboxed, pillarboxed or both), so the
 * scene looks tiny inside the stage. This samples frames while the video plays, finds where the
 * actual picture is and zooms the <video> so the picture fills the stage.
 */

interface Box { x0: number; y0: number; x1: number; y1: number; samples: number }

/** What was found per scene, so the next screen zooms at once instead of measuring again. */
const known = new Map<string, Box>();

const SW = 96, SH = 54;
/** Brighter than this counts as picture. */
const BLACK = 18;
/** A row or column is picture when at least this share of it is not black (ignores stray pixels). */
const SHARE = 0.04;
/** Frames to see before trusting the result: one dark shot must not crop the scene. */
const MIN_SAMPLES = 3;
const MAX_ZOOM = 5;

function measure(v: HTMLVideoElement, ctx: CanvasRenderingContext2D): Omit<Box, "samples"> | null {
  try {
    ctx.drawImage(v, 0, 0, SW, SH);
    const d = ctx.getImageData(0, 0, SW, SH).data;
    const cols = new Uint16Array(SW), rows = new Uint16Array(SH);
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW; x++) {
        const i = (y * SW + x) * 4;
        if (Math.max(d[i], d[i + 1], d[i + 2]) > BLACK) { cols[x]++; rows[y]++; }
      }
    }
    const lit = (a: Uint16Array, n: number) => { const out: number[] = []; a.forEach((c, i) => { if (c >= n * SHARE) out.push(i); }); return out; };
    const xs = lit(cols, SH), ys = lit(rows, SW);
    if (!xs.length || !ys.length) return null; // a black frame says nothing
    return { x0: xs[0] / SW, x1: (xs[xs.length - 1] + 1) / SW, y0: ys[0] / SH, y1: (ys[ys.length - 1] + 1) / SH };
  } catch {
    return null; // frame not readable (decoder not ready)
  }
}

function apply(v: HTMLVideoElement, box: Box | undefined) {
  const W = v.clientWidth, H = v.clientHeight, vw = v.videoWidth, vh = v.videoHeight;
  if (!box || box.samples < MIN_SAMPLES || !W || !H || !vw || !vh) { v.style.transform = ""; return; }
  // Where the frame sits inside the element (object-fit: contain), then the picture inside the frame.
  const fit = Math.min(W / vw, H / vh);
  const dw = vw * fit, dh = vh * fit;
  const cw = (box.x1 - box.x0) * dw, ch = (box.y1 - box.y0) * dh;
  const cx = (W - dw) / 2 + ((box.x0 + box.x1) / 2) * dw, cy = (H - dh) / 2 + ((box.y0 + box.y1) / 2) * dh;
  const zoom = Math.min(MAX_ZOOM, W / cw, H / ch);
  if (!(zoom > 1.04)) { v.style.transform = ""; return; }
  v.style.transform = `scale(${zoom.toFixed(4)}) translate(${(((W / 2 - cx) / W) * 100).toFixed(3)}%, ${(((H / 2 - cy) / H) * 100).toFixed(3)}%)`;
}

const union = (key: string, m: Omit<Box, "samples">) => {
  const box = known.get(key);
  known.set(key, box ? { x0: Math.min(box.x0, m.x0), y0: Math.min(box.y0, m.y0), x1: Math.max(box.x1, m.x1), y1: Math.max(box.y1, m.y1), samples: box.samples + 1 } : { ...m, samples: 1 });
};

const scanned = new Set<string>();
/** Look at a few frames across the scene on a spare, silent video, so the zoom is right before anything plays. */
function prescan(src: string, key: string) {
  if (scanned.has(key)) return;
  scanned.add(key);
  const v = document.createElement("video");
  const canvas = document.createElement("canvas");
  canvas.width = SW;
  canvas.height = SH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  const points = [0.12, 0.3, 0.5, 0.7, 0.88];
  let i = 0;
  const done = () => { v.removeAttribute("src"); v.load(); };
  const next = () => {
    if (i >= points.length || !isFinite(v.duration)) return done();
    try { v.currentTime = v.duration * points[i++]; } catch { done(); }
  };
  v.addEventListener("loadeddata", next, { once: true });
  v.addEventListener("seeked", () => { const m = measure(v, ctx); if (m) union(key, m); next(); });
  v.addEventListener("error", done);
  setTimeout(done, 15000);
  v.src = src;
}

/** Zoom the video so baked-in black bars are cut off. `key` identifies the scene. */
export function useAutoCrop(video: React.RefObject<HTMLVideoElement | null>, key: string, src?: string) {
  useEffect(() => {
    if (src) prescan(src, key);
    const canvas = document.createElement("canvas");
    canvas.width = SW;
    canvas.height = SH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let lastTime = -1;
    const tick = () => {
      const v = video.current;
      if (!v) return;
      const box = known.get(key);
      // A new frame (playing or after a seek) may show more of the picture: the area only ever grows.
      if (ctx && v.readyState >= 2 && v.currentTime !== lastTime && (!box || box.samples < 40)) {
        lastTime = v.currentTime;
        const m = measure(v, ctx);
        if (m) union(key, m);
      }
      apply(v, known.get(key));
    };
    const id = window.setInterval(tick, 400);
    tick();
    return () => { clearInterval(id); if (video.current) video.current.style.transform = ""; };
  }, [video, key, src]);
}
