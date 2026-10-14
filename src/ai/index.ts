import {
  AutoModel, AutoProcessor, AutoTokenizer, AutomaticSpeechRecognitionPipeline, env, WhisperForConditionalGeneration,
  type PreTrainedModel, type Processor, type Tensor,
} from "@huggingface/transformers";

/*
 * Free AI that runs in the player's own browser, built separately into vendor/ai.js (see
 * vite.ai.config.ts) and loaded only when someone takes a video apart:
 *  - voice fingerprints (WeSpeaker ResNet34, CC BY 4.0): tell who speaks, even with similar voices;
 *  - speech to text (Whisper base, MIT): the words of each line.
 * Models and the WebAssembly runtime are served by this site (public/models, public/vendor), so
 * nothing is fetched from abroad and no audio leaves the device. Downloads are cached by the browser.
 */

/** Bytes downloaded so far and in total, while a model is fetched for the first time. */
export type Progress = (loaded: number, total: number) => void;

const SPEAKER = "onnx-community/wespeaker-voxceleb-resnet34-LM";
const WHISPER = "onnx-community/whisper-base";
/** Audio the models take: mono, 16 kHz. */
export const RATE = 16000;

let ready = false;
/** Point the library at this site's copies of the models and the runtime. `base` is the site's root URL. */
export function setup(base: string) {
  if (ready) return;
  ready = true;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  // A path, not a full URL: the library only checks which optional files (the tokenizer) exist for local paths.
  env.localModelPath = new URL("models/", base).pathname;
  env.useBrowserCache = true;
  const wasm = env.backends.onnx.wasm!;
  wasm.wasmPaths = new URL("vendor/", base).href;
  // Threads need cross-origin isolation, which a static host can't switch on; one thread is enough here.
  wasm.numThreads = 1;
  wasm.proxy = false;
}

/** Download sizes, so progress shows the whole amount from the start (the library only adds files as it begins them). */
const SPEAKER_BYTES = 6_700_000;
const WHISPER_BYTES = 81_300_000;

const reporter = (onProgress: Progress | undefined, expected: number) => (p: { status: string; loaded?: number; total?: number }) => {
  if (p.status === "progress_total" && p.total) onProgress?.(p.loaded ?? 0, Math.max(p.total, expected));
};

let speaker: Promise<{ processor: Processor; model: PreTrainedModel }> | null = null;
function speakerModel(onProgress?: Progress) {
  speaker ??= Promise.all([
    AutoProcessor.from_pretrained(SPEAKER),
    AutoModel.from_pretrained(SPEAKER, { dtype: "int8", device: "wasm", progress_callback: reporter(onProgress, SPEAKER_BYTES) }),
  ]).then(([processor, model]) => ({ processor, model }));
  speaker.catch(() => { speaker = null; });
  return speaker;
}

/** A voice fingerprint per clip (unit-length vectors: the closer two are, the likelier the same person). */
export async function voicePrints(clips: Float32Array[], onProgress?: Progress): Promise<Float32Array[]> {
  const { processor, model } = await speakerModel(onProgress);
  const out: Float32Array[] = [];
  for (const clip of clips) {
    const inputs = await processor(clip);
    const result = (await model(inputs)) as Record<string, Tensor>;
    const v = Float32Array.from((result.last_hidden_state ?? Object.values(result)[0]).data as Float32Array);
    const norm = Math.hypot(...v) || 1;
    out.push(v.map((x) => x / norm));
  }
  return out;
}

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
function speechModel(onProgress?: Progress) {
  // Assembled from its parts so exactly these files (and this precision) are used.
  asr ??= Promise.all([
    AutoTokenizer.from_pretrained(WHISPER),
    AutoProcessor.from_pretrained(WHISPER),
    WhisperForConditionalGeneration.from_pretrained(WHISPER, {
      dtype: { encoder_model: "int8", decoder_model_merged: "int8" },
      device: "wasm",
      progress_callback: reporter(onProgress, WHISPER_BYTES),
    }),
  ]).then(([tokenizer, processor, model]) => new AutomaticSpeechRecognitionPipeline({ task: "automatic-speech-recognition", model, tokenizer, processor }));
  asr.catch(() => { asr = null; });
  return asr;
}

/** Download the speech model ahead of use (shows progress once; later it comes from the browser's cache). */
export async function prepareSpeech(onProgress?: Progress) { await speechModel(onProgress); }

/** The words spoken in one clip. `language` (e.g. "russian") skips guessing it; without it the model detects it. */
export async function transcribe(clip: Float32Array, language?: string): Promise<string> {
  const run = await speechModel();
  const res = (await run(clip, { task: "transcribe", ...(language ? { language } : {}) })) as { text: string } | Array<{ text: string }>;
  return (Array.isArray(res) ? res.map((r) => r.text).join(" ") : res.text).trim();
}
