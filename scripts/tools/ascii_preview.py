from PIL import Image
import sys

chars = ' .:-=+*#%@'


def preview(path, cols=140, rows=52, crop=None):
    im = Image.open(path).convert('RGB')
    if crop:
        im = im.crop(crop)
    w, h = im.size
    im2 = im.resize((cols, rows), Image.LANCZOS)
    print(path, im.size)
    for y in range(rows):
        line = []
        for x in range(cols):
            r, g, b = im2.getpixel((x, y))
            l = int((r * 0.299 + g * 0.587 + b * 0.114) * 10 // 256)
            line.append(chars[max(0, min(9, l))])
        print(''.join(line))


if __name__ == '__main__':
    p = sys.argv[1]
    c = int(sys.argv[2]) if len(sys.argv) > 2 else 140
    r = int(sys.argv[3]) if len(sys.argv) > 3 else 52
    preview(p, c, r)
