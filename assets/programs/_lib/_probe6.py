"""Sixth probe: where the book spine ends up.

    conda run -n sand3d python assets/programs/_lib/_probe6.py

The book is 148 wide (X), 210 deep (Y), 32 tall (Z) in sand3d space, and the
spine runs along the hinge edge. This measures a few placements of a rounded
strip so the program can put it in the right place without guessing.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sand3d as s3d  # noqa: E402

from check_glb import bounds, read_glb  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_out")


def measure(name, make):
    s3d.empty_scene()
    obj = make()
    s3d.export(obj, os.path.join(OUT, f"p6_{name}.glb"))
    doc = read_glb(os.path.join(OUT, f"p6_{name}.glb"))
    lo, hi = bounds(doc["json"])
    size = [round(hi[i] - lo[i], 4) for i in range(3)]
    print(f"{name:<26} size={size}  min={[round(v, 3) for v in lo]}  max={[round(v, 3) for v in hi]}")


def main():
    os.makedirs(OUT, exist_ok=True)

    def strip():
        return s3d.extrude("spine", s3d.rect(4.3, 32, r=1.6), 210)

    def strip_rx():
        o = strip()
        s3d.at(o, rx=90)
        return o

    def strip_rx_placed():
        o = strip()
        # rx=90 把长度从 Z 转到 Y；再挪到书的铰链边（X = -74）、居中（Y=0）、贴底（Z=0）
        s3d.at(o, rx=90, x=-74, y=-105, z=-16)
        return o

    def book():
        return s3d.shell(s3d.box("cover", 148, 210, 32), 1.8, open="+Z")

    def book_with_spine():
        cover = s3d.shell(s3d.box("cover", 148, 210, 32), 1.8, open="+Z")
        spine = s3d.extrude("spine", s3d.rect(4.3, 32, r=1.6), 210)
        s3d.at(spine, rx=90, x=-74, y=-105, z=-16)
        return s3d.group("book", cover, spine)

    measure("strip", strip)
    measure("strip_rx", strip_rx)
    measure("strip_rx_placed", strip_rx_placed)
    measure("book", book)
    try:
        measure("book_with_spine", book_with_spine)
    except Exception as exc:
        print("book_with_spine failed:", type(exc).__name__, exc)


if __name__ == "__main__":
    main()
