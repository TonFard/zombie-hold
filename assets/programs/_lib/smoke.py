"""Smoke test: build the three official sand3d examples and export them.

Run inside the sand3d conda environment:

    conda run -n sand3d python assets/programs/_lib/smoke.py

It proves the toolchain works end to end (program -> mesh -> GLB) before any
library atom is written, and it prints the unit, material and naming facts the
runtime loader depends on.
"""
from __future__ import annotations

import os
import sys

import bpy  # noqa: F401  (importing bpy is what makes the sand3d verbs work)
import sand3d as s3d

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "_out")
VENDOR = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".vendor", "sand3d"))


def bracket(w=80, d=40, t=6, hole_d=6.6, pitch=50):
    plate = s3d.extrude("plate", s3d.rect(w, d, r=4), t)
    s3d.hole(plate, hole_d, on=s3d.grid(2, 1, pitch, 0))
    s3d.fillet(plate, 1, edges="top")
    return plate


def rack(n=4, pitch=30, depth=40, t=5):
    base = s3d.extrude("base", s3d.rect(n * pitch, depth, r=3), t)
    pegs = s3d.at(s3d.cylinder("peg", 6, 20), on=s3d.grid(n, 1, pitch), z=t)
    hook = s3d.at(s3d.extrude("hook", s3d.rect(4, 12), 12), x=n * pitch / 2 - 4, z=t)
    image = s3d.transform(s3d.copy(hook), mirror="x")
    s3d.join(base, pegs, hook, image)
    s3d.hole(base, 4, on=s3d.grid(2, 1, (n - 1) * pitch).move(y=depth / 2 - 6))
    s3d.chamfer(base, 0.6, edges="peg")
    return base


def lamp(stem_h=300):
    base = s3d.revolve("base", [(0, 0), (70, 0), (60, 20), (0, 20)])
    stem = s3d.at(s3d.cylinder("stem", 12, stem_h), on=base.face("top"))
    lamp = s3d.assembly("lamp", base, stem, head=s3d.Frame((0, 0, 20 + stem_h)))
    shade = s3d.shell(s3d.cone("shade", 180, 120, d2=90), 1.5, open="top bottom")
    s3d.attach(lamp, "shade", s3d.at(shade, on=lamp.head))
    return lamp


def main():
    os.makedirs(OUT, exist_ok=True)
    s3d.empty_scene()
    obj = bracket()
    s3d.material(obj, "steel", color="#8a8f95")
    path = os.path.join(OUT, "smoke_bracket.glb")
    s3d.export(obj, path)
    print("exported", path, os.path.getsize(path), "bytes")

    for name, builder in (("rack", rack), ("lamp", lamp)):
        s3d.empty_scene()
        o = builder()
        p = os.path.join(OUT, f"smoke_{name}.glb")
        s3d.export(o, p)
        print("exported", p, os.path.getsize(p), "bytes")

    # facts the runtime loader relies on
    print("--- scene facts ---")
    print("unit system:", bpy.context.scene.unit_settings.system)
    print("scale length:", bpy.context.scene.unit_settings.scale_length)
    for ob in bpy.data.objects:
        if ob.type == "MESH":
            print("mesh:", ob.name, "verts", len(ob.data.vertices),
                  "mats", [m.name for m in ob.data.materials if m])


if __name__ == "__main__":
    sys.exit(main())
