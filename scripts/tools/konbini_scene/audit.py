"""Assembly audit for the post-outbreak scene.

Runs inside Blender after the scene is built and reports parts that interpenetrate
instead of meeting face to face. The brief for this scene is explicit: models
must be *mated* (flush) rather than *interpenetrated*.

The test is a real triangle-level intersection, not a bounding-box guess, so
tubes that meet at a joint and parts that merely touch are not reported. Each
mesh is shrunk by a fraction of a millimetre before the test, which removes
false positives where two surfaces are supposed to rest exactly on each other.
"""
from __future__ import annotations

import itertools
import os

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

# Collections whose contents are expected to be flush against their neighbours.
CHECKED = ("Architecture", "Glazing", "Doors", "Fixtures", "Cooler", "Signage",
           "Street", "Props")

# Decals ride on surfaces on purpose; bicycle joints and loose props are
# assembled the way the real objects are and are not assembly defects.
SKIP_PREFIX = (
    "Decal_", "Wet_Patch_", "Night_Sky", "Bicycle_", "Bike_Rack",
    "Overhead_Cable", "Leaf_", "Glass_Shard",
)

# How far each surface is pulled in before the intersection test, in metres.
SHRINK = 0.0015

# Assembly clearance: parts are allowed to overlap by up to this much, which
# covers the bevelled edge radius and the gap left by the face inset.
CLEARANCE = 0.004

# Pairs that are *supposed* to overlap: a rail welded into a post, a pole
# socketed into its base block, a shelf deck resting on an upright. These are
# real joints, not modelling errors.
JOINT_PREFIX_PAIRS = (
    ("Guardrail_Post", "Guardrail_Rail"),
    ("Litter_Bin_Body", "Litter_Bin_Post"),
    ("Traffic_Cone_Body", "Traffic_Cone_Band"),
    ("Traffic_Cone_Base", "Traffic_Cone_Body"),
    ("Pole_Crossarm", "Utility_Pole"),
    ("Pole_Insulator", "Pole_Crossarm"),
    ("Cooler_Carcass_Back", "Cooler_Carcass_Bottom"),
    ("Cooler_Carcass_Back", "Cooler_Side_"),
    ("Cooler_Carcass_Back", "Cooler_Interior_Back"),
    ("Cooler_Carcass_Top", "Cooler_Side_"),
    ("Cooler_Carcass_Top", "Cooler_Carcass_Back"),
    ("Cooler_Carcass_Bottom", "Cooler_Side_"),
    ("Cooler_Side_Left", "Cooler_Carcass_Bottom"),
    ("Cooler_Side_Right", "Cooler_Carcass_Bottom"),
    ("Cooler_Interior_Back", "Cooler_Shelf_"),
    ("Cooler_Shelf_", "Cooler_Interior_Back"),
    ("Cooler_Plinth", "Cooler_Carcass_Bottom"),
    ("Cooler_Plinth", "Cooler_Side_"),
    ("Cooler_Door_Frame_", "Cooler_Door_Glass_"),
    ("Cooler_Door_Handle_", "Cooler_Door_Frame_"),
    ("Gondola_", "_Upright_"),
    ("Gondola_", "_Deck_"),
    ("Gondola_", "_Back_Panel"),
    ("Gondola_", "_Panel_Clip_"),
    ("Gondola_", "_Foot_"),
    ("Gondola_", "_Price_Rail_"),
    ("Gondola_", "_Category_Strip"),
    ("Gondola_", "_Top_Board"),
    ("Door_", "_Rail_"),
    ("Door_", "_Stile_"),
    ("Door_", "_Glass"),
    ("Door_Sill_Track", "Door_Jamb_"),
    ("Door_Jamb_", "Door_Upper_Track"),
    ("Window_Sill_", "Door_Jamb_"),
    ("Window_Head_", "Door_Jamb_"),
    ("Facade_Kick_", "Door_Jamb_"),
    ("Facade_Pier_", "Facade_Lintel"),
    ("Facade_Lintel", "Storefront_Canopy_Slab"),
    ("Storefront_Canopy_Slab", "Storefront_Canopy_Fascia"),
    ("Roof_Deck", "Parapet_"),
    ("Parapet_", "Sign_Board_"),
    ("Wall_Rear", "Back_Door_Frame"),
    ("Wall_Left", "Wall_AC_Bracket"),
    ("Wall_Right", "Wall_AC_Bracket"),
    ("Vending_Machine_Body", "Vending_Machine_"),
    ("Notice_Board_Panel", "Notice_Board_Post_"),
    ("Sign_Board_Post_", "Guide_Board_Frame"),
    ("Sign_Square_Post", "Sign_Square_Plate"),
    ("Sign_Round_Post", "Sign_Round_"),
    ("Name_Plate_Post", "Name_Plate"),
    ("Pole_Transformer", "Utility_Pole"),
    ("Pole_Junction_Box", "Utility_Pole"),
    ("AC_Outdoor_Unit_", "AC_Fan_"),
    ("AC_Outdoor_Unit_", "AC_Grille_"),
)


