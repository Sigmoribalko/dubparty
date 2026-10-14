#!/usr/bin/env node
/*
 * Downloads the AI models the site runs in the browser into public/models/ (not kept in git).
 * Run before building: CI does it on every deploy, locally run `npm run models` once.
 *
 *  - WeSpeaker ResNet34 (voice fingerprints: who speaks). CC BY 4.0, credit in the app's settings.
 *  - Whisper base (speech to text). MIT.
 *
 * Every file is pinned to a repository commit and checked against its SHA-256, so a changed or
 * tampered file fails the build instead of reaching players.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = new URL("../public/models/", import.meta.url).pathname;
const MODELS = [
  {
    repo: "onnx-community/wespeaker-voxceleb-resnet34-LM",
    rev: "6a61a1833ff2583aabeba044f5c8221f00b67ceb",
    files: {
      "config.json": null,
      "preprocessor_config.json": null,
      "onnx/model_int8.onnx": "6416fae0599c33bdaf7188e99695edc5fafde190a102c511c881245a109de4c3",
    },
  },
  {
    repo: "onnx-community/whisper-base",
    rev: "1846881b6b3a3024392c1eea3ad983695bc23925",
    files: {
      "config.json": null,
      "generation_config.json": null,
      "preprocessor_config.json": null,
      "tokenizer.json": null,
      "tokenizer_config.json": null,
      "special_tokens_map.json": null,
      "added_tokens.json": null,
      "normalizer.json": null,
      "vocab.json": null,
      "merges.txt": null,
      "onnx/encoder_model_int8.onnx": "ca6177401f86a2c6b4dc5f7fc02fbca680678906bd0c22f6d89f0b80f124253f",
      "onnx/decoder_model_merged_int8.onnx": "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b",
    },
  },
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
// Small text files carry no checksum on the hub; theirs are pinned here.
const TEXT_SUMS = JSON.parse(readFileSync(new URL("./models.sha256.json", import.meta.url), "utf8"));

let failed = false;
for (const m of MODELS) {
  for (const [file, lfsSum] of Object.entries(m.files)) {
    const want = lfsSum ?? TEXT_SUMS[`${m.repo}/${file}`];
    const dest = join(ROOT, m.repo, file);
    if (existsSync(dest) && want && sha256(readFileSync(dest)) === want) continue;
    const url = `https://huggingface.co/${m.repo}/resolve/${m.rev}/${file}`;
    process.stdout.write(`${m.repo}/${file} … `);
    const res = await fetch(url);
    if (!res.ok) { console.log(`HTTP ${res.status}`); failed = true; continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const got = sha256(buf);
    if (want && got !== want) { console.log(`checksum mismatch (${got})`); failed = true; continue; }
    if (!want) { console.log(`no pinned checksum: ${got}`); failed = true; continue; }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    console.log(`${(buf.length / 1e6).toFixed(1)} MB ok`);
  }
}
if (failed) { console.error("Model download failed."); process.exit(1); }

// The ONNX runtime the models run on (CPU/WebAssembly build), served from the site as well.
const VENDOR = new URL("../public/vendor/", import.meta.url).pathname;
const ORT = new URL("../node_modules/onnxruntime-web/dist/", import.meta.url).pathname;
mkdirSync(VENDOR, { recursive: true });
for (const f of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) writeFileSync(join(VENDOR, f), readFileSync(join(ORT, f)));
console.log("onnx runtime copied to public/vendor");
