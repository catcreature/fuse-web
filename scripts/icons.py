"""Draws Fuse's PNG icons from the same shapes as public/icons/icon.svg.

Needs Pillow (`pip install pillow`). Run from fuse_web/:  python scripts/icons.py
Writes public/icons/icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
BG = (0x1B, 0x1C, 0x20, 255)
LOW = (0xD9, 0x48, 0x0F)   # gradient at the flame's base
HIGH = (0xF5, 0x9F, 0x00)  # gradient at the tip
CORE = (0xFF, 0xD4, 0x3B, 255)
SS = 4  # supersampling


def bezier(p0, p1, p2, p3, n=64):
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        yield (u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
               u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1])


def drop(tip_y, half, base_y, c1, c2):
    """The SVG teardrop: tip at (256, tip_y), curves down to (256±half, base_y), a half circle below."""
    cx = 256
    pts = list(bezier((cx, tip_y), (cx + c1[0], c1[1]), (cx + half, c2), (cx + half, base_y)))
    for i in range(1, 64):  # lower half circle, right to left
        a = math.pi * i / 64
        pts.append((cx + half * math.cos(a), base_y + half * math.sin(a)))
    pts += list(bezier((cx - half, base_y), (cx - half, c2), (cx - c1[0], c1[1]), (cx, tip_y)))
    return pts


OUTER = drop(96, 112, 312, (44, 170), 220)
INNER = drop(236, 56, 340, (24, 274), 298)


def render(size, rounded):
    s = 512 * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=112 * SS, fill=BG)
    else:
        d.rectangle((0, 0, s, s), fill=BG)

    grad = Image.new("RGBA", (s, s))
    gd = ImageDraw.Draw(grad)
    top, bottom = 96 * SS, 424 * SS
    for y in range(s):
        t = min(1, max(0, (bottom - y) / (bottom - top)))
        gd.line((0, y, s, y), fill=tuple(round(LOW[i] + (HIGH[i] - LOW[i]) * t) for i in range(3)) + (255,))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).polygon([(x * SS, y * SS) for x, y in OUTER], fill=255)
    img.paste(grad, (0, 0), mask)
    d.polygon([(x * SS, y * SS) for x, y in INNER], fill=CORE)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    render(192, True).save(OUT / "icon-192.png")
    render(512, True).save(OUT / "icon-512.png")
    render(512, False).save(OUT / "maskable-512.png")
    render(180, False).save(OUT / "apple-touch-icon.png")  # iOS rounds the corners itself
    print("wrote", ", ".join(p.name for p in sorted(OUT.glob("*.png"))))


if __name__ == "__main__":
    main()
