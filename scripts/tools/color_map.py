"""Print a coarse colour/structure map of an image so its layout can be read
from the terminal without a display. Purely a dev helper for the konbini
reference-check workflow.
"""
from __future__ import annotations

import sys

from PIL import Image


def classify(r: int, g: int, b: int) -> str:
    luma = (r * 0.299 + g * 0.587 + b * 0.114) / 255
    if luma < 0.10:
        return ' '  # near black
    if luma < 0.22:
        return '.'
    if luma < 0.38:
        return ':'
    if luma < 0.55:
        return '-'
    if luma < 0.72:
        return '+'
    if luma < 0.88:
        return '*'
    return '#'


def main() -> None:
    path = sys.argv[1]
    cols = int(sys.argv[2]) if len(sys.argv) > 2 else 120
    rows = int(sys.argv[3]) if len(sys.argv) > 3 else 50
    crop = None
    if len(sys.argv) > 7:
        crop = tuple(int(v) for v in sys.argv[4:8])
    im = Image.open(path).convert('RGB')
    if crop:
        im = im.crop(crop)
    small = im.resize((cols, rows), Image.LANCZOS)
    print(f'{path} {im.size}')
    for y in range(rows):
        line = []
        for x in range(cols):
            r, g, b = small.getpixel((x, y))
            # warm pixels (orange/red) are lit sources; blue pixels are night sky.
            warm = r > b + 18 and r > 90
            if warm:
                line.append('W')
            elif b > r + 22 and b > 60:
                line.append('B')
            else:
                line.append(classify(r, g, b))
        print(''.join(line))


if __name__ == '__main__':
    main()
