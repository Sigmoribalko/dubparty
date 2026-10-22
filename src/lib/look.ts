/**
 * A player's look: a drawn character in the style of "Точка" (the mascot) and a colour for their name.
 * Every part is an index into a fixed list, so a look is five small numbers: cheap to send to the room,
 * and a stranger's look can't carry anything but a choice from these lists.
 */
export interface Look {
  body: number;
  eyes: number;
  mouth: number;
  hat: number;
  nick: number;
}

export const BODY_COLORS = ["#e8452c", "#ff9d5c", "#ffd84d", "#c6f135", "#6fd36b", "#4cc9a6", "#5bb8ff", "#6f8bff", "#a77bff", "#ff7b95"];

/** How many variants each part has (drawn in components/Avatar.tsx; name colours are in tokens.css). */
export const LOOK_PARTS = { body: BODY_COLORS.length, eyes: 8, mouth: 8, hat: 9, nick: 13 } as const;
export type LookPart = keyof typeof LOOK_PARTS;
export const PART_ORDER: LookPart[] = ["body", "eyes", "mouth", "hat", "nick"];

const rnd = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;

export const randomLook = (): Look => ({
  body: rnd(LOOK_PARTS.body),
  eyes: rnd(LOOK_PARTS.eyes),
  mouth: rnd(LOOK_PARTS.mouth),
  hat: rnd(LOOK_PARTS.hat),
  nick: rnd(LOOK_PARTS.nick),
});

/** Players who never picked a look (or run an older version) still get one, the same on every device. */
export function lookFromName(name: string): Look {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
  const take = (n: number) => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h ^= h >>> 13; return h % n; };
  return { body: take(LOOK_PARTS.body), eyes: take(LOOK_PARTS.eyes), mouth: take(LOOK_PARTS.mouth), hat: 0, nick: 0 };
}

/** A look from storage or another player's browser: parts out of range fall back to the first variant. */
export function cleanLook(v: unknown): Look | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const part = (k: LookPart) => { const n = Number(o[k]); return Number.isInteger(n) && n >= 0 && n < LOOK_PARTS[k] ? n : 0; };
  return { body: part("body"), eyes: part("eyes"), mouth: part("mouth"), hat: part("hat"), nick: part("nick") };
}

export const lookOf = (v: unknown, name: string): Look => cleanLook(v) ?? lookFromName(name);

export const sameLook = (a: Look, b: Look) => PART_ORDER.every((k) => a[k] === b[k]);
