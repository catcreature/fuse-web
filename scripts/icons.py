"""Draws Fuse's PNG icons from the Android app's launcher art (public/icons/icon.svg, maskable.svg).

The art is fuse/app/src/main/res/drawable/ic_launcher_foreground.xml: a 108x108 viewport on #1B1C20, a white fuse
curve, an ember spark and five short rays. Needs Pillow (`pip install pillow`). Run from fuse_web/:
python scripts/icons.py. Writes public/icons/icon-192.png, icon-512.png (rounded, art scaled 1.35x round the
centre, as icon.svg), maskable-512.png and apple-touch-icon.png (full-bleed, unscaled, as maskable.svg).
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
BG = (0x1B, 0x1C, 0x20, 255)
WHITE = (0xFF, 0xFF, 0xFF, 255)
EMBER = (0xFF, 0x7A, 0x3D, 255)
RAYS = (0xFF, 0xB7, 0x4D, 255)
SS = 4  # drawn at 4x, then downsampled
ROUND_RX = 24  # icon.svg's rect rx, in the 108 viewport
ROUND_SCALE = 1.35  # icon.svg's art scale round (54, 54)


def cubic(p0, p1, p2, p3, n=48):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append((u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                    u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]))
    return out


# M34,74 C44,74 44,59 54,59 S64,44 69,41.5: the S's first control point is (44,59) reflected round (54,59).
_c1 = cubic((34, 74), (44, 74), (44, 59), (54, 59))
_prev = (44, 59)
_reflect = (2 * 54 - _prev[0], 2 * 59 - _prev[1])
FUSE = _c1 + cubic((54, 59), _reflect, (64, 44), (69, 41.5))[1:]
SPARK = ((71.5, 36.5), 6.5)
RAY_LINES = [((71.5, 23), (71.5, 26.5)), ((58, 36.5), (61.5, 36.5)), ((81.5, 36.5), (85, 36.5)),
             ((61.8, 26.8), (64.3, 29.3)), ((81.2, 26.8), (78.7, 29.3))]


def stroke(d, pts, width, color):
    """A polyline with round joins and round caps: each segment a thick line, a disc on every vertex (Pillow's own
    joint="curve" leaves hairline gaps between short segments)."""
    r = width / 2
    for a, b in zip(pts, pts[1:]):
        d.line((a, b), fill=color, width=round(width))
    for x, y in pts:
        d.ellipse((x - r, y - r, x + r, y + r), fill=color)


def render(size, rounded):
    s = size * SS
    k = s / 108
    art = ROUND_SCALE if rounded else 1.0

    def p(x, y):  # viewport point -> pixels, art scaled round the centre
        return ((54 + (x - 54) * art) * k, (54 + (y - 54) * art) * k)

    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=ROUND_RX * k, fill=BG)
    else:
        d.rectangle((0, 0, s, s), fill=BG)
    stroke(d, [p(x, y) for x, y in FUSE], 5 * art * k, WHITE)
    (cx, cy), r = SPARK
    x, y = p(cx, cy)
    r *= art * k
    d.ellipse((x - r, y - r, x + r, y + r), fill=EMBER)
    for a, b in RAY_LINES:
        stroke(d, [p(*a), p(*b)], 3.5 * art * k, RAYS)
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
