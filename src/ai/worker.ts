import { prepareSpeech, setup, transcribe, voicePrints } from "./index";

/*
 * The AI runs in this background thread so the page stays responsive (the models compute for
 * seconds to minutes). The page talks to it through src/lib/ai.ts: one request per message,
 * answered with { id, result } or { id, error }, plus { id, progress } while a model downloads.
 */

type Request =
  | { id: number; op: "setup"; base: string }
  | { id: number; op: "prints"; clips: Float32Array[] }
  | { id: number; op: "prepare" }
  | { id: number; op: "transcribe"; clip: Float32Array; language?: string };

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<Request>) => {
  const m = e.data;
  const progress = (loaded: number, total: number) => post({ id: m.id, progress: [loaded, total] });
  try {
    if (m.op === "setup") { setup(m.base); post({ id: m.id, result: null }); }
    else if (m.op === "prints") { const prints = await voicePrints(m.clips, progress); post({ id: m.id, result: prints }, prints.map((p) => p.buffer)); }
    else if (m.op === "prepare") { await prepareSpeech(progress); post({ id: m.id, result: null }); }
    else if (m.op === "transcribe") post({ id: m.id, result: await transcribe(m.clip, m.language) });
  } catch (err) {
    post({ id: m.id, error: String(err) });
  }
};
