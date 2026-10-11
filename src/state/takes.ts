import type { EffectId } from "../lib/audio/effects";
import { decodeBlob } from "../lib/audio/engine";
import { store } from "../lib/store";
import type { RecordedTrack } from "../lib/types";
import type { Game } from "./game";

/*
 * A player's recorded lines survive a closed tab or a crash: each one is written to this
 * browser's storage the moment it's recorded and read back when the same round is opened again.
 * Only one round is kept at a time; anything older is dropped.
 */

const META = "dubl-line-takes";
const MAX_AGE = 6 * 60 * 60 * 1000;

/** The round and part these takes belong to. */
export interface TakeContext { room: string; round: number; sceneId: string; roleId: string }
interface Meta extends TakeContext {
  /** lineId → offset of that take (track time = video time + offset). */
  lines: Record<string, number>;
  effect?: EffectId;
  at: number;
}

const mediaKey = (c: TakeContext, lineId: string) => `take:${c.room}:${c.round}:${c.roleId}:${lineId}`;
const same = (m: Meta | null, c: TakeContext): m is Meta => !!m && m.room === c.room && m.round === c.round && m.sceneId === c.sceneId && m.roleId === c.roleId;

function read(): Meta | null {
  try {
    const m = JSON.parse(localStorage.getItem(META) ?? "null") as Meta | null;
    return m && typeof m === "object" && m.lines && typeof m.lines === "object" ? m : null;
  } catch {
    return null;
  }
}
function write(m: Meta | null) {
  try {
    if (m) localStorage.setItem(META, JSON.stringify(m));
    else localStorage.removeItem(META);
  } catch { /* private mode / full: the takes just won't survive a reload */ }
}

async function drop(m: Meta | null) {
  if (!m) return;
  for (const id of Object.keys(m.lines)) await store.deleteMedia(mediaKey(m, id));
  if (read()?.at === m.at) write(null);
}

/** Start (or continue) keeping takes for this round, dropping a previous round's. */
async function open(c: TakeContext): Promise<Meta> {
  const m = read();
  if (same(m, c)) return m;
  await drop(m);
  return { ...c, lines: {}, at: Date.now() };
}

/** Writes are queued so two quick saves can't interleave their read-modify-write of the index. */
let queue: Promise<unknown> = Promise.resolve();
const queued = <T,>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

/** Keep one recorded line (replaces an earlier take of the same line). */
export const keepLineTake = (c: TakeContext, lineId: string, take: { blob: Blob; offset: number }) => queued(async () => {
  const m = await open(c);
  await store.putMedia(mediaKey(c, lineId), take.blob);
  m.lines[lineId] = take.offset;
  m.at = Date.now();
  write(m);
});

/** Remember the voice effect chosen for this part. */
export const keepEffect = (c: TakeContext, effect: EffectId) => queued(async () => {
  const m = await open(c);
  m.effect = effect;
  m.at = Date.now();
  write(m);
});

/**
 * Put back the lines this browser recorded earlier in the same round (after a reload).
 * Returns the restored takes so they can be handed to the host again.
 */
export const restoreLineTakes = (game: Game, room: string) => queued(async (): Promise<Record<string, RecordedTrack>> => {
  const out: Record<string, RecordedTrack> = {};
  const m = read();
  if (!m) return out;
  const c: TakeContext = { room, round: game.round, sceneId: game.scene.id, roleId: game.myRoleId ?? "" };
  if (!same(m, c) || Date.now() - m.at > MAX_AGE) { await drop(m); return out; }
  const mine = new Set(game.scene.lines.filter((l) => l.roleId === c.roleId).map((l) => l.id));
  for (const [lineId, offset] of Object.entries(m.lines)) {
    if (!mine.has(lineId) || game.lineTakes[lineId]) continue;
    const blob = await store.getMedia(mediaKey(c, lineId));
    if (!blob) continue;
    try {
      out[lineId] = game.lineTakes[lineId] = { blob, buffer: await decodeBlob(blob), offset: Number(offset) || 0 };
    } catch { /* unreadable: that line is recorded again */ }
  }
  if (m.effect && !game.effects[c.roleId]) game.effects[c.roleId] = m.effect;
  return out;
});

/** Forget takes of a round nobody came back to. */
export const forgetStaleTakes = () => queued(async () => {
  const m = read();
  if (m && Date.now() - m.at > MAX_AGE) await drop(m);
});
