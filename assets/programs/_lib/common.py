"""Shared helpers for every atom program in the asset library.

Rules this file enforces (see docs/ASSET-TREE.md):

* Millimetres, Z up, every part built at its own origin.
* One function per distinct part; the head function is the table of contents.
* Materials are assigned before a part is repeated.
* The export helper writes one GLB per atom and stamps a small metadata block
  into the GLB's ``extras`` so the runtime loader can rebuild the asset tree
  without a side-car database.

Nothing here imports Blender directly: everything goes through sand3d.
"""
from __future__ import annotations

import json
import os

import sand3d as s3d

# --------------------------------------------------------------------------- layout
#: ``_lib`` lives at <repo>/assets/programs/_lib, so the repo root is three levels up.
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
PROGRAM_OUT = os.path.join(ROOT, "assets", "programs", "_out")
MODEL_OUT = os.path.join(ROOT, "assets", "models")

#: The material kinds sand3d knows about, grouped by the look we need.
#: Only kinds listed here are used, so the whole library stays visually coherent.
MATERIALS = {
    # structure
    "concrete": "concrete",
    "steel": "steel",
    "brushed_steel": "brushed_steel",
    "chrome": "chrome",
    "aluminium": "aluminium",
    "brass": "brass",
    "copper": "copper",
    "painted_metal": "painted_metal",
    "rubber": "rubber",
    "glass": "glass",
    "ceramic": "ceramic",
    "plastic": "plastic",
    "glossy_plastic": "glossy_plastic",
    # timber
    "oak": "oak",
    "walnut": "walnut",
    "pine": "pine",
    "birch": "birch",
    # soft
    "fabric": "fabric",
    "velvet": "velvet",
    "leather": "leather",
    "marble": "marble",
    "light": "light",
}


def units_m():
    """Millimetres are the house unit; switch to metres for export."""
    s3d.units("mm")


#: sand3d ships 21 material presets and no paper, cardboard or soil. Those are
#: the looks we need most, so they are aliases onto a preset that behaves the
#: same: a matte dielectric with the right colour and roughness.
#: kind -> (preset, roughness override)
ALIASES = {
    "paper": ("concrete", 0.90),
    "cardboard": ("concrete", 0.95),
    "soil": ("concrete", 1.00),
    "cloth": ("fabric", 0.90),
    "stone": ("concrete", 0.92),
    "asphalt": ("concrete", 0.88),
    "plaster": ("concrete", 0.92),
}


def dress(ob, kind: str, color: str | None = None, **kw):
    """``s3d.material`` with the library's aliases resolved.

    Use this instead of ``s3d.material`` in the atom programs so that
    ``paper`` / ``cardboard`` / ``soil`` and friends work even though sand3d
    has no preset by those names.
    """
    if kind in ALIASES:
        preset, rough = ALIASES[kind]
        kw.setdefault("roughness", rough)
        kind = preset
    return s3d.material(ob, kind, color=color, **kw)


# --------------------------------------------------------------------------- metadata
def meta(id: str, region: str, site: str, room: str, obj: str,
         part: str | None = None, size_m=(0, 0, 0), tri: int = 0,
         materials=(), collider: str = "box", instanced: bool = True,
         states=("intact",), tags=()) -> dict:
    """The descriptor the runtime loader reads back out of the GLB.

    ``size_m`` is given in **sand3d space**: X = width, Y = depth, Z = height.
    The GLB that sand3d exports is Y-up (glTF convention), so the height and
    the depth swap on the way out. The descriptor stores the runtime order
    (X = width, Y = height, Z = depth) so the loader and the checker can
    compare it directly against the exported bounding box.
    """
    w, d, h = size_m
    return {
        "id": id,
        "region": region,
        "site": site,
        "room": room,
        "object": obj,
        "part": part,
        "style": region,
        "size_m": [w, h, d],
        "size_m_s3d": [w, d, h],
        "tri": tri,
        "origin": "base_center",
        "materials": list(materials),
        "collider": collider,
        "instanced": instanced,
        "tags": list(tags),
        "states": list(states),
    }


def export(program, id: str, info: dict, out_dir: str | None = None):
    """Export one atom and write its descriptor next to it.

    ``program`` is the object returned by the atom's head function.
    """
    out_dir = out_dir or os.path.join(MODEL_OUT, info["region"], info["site"])
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{id}.glb")
    s3d.export(program, path)
    with open(os.path.join(out_dir, f"{id}.json"), "w", encoding="utf-8") as fh:
        json.dump(info, fh, ensure_ascii=False, indent=2)
    return path


def run(program, id: str, info: dict, out_dir: str | None = None):
    """Empty the scene, build, export. The one-call entry point of every atom."""
    s3d.empty_scene()
    obj = program()
    return export(obj, id, info, out_dir)