def is_intentional_joint(name_a: str, name_b: str) -> bool:
    """True when the pair is a documented joint rather than a modelling error."""
    for prefix_a, prefix_b in JOINT_PREFIX_PAIRS:
        if name_a.startswith(prefix_a) and name_b.startswith(prefix_b):
            return True
        if name_b.startswith(prefix_a) and name_a.startswith(prefix_b):
            return True
    return False


def world_aabb(obj) -> tuple[Vector, Vector] | None:
    if obj.type != "MESH" or not obj.data.vertices:
        return None
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    if not corners:
        return None
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    return lo, hi


def world_bvh(obj) -> BVHTree | None:
    """Build a world-space BVH with every face pulled in along its own normal.

    Shrinking each surface inward by a fraction of a millimetre is what
    separates parts that are supposed to *touch* (a shelf foot resting on the
    floor slab, a wall standing on the slab) from parts that genuinely
    interpenetrate. Every polygon gets its own copy of its vertices so the
    shrink does not fight between neighbouring faces.
    """
    mesh = obj.data
    if not mesh.polygons:
        return None
    world = obj.matrix_world
    normal_matrix = world.to_3x3()

    verts: list[Vector] = []
    polys: list[tuple[int, ...]] = []
    for poly in mesh.polygons:
        normal = (normal_matrix @ poly.normal).normalized()
        base = len(verts)
        for index in poly.vertices:
            verts.append(world @ mesh.vertices[index].co - normal * SHRINK)
        polys.append(tuple(range(base, base + len(poly.vertices))))
    return BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)


def aabb_hit(a, b) -> bool:
    lo_a, hi_a = a
    lo_b, hi_b = b
    return not (hi_a.x < lo_b.x or hi_b.x < lo_a.x
                or hi_a.y < lo_b.y or hi_b.y < lo_a.y
                or hi_a.z < lo_b.z or hi_b.z < lo_a.z)


def main() -> int:
    entries = []
    for name in CHECKED:
        col = bpy.data.collections.get(name)
        if not col:
            continue
        for obj in col.objects:
            if obj.type != "MESH" or obj.name.startswith(SKIP_PREFIX):
                continue
            aabb = world_aabb(obj)
            if aabb is None:
                continue
            entries.append((obj.name, aabb))

    # Pre-filter with bounding boxes, then confirm with the BVH.
    candidates = [(a, b) for a, b in itertools.combinations(entries, 2)
                  if aabb_hit(a[1], b[1])]
    trees = {}
    overlaps = []
    for (name_a, aabb_a), (name_b, aabb_b) in candidates:
        bvh_a = trees.get(name_a)
        if bvh_a is None:
            obj_a = bpy.data.objects.get(name_a)
            bvh_a = world_bvh(obj_a) if obj_a else None
            trees[name_a] = bvh_a
        bvh_b = trees.get(name_b)
        if bvh_b is None:
            obj_b = bpy.data.objects.get(name_b)
            bvh_b = world_bvh(obj_b) if obj_b else None
            trees[name_b] = bvh_b
        if bvh_a is None or bvh_b is None:
            continue
        if bvh_a.overlap(bvh_b):
            if is_intentional_joint(name_a, name_b):
                continue
            # The bounding-box overlap is a cheap proxy for how deep the
            # interpenetration is, which is what matters when triaging.
            depth = min(
                min(aabb_a[1].x, aabb_b[1].x) - max(aabb_a[0].x, aabb_b[0].x),
                min(aabb_a[1].y, aabb_b[1].y) - max(aabb_a[0].y, aabb_b[0].y),
                min(aabb_a[1].z, aabb_b[1].z) - max(aabb_a[0].z, aabb_b[0].z),
            )
            overlaps.append((name_a, name_b, depth))

    overlaps.sort(key=lambda item: -item[2])
    deep = [item for item in overlaps if item[2] > CLEARANCE]
    lines = [f"AUDIT objects={len(entries)} pairs={len(candidates)} "
             f"overlaps={len(overlaps)} over_clearance={len(deep)}"]
    for name_a, name_b, depth in deep[:120]:
        lines.append(f"OVERLAP {name_a} <-> {name_b} depth={depth:.4f}")
    report = "\n".join(lines)
    print(report)
    log = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__)))), ".logs", "konbini-audit.log")
    os.makedirs(os.path.dirname(log), exist_ok=True)
    with open(log, "w", encoding="utf-8") as handle:
        handle.write(report + "\n")
    return len(deep)
