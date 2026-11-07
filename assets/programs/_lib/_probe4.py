"""Third probe: does `join` keep the first object's placement, and what does
`sweep` take for its path?

    conda run -n sand3d python assets/programs/_lib/_probe4.py
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
    s3d.export(obj, os.path.join(OUT, f"p4_{name}.glb"))
    doc = read_glb(os.path.join(OUT, f"p4_{name}.glb"))
    lo, hi = bounds(doc["json"])
    size = [round(hi[i] - lo[i], 4) for i in range(3)]
    print(f"{name:<30} size={size}  min={[round(v, 3) for v in lo]}  max={[round(v, 3) for v in hi]}")


def main():
    os.makedirs(OUT, exist_ok=True)

    def handle_shifted_join():
        bar = s3d.cylinder("bar", d=11, h=160)
        s3d.at(bar, ry=90, x=80)
        post = s3d.cylinder("post", d=7.7, h=20)
        posts = s3d.at(post, on=s3d.grid(2, 1, 149))
        return s3d.join(bar, *posts)

    def handle_transform():
        bar = s3d.cylinder("bar", d=11, h=160)
        s3d.at(bar, ry=90)
        s3d.transform(bar, x=80)
        return bar

    def handle_transform_join():
        bar = s3d.cylinder("bar", d=11, h=160)
        s3d.at(bar, ry=90)
        s3d.transform(bar, x=80)
        post = s3d.cylinder("post", d=7.7, h=20)
        posts = s3d.at(post, on=s3d.grid(2, 1, 149))
        return s3d.join(bar, *posts)

    def handle_anchor_bottom():
        bar = s3d.cylinder("bar", d=11, h=160)
        s3d.at(bar, ry=90, x=80, anchor="center")
        return bar

    def sweep_spine():
        sec = s3d.poly([(0, 0), (4.3, 0), (4.3, 3.2), (0, 3.2)])
        return s3d.sweep("spine", sec, [(0, -100, 1.6), (0, 100, 1.6)])

    measure("handle_shifted_join", handle_shifted_join)
    measure("handle_transform", handle_transform)
    measure("handle_transform_join", handle_transform_join)
    measure("handle_anchor_bottom", handle_anchor_bottom)
    try:
        measure("sweep_spine", sweep_spine)
    except Exception as exc:
        print("sweep_spine failed:", type(exc).__name__, exc)


if __name__ == "__main__":
    main()
