import { defineConfig } from "vite";

/*
 * The in-browser AI (src/ai) is built on its own into dist/vendor/ai-worker.js, a background thread
 * started only by someone who takes a video apart, so the page everybody opens stays small and responsive.
 * The ONNX runtime's WebAssembly and the models are plain files next to it (npm run models).
 */
export default defineConfig({
  publicDir: false,
  resolve: {
    // CPU (WebAssembly) build of the runtime: half the size of the WebGPU one and runs everywhere. Its
    // WebAssembly (14 MB) is a separate file in vendor/, fetched once and cached, not text inside ai.js.
    alias: { "onnxruntime-web/webgpu": "/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs" },
  },
  build: {
    outDir: "dist/vendor",
    emptyOutDir: false,
    target: "es2022",
    copyPublicDir: false,
    minify: true,
    lib: { entry: "src/ai/worker.ts", formats: ["es"], fileName: () => "ai-worker.js" },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
