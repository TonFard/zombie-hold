"""Second probe: how `at` composes rotation and translation, and how grid
places its copies.

    conda run -n sand3d python assets/programs/_lib/_probe3.py
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
    s3d.export(obj, os.path.join(OUT, f"p3_{name}.glb"))
    doc = read_glb(os.path.join(OUT, f"p3_{name}.glb"))
    lo, hi = bounds(doc["json"])
    size = [round(hi[i] - lo[i], 4) for i in range(3)]
    print(f"{name:<30} size={size}  min={[round(v, 3) for v in lo]}  max={[round(v, 3) for v in hi]}")


def main():
    os.makedirs(OUT, exist_ok=True)

    def bar_only():
        bar = s3d.cylinder("bar", d=11, h=160)
        s3d.at(bar, ry=90)
        return bar

    def bar_shifted():
        bar = s3d.cylinder("bar", d=11, h=160)
        s3d.at(bar, ry=90, x=80)
        return bar

    def bar_shifted_anchor():
        bar = s3d.cylinder("bar", d=11, h=160)
        s3d.at(bar, ry=90, x=80, anchor="center")
        return bar

    def posts_only():
        post = s3d.cylinder("post", d=7.7, h=20)
        return s3d.at(post, on=s3d.grid(2, 1, 149))[0]

    def handle_v2():
        bar = s3d.cylinder("bar", d=11, h=160)
        s3d.at(bar, ry=90, x=80, anchor="center")
        post = s3d.cylinder("post", d=7.7, h=20)
        posts = s3d.at(post, on=s3d.grid(2, 1, 149))
        return s3d.join(bar, *posts)

    def sweep_spine():
        # 半圆截面沿 Y 扫掠
        sec = s3d.poly([(0, 0), (4.3, 0), (4.3, 3.2), (0, 3.2)])
        path = s3d.path([(0, -100, 1.6), (0, 100, 1.6)])
        return s3d.sweep("spine", sec, path)

    measure("bar_only", bar_only)
    measure("bar_shifted", bar_shifted)
    measure("bar_shifted_anchor", bar_shifted_anchor)
    measure("posts_only", posts_only)
    measure("handle_v2", handle_v2)
    try:
        measure("sweep_spine", sweep_spine)
    except Exception as exc:
        print("sweep_spine failed:", exc)


if __name__ == "__main__":
    main()
