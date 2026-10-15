import type { DataConnection } from "peerjs";

/*
 * One reliable WebRTC data channel between two players.
 *
 * Control messages are JSON strings. Files (videos, recordings) are streamed as binary frames:
 *   [u32 header length][header JSON {f: fileId, s: seq}][payload ≤ CHUNK bytes]
 * bracketed by "file-begin" / "file-end" JSON messages. Sending respects the channel's
 * buffer so a 100 MB video doesn't blow the SCTP queue.
 */

const CHUNK = 64 * 1024;
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 512 * 1024;
/** Anything bigger than this from a peer is dropped (a scene video is well under it). */
const MAX_FILE = 512 * 1024 * 1024;
/**
 * Peers are strangers: only sound and video reach blob URLs, never something a browser would
 * render as a page or run (an SVG "image" can carry script). The game uses no other files.
 */
const SAFE_TYPE = /^(audio|video)\/[a-z0-9.+-]+$/i;
/** Files being received at once from one peer: more is a peer trying to fill our memory. */
const MAX_INCOMING = 2;
/** A control message is small; the biggest is the host's room state with the scene's lines. */
const MAX_MESSAGE = 2 * 1024 * 1024;
/** Control messages per second a peer may send on average (bursts up to BURST), so one can't flood the other. */
const RATE = 60;
const BURST = 240;
/** A peer that keeps flooding after being throttled is cut off. */
const MAX_DROPPED = 2000;

export type Json = Record<string, unknown> & { t: string };

export interface FileMeta {
  [k: string]: unknown;
  kind: string;
}

interface Incoming {
  meta: FileMeta;
  size: number;
  type: string;
  parts: ArrayBuffer[];
  received: number;
}

let fileSeq = 0;
const enc = new TextEncoder();
const dec = new TextDecoder();

export class Link {
  onMessage: (msg: Json) => void = () => {};
  onFile: (meta: FileMeta, blob: Blob) => void = () => {};
  onFileProgress: (meta: FileMeta, received: number, total: number) => void = () => {};
  onClose: () => void = () => {};
  /** Decides at "file-begin" whether to take a file at all, so an unwanted one is never buffered. */
  acceptFile: (meta: FileMeta, size: number) => boolean = () => true;

  private incoming = new Map<string, Incoming>();
  private tokens = BURST;
  private refilled = Date.now();
  private dropped = 0;
  /** Files go out one at a time so progress is meaningful and memory stays flat. */
  private queue: Promise<void> = Promise.resolve();

  constructor(readonly conn: DataConnection) {
    conn.on("data", (d) => this.receive(d));
    conn.on("close", () => this.onClose());
    conn.on("error", () => this.onClose());
  }

  get peer() {
    return this.conn.peer;
  }

  send(msg: Json) {
    if (this.conn.open) this.conn.send(JSON.stringify(msg));
  }

  sendFile(meta: FileMeta, blob: Blob, onProgress?: (sent: number, total: number) => void): Promise<void> {
    const run = async () => {
      if (!this.conn.open) return;
      const id = `${Date.now().toString(36)}${(fileSeq++).toString(36)}`;
      this.send({ t: "file-begin", id, meta, size: blob.size, type: blob.type });
      let seq = 0;
      for (let off = 0; off < blob.size; off += CHUNK) {
        if (!this.conn.open) return;
        await this.drain();
        const payload = new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer());
        const header = enc.encode(JSON.stringify({ f: id, s: seq++ }));
        const frame = new Uint8Array(4 + header.length + payload.length);
        new DataView(frame.buffer).setUint32(0, header.length);
        frame.set(header, 4);
        frame.set(payload, 4 + header.length);
        this.conn.send(frame.buffer);
        onProgress?.(Math.min(blob.size, off + CHUNK), blob.size);
      }
      this.send({ t: "file-end", id });
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  close() {
    try { this.conn.close(); } catch { /* already closed */ }
  }

  private drain(): Promise<void> {
    const dc = this.conn.dataChannel;
    if (!dc || dc.bufferedAmount < HIGH_WATER) return Promise.resolve();
    dc.bufferedAmountLowThreshold = LOW_WATER;
    return new Promise((res) => {
      const done = () => { dc.removeEventListener("bufferedamountlow", done); res(); };
      dc.addEventListener("bufferedamountlow", done);
      setTimeout(done, 3000); // never hang if the event is missed
    });
  }

  /** Token bucket for control messages. File frames are not counted: they are paced by the sender's buffer. */
  private allow(): boolean {
    const now = Date.now();
    this.tokens = Math.min(BURST, this.tokens + ((now - this.refilled) / 1000) * RATE);
    this.refilled = now;
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    if (++this.dropped > MAX_DROPPED) this.close();
    return false;
  }

  private receive(data: unknown) {
    if (typeof data === "string") {
      if (data.length > MAX_MESSAGE || !this.allow()) return;
      let msg: Json;
      try { msg = JSON.parse(data) as Json; } catch { return; }
      if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return;
      if (msg.t === "file-begin") {
        const size = Number(msg.size);
        const meta = msg.meta as FileMeta;
        if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE || !meta || typeof meta !== "object" || Array.isArray(meta)) return;
        if (this.incoming.size >= MAX_INCOMING || !this.acceptFile(meta, size)) return;
        const type = String(msg.type || "");
        this.incoming.set(String(msg.id), { meta, size, type: SAFE_TYPE.test(type) ? type : "", parts: [], received: 0 });
      } else if (msg.t === "file-end") {
        const f = this.incoming.get(String(msg.id));
        this.incoming.delete(String(msg.id));
        if (f && f.received === f.size) this.onFile(f.meta, new Blob(f.parts, { type: f.type }));
      } else {
        this.onMessage(msg);
      }
      return;
    }
    const buf = data instanceof ArrayBuffer ? data : ArrayBuffer.isView(data) ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer) : null;
    if (!buf || buf.byteLength < 4) return;
    const hlen = new DataView(buf).getUint32(0);
    if (hlen > 256 || 4 + hlen > buf.byteLength) return;
    let header: { f: string; s: number };
    try { header = JSON.parse(dec.decode(new Uint8Array(buf, 4, hlen))); } catch { return; }
    const f = this.incoming.get(String(header?.f));
    if (!f) return;
    const payload = buf.slice(4 + hlen);
    // Frames arrive in order on a reliable channel; anything else is a misbehaving peer.
    if (header.s !== f.parts.length || payload.byteLength > CHUNK || f.received + payload.byteLength > f.size) {
      this.incoming.delete(String(header.f));
      return;
    }
    f.parts.push(payload);
    f.received += payload.byteLength;
    this.onFileProgress(f.meta, f.received, f.size);
  }
}
