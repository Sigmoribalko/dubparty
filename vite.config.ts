import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

/*
 * Content-Security-Policy for the built page. GitHub Pages can't send headers, so it goes in a
 * <meta>. Runs after the single-file inlining so it can hash the one inline app script: any
 * script injected later (XSS) has no matching hash and the browser refuses to run it.
 */
function csp(): Plugin {
  let supabase = "";
  const sha256 = async (s: string) =>
    btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))));
  return {
    name: "dubparty-csp",
    apply: "build",
    enforce: "post",
    configResolved(c) {
      const url = String(c.env.VITE_SUPABASE_URL ?? "");
      supabase = url ? new URL(url).host : "";
    },
    async generateBundle(_, bundle) {
      const page = bundle["index.html"];
      if (!page || page.type !== "asset") return;
      const html = String(page.source);
      const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)];
      const hashes = await Promise.all(scripts.map(async (m) => `'sha256-${await sha256(m[1])}'`));
      const policy = [
        "default-src 'self'",
        // Scripts: our own files (AI worker, pitch-shift worklet) and the hashed app script. No blob:, no other host.
        `script-src 'self' ${hashes.join(" ")}`,
        "worker-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        "frame-src 'none'",
        "manifest-src 'self'",
        "img-src 'self' data: blob:",
        "media-src 'self' data: blob:",
        `connect-src 'self' https://0.peerjs.com wss://0.peerjs.com${supabase ? ` https://${supabase} wss://${supabase}` : ""}`,
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        // DOM XSS: the browser refuses raw strings in innerHTML & co.
        "require-trusted-types-for 'script'",
        // One policy, used only to start the AI worker (src/lib/ai.ts); every other script URL is refused.
        "trusted-types dubparty-ai",
        "upgrade-insecure-requests",
      ].join("; ");
      const meta =
        `<meta http-equiv="Content-Security-Policy" content="${policy}" />\n` +
        `    <meta name="referrer" content="strict-origin-when-cross-origin" />\n    `;
      page.source = html.replace(/<meta name="viewport"/, (m) => meta + m);
    },
  };
}

// `npm run build` produces dist/index.html with the app inlined, plus the site's own files from public/
// (fonts, the pitch-shift worklet, AI worker and models).
export default defineConfig({
  plugins: [react(), viteSingleFile(), csp()],
  // Same runtime as the separate AI build (vite.ai.config.ts), for development where src/ai is imported directly.
  resolve: { alias: { "onnxruntime-web/webgpu": "/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs" } },
  build: { target: "es2022", assetsInlineLimit: Infinity },
});
