import type { ReactNode } from "react";
import { BODY_COLORS, type Look } from "../lib/look";

/*
 * A player's character: a coloured dot with a face, like the mascot. Drawn as SVG so it stays sharp
 * from the 20 px chip to the 96 px preview. Features are dark ink with an outline wherever they're
 * light, so every part reads on every body colour and in both themes.
 */

const INK = "#161614";
const WHITE = "#f7f7f2";
const PINK = "#ff7b95";
const GOLD = "#ffd84d";
const line = { stroke: INK, strokeWidth: 4.5, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;
const outlined = { stroke: INK, strokeWidth: 3, strokeLinejoin: "round" } as const;

const EYES: ReactNode[] = [
  // Dots.
  <><ellipse cx="36" cy="51" rx="6" ry="8" fill={INK} /><ellipse cx="64" cy="51" rx="6" ry="8" fill={INK} /></>,
  // Round with pupils.
  <><circle cx="36" cy="50" r="9" fill={WHITE} {...outlined} /><circle cx="64" cy="50" r="9" fill={WHITE} {...outlined} /><circle cx="38" cy="52" r="4" fill={INK} /><circle cx="66" cy="52" r="4" fill={INK} /></>,
  // Happy.
  <><path d="M28 53 Q36 42 44 53" {...line} /><path d="M56 53 Q64 42 72 53" {...line} /></>,
  // Sleepy.
  <><path d="M28 49 Q36 56 44 49" {...line} /><path d="M56 49 Q64 56 72 49" {...line} /></>,
  // Wink.
  <><ellipse cx="36" cy="51" rx="6" ry="8" fill={INK} /><path d="M56 53 Q64 42 72 53" {...line} /></>,
  // Shades.
  <><rect x="23" y="42" width="24" height="15" rx="6" fill={INK} /><rect x="53" y="42" width="24" height="15" rx="6" fill={INK} /><path d="M46 46 H54" {...line} strokeWidth={3} /><path d="M28 46 L33 46" stroke={WHITE} strokeWidth={2.5} strokeLinecap="round" /></>,
  // Big, looking up.
  <><circle cx="35" cy="49" r="11" fill={WHITE} {...outlined} /><circle cx="65" cy="49" r="11" fill={WHITE} {...outlined} /><circle cx="36" cy="45" r="5" fill={INK} /><circle cx="66" cy="45" r="5" fill={INK} /></>,
  // Little dots.
  <><circle cx="37" cy="51" r="4.5" fill={INK} /><circle cx="63" cy="51" r="4.5" fill={INK} /></>,
];

const MOUTHS: ReactNode[] = [
  // Smile.
  <path d="M38 68 Q50 80 62 68" {...line} />,
  // Open, mid-line.
  <ellipse cx="50" cy="72" rx="7.5" ry="6.5" fill={INK} />,
  // Flat.
  <path d="M41 72 H59" {...line} />,
  // Grin.
  <><path d="M35 66 H65 Q64 84 50 84 Q36 84 35 66 Z" fill={INK} /><path d="M42 78 Q50 72 58 78 Q56 84 50 84 Q44 84 42 78 Z" fill={PINK} /></>,
  // Tongue out.
  <><path d="M38 69 Q50 77 62 69" {...line} /><path d="M49 73 H59 V77 A5 5 0 0 1 49 77 Z" fill={PINK} {...outlined} strokeWidth={2.5} /></>,
  // Small "o".
  <circle cx="50" cy="73" r="4.5" fill={INK} />,
  // ":3".
  <path d="M39 69 Q44.5 76 50 69 Q55.5 76 61 69" {...line} />,
  // Smirk.
  <path d="M40 73 Q52 75 62 66" {...line} />,
];

const HATS: ReactNode[] = [
  null,
  // Headphones.
  <><path d="M9 58 A41 41 0 0 1 91 58" fill="none" stroke="#5b5b55" strokeWidth={6} strokeLinecap="round" /><rect x="3" y="48" width="13" height="23" rx="6" fill={INK} stroke="#5b5b55" strokeWidth={2} /><rect x="84" y="48" width="13" height="23" rx="6" fill={INK} stroke="#5b5b55" strokeWidth={2} /></>,
  // Cap.
  <><path d="M20 35 C20 4 80 4 80 35 Z" fill="#4d6bff" {...outlined} /><path d="M58 35 H95 Q95 41 88 41 H58 Z" fill="#4d6bff" {...outlined} /><circle cx="50" cy="9" r="3.5" fill={INK} /></>,
  // Crown.
  <path d="M27 30 L30 8 L41 19 L50 4 L59 19 L70 8 L73 30 Z" fill={GOLD} {...outlined} />,
  // Beanie with a pompom.
  <><path d="M19 33 C19 3 81 3 81 33 Z" fill="#e8452c" {...outlined} /><rect x="16" y="27" width="68" height="10" rx="5" fill={WHITE} {...outlined} /><circle cx="50" cy="3" r="6.5" fill={WHITE} {...outlined} /></>,
  // Bow.
  <><path d="M70 20 L56 9 L56 31 Z M70 20 L84 9 L84 31 Z" fill={PINK} {...outlined} /><circle cx="70" cy="20" r="4.5" fill={PINK} {...outlined} /></>,
  // Antenna.
  <><path d="M50 16 V5" stroke="#5b5b55" strokeWidth={4} strokeLinecap="round" /><circle cx="50" cy="6" r="5.5" fill={GOLD} {...outlined} /></>,
  // Horns.
  <><path d="M25 32 Q15 18 20 4 Q30 17 38 22 Z" fill={WHITE} {...outlined} /><path d="M75 32 Q85 18 80 4 Q70 17 62 22 Z" fill={WHITE} {...outlined} /></>,
  // Party hat.
  <><path d="M36 22 L52 -2 L64 20 Z" fill="#c6f135" {...outlined} transform="rotate(8 50 20)" /><circle cx="54" cy="0" r="4.5" fill={PINK} {...outlined} transform="rotate(8 50 20)" /></>,
];

export function Avatar({ look, size = 32, className = "" }: { look: Look; size?: number; className?: string }) {
  return (
    <svg className={"avatar-svg " + className} width={size} height={size} viewBox="0 -4 100 104" aria-hidden="true" focusable="false">
      <circle cx="50" cy="56" r="40" fill={BODY_COLORS[look.body] ?? BODY_COLORS[0]} />
      {EYES[look.eyes]}
      {MOUTHS[look.mouth]}
      {HATS[look.hat]}
    </svg>
  );
}

/** A player's name in the colour they picked (theme-aware: see `--nick-*` in tokens.css). */
export function Nick({ name, look }: { name: string; look: Look }) {
  return <span className="nick" data-nick={look.nick || undefined}>{name}</span>;
}
