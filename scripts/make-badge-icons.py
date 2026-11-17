"""The logo's badged variants, all from build-resources/icon.png the same way — a small badge on
its top-right corner (a coloured mark on a white disc, edged in light grey); only the mark and
its colour differ:

  icon-dev.png         gear, purple   the from-source app (Dock, launcher; icon-dev.icns follows)
  installerIcon.ico    download, green the Windows setup .exe, so it isn't taken for the app
  uninstallerIcon.ico  bin, red        the Windows uninstaller

Run again after icon.png changes:  python3 scripts/make-badge-icons.py   (needs Pillow)
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

RES = Path(__file__).resolve().parent.parent / 'build-resources'
SS = 4  # supersampling, for smooth edges
SIZE = 1024
CX, CY = 830, 200  # the mark's centre, in 1024-px logo units
K = 0.6  # the badge's scale (drawn below for a 215-px disc)
DISC, RING = 215, 12  # the badge's disc radius and grey edge, in mark units
PURPLE = (99, 102, 241)  # the logo's blue-purple, deepened to read as a mark
GREEN = (22, 163, 74)
RED = (220, 38, 38)
ICO_SIZES = [(n, n) for n in (16, 24, 32, 48, 64, 128, 256)]
ON, OFF = 255, 0


def s(v: float) -> int:
    return round(v * SS)


def u(v: float) -> int:
    """A length in mark units, in pixels."""
    return s(v * K)


def box(x0: float, y0: float, x1: float, y1: float) -> list[int]:
    return [s(CX + x0 * K), s(CY + y0 * K), s(CX + x1 * K), s(CY + y1 * K)]


def pt(x: float, y: float) -> tuple[int, int]:
    return (s(CX + x * K), s(CY + y * K))


# Each mark draws its shape ON (holes OFF) into a mask, centred on (CX, CY).


def mark_dev(d: ImageDraw.ImageDraw) -> None:
    teeth, inner, outer = 8, 108, 158  # a gear
    for t in range(teeth):
        a = 2 * math.pi * t / teeth
        tooth = [(-30, inner - 10), (30, inner - 10), (24, outer), (-24, outer)]
        d.polygon([pt(x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a))
                   for x, y in tooth], fill=ON)
    d.ellipse(box(-inner - 12, -inner - 12, inner + 12, inner + 12), fill=ON)
    d.ellipse(box(-50, -50, 50, 50), fill=OFF)


def mark_download(d: ImageDraw.ImageDraw) -> None:
    dy = -17  # lifted: its wide tray weighs the bottom, so a box-centred arrow reads low
    d.rectangle(box(-24, -140 + dy, 24, 10 + dy), fill=ON)  # shaft
    d.polygon([pt(-100, -20 + dy), pt(100, -20 + dy), pt(0, 85 + dy)], fill=ON)
    t = 40  # tray
    d.rectangle(box(-130, 110 + dy, 130, 110 + t + dy), fill=ON)
    d.rectangle(box(-130, 55 + dy, -130 + t, 110 + t + dy), fill=ON)
    d.rectangle(box(130 - t, 55 + dy, 130, 110 + t + dy), fill=ON)


def mark_bin(d: ImageDraw.ImageDraw) -> None:
    d.rounded_rectangle(box(-48, -160, 48, -106), radius=u(15), fill=ON)  # handle
    d.rectangle(box(-24, -136, 24, -106), fill=OFF)
    d.rounded_rectangle(box(-132, -118, 132, -78), radius=u(11), fill=ON)  # lid
    d.polygon([pt(-106, -55), pt(106, -55), pt(87, 160), pt(-87, 160)], fill=ON)  # body
    for x in (-48, 0, 48):  # slots
        d.rounded_rectangle(box(x - 12, -24, x + 12, 126), radius=u(12), fill=OFF)


def badged(mark, colour: tuple[int, int, int]) -> Image.Image:
    logo = Image.open(RES / 'icon.png').convert('RGBA')
    big = (SIZE * SS,) * 2
    ring, disc, glyph = (Image.new('L', big, OFF) for _ in range(3))
    o = DISC + RING
    ImageDraw.Draw(ring).ellipse(box(-o, -o, o, o), fill=ON)
    ImageDraw.Draw(disc).ellipse(box(-DISC, -DISC, DISC, DISC), fill=ON)
    mark(ImageDraw.Draw(glyph))
    out = logo
    for mask, rgb in ((ring, (200, 200, 200)), (disc, (255, 255, 255)), (glyph, colour)):
        out = Image.alpha_composite(out, _solid(mask.resize((SIZE, SIZE), Image.LANCZOS), rgb))
    return out


def _solid(mask: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    layer = Image.new('RGBA', mask.size, (*rgb, 0))
    layer.putalpha(mask)
    return layer


def ico(img: Image.Image, name: str) -> None:
    img.resize((256, 256), Image.LANCZOS).save(RES / name, sizes=ICO_SIZES)


if __name__ == '__main__':
    badged(mark_dev, PURPLE).save(RES / 'icon-dev.png')
    ico(badged(mark_download, GREEN), 'installerIcon.ico')
    ico(badged(mark_bin, RED), 'uninstallerIcon.ico')
    print('wrote icon-dev.png, installerIcon.ico, uninstallerIcon.ico in', RES)
