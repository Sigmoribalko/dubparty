import type { Progress } from "../ai";

/*
 * The in-browser AI (src/ai) runs in a background thread: a separate file in the build
 * (vendor/ai-worker.js), started on first use only, so the page everyone opens doesn't carry it
 * and stays responsive while the models work. In development the worker runs from the source.
 */

export type { Progress };

export interface AI {
  /** A voice fingerprint per clip (16 kHz mono). `onProgress`: first download of the model. */
  voicePrints(clips: Float32Array[], onProgress?: Progress): Promise<Float32Array[]>;
  /** Get the speech model ready (downloads it the first time). */
  prepareSpeech(onProgress?: Progress): Promise<void>;
  /** The words in one clip (16 kHz mono); `language` such as "russian" skips guessing it. */
  transcribe(clip: Float32Array, language?: string): Promise<string>;
}

type TrustedTypes = { createPolicy(name: string, rules: { createScriptURL(url: string): string }): { createScriptURL(url: string): unknown } };
let policy: { createScriptURL(url: string): unknown } | null = null;

function startWorker(): Worker {
  if (import.meta.env.DEV) return new Worker("/src/ai/worker.ts", { type: "module" });
  const url = new URL("vendor/ai-worker.js", document.baseURI).href;
  // The page's CSP only takes script URLs through a Trusted Types policy: this one lets through the AI worker and nothing else.
  const tt = (window as unknown as { trustedTypes?: TrustedTypes }).trustedTypes;
  policy ??= tt?.createPolicy("dubparty-ai", { createScriptURL: (u) => { if (u !== url) throw new TypeError("Only the AI worker can be loaded"); return u; } }) ?? null;
  return new Worker((policy ? policy.createScriptURL(url) : url) as string, { type: "module" });
}

let client: Promise<AI> | null = null;
export function loadAI(): Promise<AI> {
  client ??= (async (): Promise<AI> => {
    const worker = startWorker();
    const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; onProgress?: Progress }>();
    let seq = 0;
    worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string; progress?: [number, number] }>) => {
      const { id, result, error, progress } = e.data;
      const p = pending.get(id);
      if (!p) return;
      if (progress) { p.onProgress?.(progress[0], progress[1]); return; }
      pending.delete(id);
      if (error) p.reject(new Error(error)); else p.resolve(result);
    };
    worker.onerror = (e) => {
      pending.forEach((p) => p.reject(new Error(e.message || "AI worker failed")));
      pending.clear();
      client = null;
      worker.terminate();
    };
    const call = <T,>(msg: object, onProgress?: Progress, transfer: Transferable[] = []) =>
      new Promise<T>((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
        worker.postMessage({ ...msg, id }, transfer);
      });
    await call({ op: "setup", base: new URL(".", document.baseURI).href });
    return {
      voicePrints: (clips, onProgress) => { const copies = clips.map((c) => c.slice()); return call({ op: "prints", clips: copies }, onProgress, copies.map((c) => c.buffer)); },
      prepareSpeech: (onProgress) => call({ op: "prepare" }, onProgress),
      transcribe: (clip, language) => { const copy = clip.slice(); return call({ op: "transcribe", clip: copy, language }, undefined, [copy.buffer]); },
    };
  })();
  client.catch(() => { client = null; });
  return client;
}
