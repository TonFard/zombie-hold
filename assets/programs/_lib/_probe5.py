"""Fifth probe: the two constructions the atom library still needs.

    conda run -n sand3d python assets/programs/_lib/_probe5.py

* a bar along X built from ``box`` (no rotation, so ``join`` cannot shift it);
* a book spine swept as a half-round along the hinge;
* what ``arc`` gives when extruded.
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
    s3d.export(obj, os.path.join(OUT, f"p5_{name}.glb"))
    doc = read_glb(os.path.join(OUT, f"p5_{name}.glb"))
    lo, hi = bounds(doc["json"])
    size = [round(hi[i] - lo[i], 4) for i in range(3)]
    print(f"{name:<30} size={size}  min={[round(v, 3) for v in lo]}  max={[round(v, 3) for v in hi]}")


def main():
    os.makedirs(OUT, exist_ok=True)

    def bar_box():
        bar = s3d.box("bar", 160, 11, 11)
        s3d.at(bar, z=22)
        post = s3d.cylinder("post", d=7.7, h=20)
        posts = s3d.at(post, on=s3d.grid(2, 1, 149))
        return s3d.join(posts[0], posts[1], bar)

    def arc_extrude():
        return s3d.extrude("arc", s3d.arc(center=(0, 0), r=6, start=0, end=180), 206)

    def spine_half():
        # 半圆截面沿书脊方向（Z）拉伸，再转到 Y
        sec = s3d.poly([(0, 0), (4.3, 0), (0, 4.3)])
        obj = s3d.extrude("spine", sec, 206)
        s3d.at(obj, rx=90)
        return obj

    def spine_arc():
        obj = s3d.extrude("spine", s3d.arc(center=(0, 0), r=6, start=90, end=270), 206)
        s3d.at(obj, rx=90)
        return obj

    measure("bar_box", bar_box)
    try:
        measure("arc_extrude", arc_extrude)
    except Exception as exc:
        print("arc_extrude failed:", type(exc).__name__, exc)
    measure("spine_half", spine_half)
    try:
        measure("spine_arc", spine_arc)
    except Exception as exc:
        print("spine_arc failed:", type(exc).__name__, exc)


if __name__ == "__main__":
    main()
