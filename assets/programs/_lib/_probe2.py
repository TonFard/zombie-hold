"""Measure how sand3d places things, so the atom programs stop guessing.

    conda run -n sand3d python assets/programs/_lib/_probe2.py

Prints the bounding box of a few constructions whose orientation the docs
leave ambiguous: which way a cylinder lies after ``ry=90``, where ``grid``
puts the first item, and what ``join`` does to placements.

Note: ``at(ob, on=frames)`` *uses up* the object and returns one copy per
frame, so a call that places a list of frames has to keep the returned list.
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
    s3d.export(obj, os.path.join(OUT, f"probe_{name}.glb"))
    doc = read_glb(os.path.join(OUT, f"probe_{name}.glb"))
    lo, hi = bounds(doc["json"])
    size = [round(hi[i] - lo[i], 4) for i in range(3)]
    print(f"{name:<28} size={size}  min={[round(v, 3) for v in lo]}  max={[round(v, 3) for v in hi]}")


def main():
    os.makedirs(OUT, exist_ok=True)

    def cyl_ry90():
        c = s3d.cylinder("c", d=11, h=160)
        s3d.at(c, ry=90)
        return c

    def cyl_rx90():
        c = s3d.cylinder("c", d=11, h=160)
        s3d.at(c, rx=90)
        return c

    def grid2():
        c = s3d.cylinder("c", d=11, h=20)
        placed = s3d.at(c, on=s3d.grid(2, 1, 149))
        return s3d.join(placed[0], placed[1])

    def grid1():
        c = s3d.cylinder("c", d=11, h=20)
        placed = s3d.at(c, on=s3d.grid(1, 1, 149))
        return placed[0]

    def joined_handle():
        bar = s3d.cylinder("bar", d=11, h=160)
        s3d.at(bar, ry=90)
        posts = s3d.cylinder("post", d=7.7, h=20)
        placed = s3d.at(posts, on=s3d.grid(2, 1, 149))
        return s3d.join(bar, placed)

    def revolve_rod():
        return s3d.revolve("r", s3d.poly([(0, 0), (4.3, 0), (4.3, 206), (0, 206)]))

    def revolve_rx90():
        r = revolve_rod()
        s3d.at(r, rx=90)
        return r

    def revolve_ry90():
        r = revolve_rod()
        s3d.at(r, ry=90)
        return r

    measure("cyl_plain", lambda: s3d.cylinder("c", d=11, h=160))
    measure("cyl_ry90", cyl_ry90)
    measure("cyl_rx90", cyl_rx90)
    measure("grid1", grid1)
    measure("grid2_149", grid2)
    measure("joined_handle", joined_handle)
    measure("extrude_plank", lambda: s3d.extrude("p", s3d.rect(1200, 600, r=8), 25))
    measure("box", lambda: s3d.box("b", 100, 200, 300))
    measure("shell_open_z", lambda: s3d.shell(s3d.box("c", 148, 210, 32), 1.8, open="+Z"))
    measure("revolve_rod", revolve_rod)
    measure("revolve_rx90", revolve_rx90)
    measure("revolve_ry90", revolve_ry90)
    measure("cone_plain", lambda: s3d.cone("k", d=10, h=20, d2=3))


if __name__ == "__main__":
    main()
