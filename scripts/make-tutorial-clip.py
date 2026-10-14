#!/usr/bin/env python3
"""Render public/tutorial.mp4: the practice scene's character ("Точка", the red dot from the logo).

It is our own drawing, so the tutorial needs no film footage. The clip is silent: the character's
"voice" is synthesised in the browser (src/lib/tutorial.ts) from the same syllable timings as the
mouth here, so keep SYLLABLES in the two files identical.

Usage: python3 scripts/make-tutorial-clip.py   (needs Pillow and ffmpeg)
"""
import math
import subprocess
from PIL import Image, ImageDraw

W, H, FPS, DURATION, SS = 640, 360, 25, 7.2, 3  # SS: supersampling for smooth edges

# (onset, length) of every syllable, in seconds of video. Mirrors src/lib/tutorial.ts.
LINE1 = [(1.00, 0.20), (1.22, 0.24), (1.62, 0.22), (1.95, 0.20), (2.20, 0.34)]
LINE2 = [(3.80 + i * 0.19, 0.17) for i in range(11)] + [(3.80 + 11 * 0.19, 0.30)]
SYLLABLES = LINE1 + LINE2
BLINKS = [0.55, 3.1, 6.55]

BG, DOT, WHITE, DARK, LIME, FLOOR = (29, 29, 27), (232, 69, 44), (244, 244, 239), (26, 17, 15), (198, 241, 53), (22, 22, 20)


def mouth(t):
    return max([math.sin(math.pi * (t - a) / d) for a, d in SYLLABLES if a <= t <= a + d] or [0.0])


def frame(t):
    img = Image.new("RGB", (W * SS, H * SS), BG)
    d = ImageDraw.Draw(img)
    s = lambda v: v * SS
    ell = lambda cx, cy, rx, ry, fill: d.ellipse([s(cx - rx), s(cy - ry), s(cx + rx), s(cy + ry)], fill=fill)

    m = mouth(t)
    bob = 5 * math.sin(2 * math.pi * t / 2.6) - 7 * m       # breathes; lifts a little on every syllable
    squash = 1 + 0.035 * m
    cx, cy, r = 320, 172 + bob, 98

    ell(320, 300, 92 - 0.6 * bob, 12 - 0.1 * bob, FLOOR)   # shadow on the floor
    ell(cx, cy, r / squash, r * squash, DOT)

    blink = min([abs(t - b) / 0.07 for b in BLINKS] + [1.0])  # 0 = shut
    look = 5 * math.sin(2 * math.pi * t / 4.1)
    for side in (-1, 1):
        ex, ey = cx + side * 36, cy - 24
        ell(ex, ey, 17, max(1.5, 22 * blink), WHITE)
        if blink > 0.35:
            ell(ex + look, ey + 2, 8, 8 * blink, DARK)

    ell(cx, cy + 44, 30 - 4 * m, 3.5 + 25 * m, DARK)         # the mouth opens with each syllable
    if m > 0.5:
        ell(cx, cy + 44 + 16 * m, 13, 7 * m, (201, 52, 38))    # tongue

    for i in range(3):                                         # sound waves while speaking
        level = max(0.0, m - 0.15 * i)
        if level > 0.05:
            x, hgt = 446 + i * 20, 12 + 34 * level * (1 - 0.22 * i)
            d.rounded_rectangle([s(x), s(cy + 30 - hgt), s(x + 9), s(cy + 30 + hgt)], radius=s(4.5), fill=LIME)

    return img.resize((W, H), Image.LANCZOS)


def main():
    ff = subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "public/tutorial.mp4"],
        stdin=subprocess.PIPE)
    for n in range(int(DURATION * FPS)):
        ff.stdin.write(frame(n / FPS).tobytes())
    ff.stdin.close()
    ff.wait()


if __name__ == "__main__":
    main()
