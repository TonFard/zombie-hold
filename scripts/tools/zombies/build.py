"""Build the game zombies: public/zombies/<id>.glb + public/zombies/manifest.json, previews in .logs/zombies/.

    blender -b --factory-startup --python scripts/tools/zombies/build.py -- [id or kind ...] [--no-render]

Source: the rigged, animated Tripo / Mixamo zombies of ../zombie-lab/anim (set ZOMBIE_LAB to move it).
Per game variant:

* keep only the clips the kind plays, drop the finger / end bones (their weights go to the hand, head, toe)
* shape the body (bloated belly, bulk) by moving vertices along their normals
* add the kind's gear as two extra skinned meshes: ``props`` (steel, wood ...) and ``glow`` (eyes, sacs, cores),
  both coloured by vertex colours
* three levels of detail of the body: nodes ``lod0`` ``lod1`` ``lod2``
* textures scaled down and written as WebP; animation channels cut to rotations + the hips' translation

The log goes to .logs/zombies/build.log (Blender's own stdout is often swallowed by the shell).
"""
from __future__ import annotations

import json
import math
import os
import random
import struct
import sys
import traceback

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
LAB = os.environ.get("ZOMBIE_LAB") or os.path.abspath(os.path.join(ROOT, "..", "zombie-lab"))
OUT = os.path.join(ROOT, "public", "zombies")
LOGS = os.path.join(ROOT, ".logs", "zombies")
P = "mixamorig:"
HIPS = P + "Hips"
LOD_TRIS = (11000, 3600, 1100)

STAND = ["zombie_idle", "zombie_punching", "zombie_reaction_hit", "zombie_death", "zombie_dying"]
KINDS = {
    "walker": dict(clips=STAND + ["zombie_run"], eyes=0xFFD060),
    "runner": dict(clips=STAND + ["zombie_run"], eyes=0xFF4030),
    "bloater": dict(clips=STAND + ["zombie_walk"], eyes=0xC8FF50),
    "breaker": dict(clips=STAND + ["zombie_run"], eyes=0xFF9030),
    "armored": dict(clips=STAND + ["zombie_walk"], eyes=0xFFC040),
    "spitter": dict(clips=STAND + ["zombie_run"], eyes=0xB8FF3A),
    "screamer": dict(clips=STAND + ["zombie_run", "zombie_scream"], eyes=0xFF3AF0),
    "crawler": dict(clips=["zombie_crawl"], eyes=0xFF6A20),
    "colossus": dict(clips=STAND + ["zombie_walk", "zombie_run", "zombie_scream"], eyes=0xFF2A1A),
}
# (id, kind, source model). ``eyes``: (height above the head joint, half distance) when the default misses
VARIANTS = [
    ("walker_a", "walker", "zombie_01"), ("walker_b", "walker", "zombie_03"), ("walker_c", "walker", "zombie_07"),
    ("walker_d", "walker", "zombie_10"), ("walker_e", "walker", "zombie_16"), ("walker_f", "walker", "zombie_19"),
    ("runner_a", "runner", "zombie_09"), ("runner_b", "runner", "zombie_18"), ("runner_c", "runner", "zombie_25"),
    ("bloater_a", "bloater", "zombie_13"), ("bloater_b", "bloater", "zombie_20"),
    ("breaker_a", "breaker", "zombie_12"), ("breaker_b", "breaker", "zombie_21"),
    ("armored_a", "armored", "zombie_14"), ("armored_b", "armored", "zombie_23"),
    ("spitter_a", "spitter", "zombie_02"), ("spitter_b", "spitter", "zombie_05"),
    ("screamer_a", "screamer", "zombie_11"), ("screamer_b", "screamer", "zombie_26"),
    ("crawler_a", "crawler", "zombie_15"), ("crawler_b", "crawler", "zombie_17"),
    ("colossus_a", "colossus", "zombie_08"),
]
# (fraction head joint -> crown, half distance[, sideways shift in metres, + = the zombie's left])
EYES: dict[str, tuple | None] = {
    "walker_a": (0.45, 0.031, 0.014), "walker_b": (0.55, 0.027), "walker_c": (0.47, 0.031, 0.03),
    "walker_d": (0.43, 0.029), "walker_f": (0.48, 0.031, 0.004),
    "runner_a": (0.78, 0.031, 0.012), "runner_b": (0.59, 0.031), "runner_c": (0.45, 0.031, 0.015),
    "screamer_a": (0.47, 0.031, -0.006), "screamer_b": (0.27, 0.031),
    "colossus_a": (0.14, 0.031), "bloater_b": (1.15, 0.031, 0.03),
}


def hexc(h: int):
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin((h >> 16) & 255), lin((h >> 8) & 255), lin(h & 255))


def to_bl(v) -> Vector:
    """Character frame (x left, y up, z forward) -> Blender (z up, facing -y)."""
    return Vector((v[0], -v[2], v[1]))


def from_bl(v) -> Vector:
    return Vector((v[0], v[2], -v[1]))


# --------------------------------------------------------------------------- gear
class Gear:
    """Solids in the character frame, each bound to one bone; ``glow`` solids are self-lit."""

    def __init__(self, arm, body):
        self.arm = arm
        me = body.data
        self.bvh = BVHTree.FromPolygons([v.co.copy() for v in me.vertices], [tuple(p.vertices) for p in me.polygons])
        self.parts = {"props": [], "glow": []}

    def J(self, bone: str) -> Vector:
        return from_bl(self.arm.matrix_world @ self.arm.data.bones[P + bone].head_local)

    def ray(self, origin, direction):
        """First hit of the body surface (character frame), or None."""
        hit = self.bvh.ray_cast(to_bl(origin), to_bl(direction).normalized())
        return from_bl(hit[0]) if hit[0] is not None else None

    def front(self, x: float, y: float, default: float = 0.12) -> float:
        h = self.ray((x, y, 1.5), (0, 0, -1))
        return h.z if h is not None else default

    def back(self, x: float, y: float, default: float = -0.12) -> float:
        h = self.ray((x, y, -1.5), (0, 0, 1))
        return h.z if h is not None else default

    def _add(self, bm, m: Matrix, bone: str, color: int, glow: bool, k: float = 1.0):
        bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
        for v in bm.verts:
            v.co = to_bl(v.co)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        c = tuple(min(1.0, x * k) for x in hexc(color))
        self.parts["glow" if glow else "props"].append(([v.co.copy() for v in bm.verts], [[v.index for v in f.verts] for f in bm.faces], c, P + bone))
        bm.free()

    @staticmethod
    def at(pos, rot=(0, 0, 0), scale=(1, 1, 1), aim=None) -> Matrix:
        """Placement: translate * (aim +Y at a direction | euler YXZ) * scale."""
        if aim is not None:
            r = Vector((0, 1, 0)).rotation_difference(Vector(aim).normalized()).to_matrix().to_4x4()
        else:
            r = Matrix.Rotation(rot[1], 4, "Y") @ Matrix.Rotation(rot[0], 4, "X") @ Matrix.Rotation(rot[2], 4, "Z")
        return Matrix.Translation(Vector(pos)) @ r @ Matrix.Diagonal((*scale, 1.0))

    def box(self, size, m, bone, color, glow=False, k=1.0):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
        self._add(bm, m, bone, color, glow, k)

    def sphere(self, r, m, bone, color, glow=False, seg=10, k=1.0):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(5, seg * 2 // 3), radius=r)
        self._add(bm, m, bone, color, glow, k)

    def cyl(self, r, length, m, bone, color, r2=None, seg=10, glow=False, k=1.0):
        """Along +Y, starting at the placement point."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=length)
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, "X"), verts=bm.verts)
        bmesh.ops.translate(bm, vec=Vector((0, length / 2, 0)), verts=bm.verts)
        self._add(bm, m, bone, color, glow, k)

    def rod(self, a, b, r, bone, color, seg=8):
        a, b = Vector(a), Vector(b)
        self.cyl(r, (b - a).length, self.at(a, aim=b - a), bone, color, seg=seg)

    def objects(self):
        out = []
        for name, parts in self.parts.items():
            if not parts:
                continue
            verts, faces, cols, groups = [], [], [], {}
            for vs, fs, c, bone in parts:
                base = len(verts)
                verts += vs
                faces += [[base + i for i in f] for f in fs]
                cols += [c] * len(fs)
                groups.setdefault(bone, []).extend(range(base, base + len(vs)))
            me = bpy.data.meshes.new(name)
            me.from_pydata(verts, [], faces)
            me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
            col = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
            for poly, c in zip(me.polygons, cols):
                for li in poly.loop_indices:
                    col.data[li].color = (*c, 1.0)
            me.color_attributes.active_color = col
            me.materials.append(gear_material(name))
            ob = bpy.data.objects.new(name, me)
            bpy.context.scene.collection.objects.link(ob)
            for bone, idx in groups.items():
                ob.vertex_groups.new(name=bone).add(idx, 1.0, "REPLACE")
            ob.parent = self.arm
            ob.modifiers.new("Armature", "ARMATURE").object = self.arm
            out.append(ob)
        return out


def gear_material(name: str):
    """White x vertex colour; the game swaps in its own shared materials by name."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    col = nt.nodes.new("ShaderNodeVertexColor")
    col.layer_name = "Col"
    nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
    if name == "glow":
        nt.links.new(col.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 3.0
        bsdf.inputs["Roughness"].default_value = 1.0
    else:
        bsdf.inputs["Roughness"].default_value = 0.55
        bsdf.inputs["Metallic"].default_value = 0.6
    return m


STEEL, DARK, RUST, BONE, WOOD, HAZARD = 0x5E6468, 0x2E3236, 0x5A3E2C, 0xCFCAB8, 0x4E3822, 0xA88420


def gear_eyes(g: Gear, vid: str, color: int, top: Vector):
    """Glowing eyes. ``EYES[id] = (fraction of the way from the head joint to the crown, half distance)``:
    following the head bone keeps them in the sockets when the head is tilted."""
    spec = EYES.get(vid, (0.38, 0.031))
    if spec is None:
        return
    h = g.J("Head")
    c = h + (top - h) * spec[0] + Vector((spec[2] if len(spec) > 2 else 0.0, 0, 0))
    # the head's own frame: up along the bone, sideways = the body's left made square to it (follows a tilted head;
    # the bone's own axes are not usable, they differ between the source rigs)
    up = (top - h).normalized()
    lat = Vector((1, 0, 0))
    lat = (lat - up * lat.dot(up)).normalized()
    fwd = lat.cross(up).normalized()
    if fwd.z < 0:
        fwd = -fwd
    for s in (-1, 1):
        p = c + lat * (s * spec[1])
        hit = g.ray(p + fwd * 0.6, -fwd)
        if hit is None:
            hit = Vector((p.x, p.y, g.front(p.x, p.y, h.z + 0.08)))
        g.sphere(0.0105, g.at(hit - fwd * 0.002, scale=(1.25, 0.8, 0.7)), "Head", color, glow=True, seg=8)


def gear_armored(g: Gear, rng):
    """A welded steel plate over the chest (the front takes 40 % damage), shoulder plates."""
    lo, hi = g.J("Spine").y + 0.02, g.J("Neck").y - 0.05
    cy, hgt = (lo + hi) / 2, hi - lo
    # the plate follows the chest: tilted to the line through the surface near its top and bottom
    zt = max(g.front(x, hi - 0.06) for x in (-0.05, 0, 0.05))
    zb = max(g.front(x, lo + 0.06) for x in (-0.05, 0, 0.05))
    tilt = max(-0.5, min(0.5, math.atan2(zt - zb, hgt - 0.12)))
    z = max((zt + zb) / 2, g.front(0, cy)) + 0.02
    M = g.at((0, cy, z), rot=(tilt, 0, 0))
    g.box((0.33, hgt, 0.028), M, "Spine2", STEEL)
    g.box((0.36, 0.04, 0.04), M @ g.at((0, hgt / 2 - 0.01, 0.004)), "Spine2", DARK)
    g.box((0.36, 0.035, 0.04), M @ g.at((0, -hgt / 2 + 0.01, 0.004)), "Spine2", DARK)
    g.box((0.15, 0.17, 0.02), M @ g.at((0.06, -0.06, 0.014), rot=(0, 0, 0.12)), "Spine2", RUST)
    g.box((0.3, 0.045, 0.006), M @ g.at((0, hgt * 0.24, 0.016)), "Spine2", HAZARD)
    for x, y in ((-0.14, hgt * 0.38), (0.14, hgt * 0.38), (-0.14, -hgt * 0.38), (0.14, -hgt * 0.38), (-0.08, 0.02)):
        g.cyl(0.012, 0.012, M @ g.at((x, y, 0.01), rot=(math.pi / 2, 0, 0)), "Spine2", 0xB0B0A8, seg=6)
    # straps round to the back
    for s in (-1, 1):
        for y in (cy + hgt * 0.3, cy - hgt * 0.3):
            zb = g.back(s * 0.1, y)
            g.box((0.03, 0.035, z - zb + 0.05), g.at((s * 0.19, y, (z + zb) / 2)), "Spine2", DARK)
        sh = g.J("LeftArm" if s > 0 else "RightArm")
        g.box((0.17, 0.035, 0.2), g.at((sh.x + s * 0.01, sh.y + 0.075, sh.z), rot=(0, 0, -s * 0.35)), "LeftShoulder" if s > 0 else "RightShoulder", STEEL if s > 0 else RUST)


def gear_breaker(g: Gear, rng):
    """Sledgehammer in the right hand, an air tank on the back."""
    h, e = g.J("RightHand"), g.J("RightForeArm")
    d = (h - e).normalized()
    u = (d * 0.8 + Vector((0, -0.25, -0.55))).normalized()  # shaft: down and back (dragged), swings with the arm
    grip = h + d * 0.07
    a, b = grip - u * 0.2, grip + u * 0.72
    g.rod(a, b, 0.019, "RightHand", WOOD)
    side = u.cross(Vector((1, 0, 0))).normalized()
    g.box((0.11, 0.12, 0.26), g.at(b, aim=u) @ Matrix.Rotation(0.0, 4, "Y"), "RightHand", DARK)
    g.box((0.12, 0.03, 0.28), g.at(b - u * 0.07, aim=u), "RightHand", STEEL)
    y = g.J("Spine2").y
    zb = g.back(0, y) - 0.085
    g.cyl(0.075, 0.42, g.at((0.0, y - 0.24, zb)), "Spine2", 0x7A6C2C, seg=12)
    g.sphere(0.075, g.at((0, y + 0.18, zb)), "Spine2", 0x7A6C2C)
    g.cyl(0.02, 0.07, g.at((0, y + 0.24, zb)), "Spine2", STEEL, seg=8)
    for yy in (y - 0.16, y + 0.1):
        g.box((0.19, 0.03, 0.1), g.at((0, yy, zb + 0.05)), "Spine2", DARK)
    _ = side


def gear_bloater(g: Gear, rng):
    """Pustules all over the belly: a dark swollen ring with a glowing core."""
    lo, hi = g.J("Hips").y - 0.02, g.J("Spine2").y + 0.02
    for _ in range(16):
        a = rng.uniform(-0.85, 0.85)
        y = rng.uniform(lo, hi)
        d = Vector((math.sin(a), 0, math.cos(a)))
        hit = g.ray(Vector((0, y, 0)) + d * 1.2, -d)
        if hit is None or abs(hit.x) > 0.26:
            continue
        r = rng.uniform(0.028, 0.055)
        bone = "Spine" if y < g.J("Spine1").y else "Spine1" if y < g.J("Spine2").y else "Spine2"
        g.sphere(r * 1.25, g.at(hit - d * r * 0.55, scale=(1, 0.85, 1)), bone, 0x6A7A42, seg=8)
        g.sphere(r * 0.8, g.at(hit + d * r * 0.1, scale=(1, 0.85, 1)), bone, 0xC8FF50, glow=True, seg=8)
    y = g.J("Spine2").y + 0.05
    g.sphere(0.11, g.at((0.08, y, g.back(0.08, y) + 0.04), scale=(1, 0.9, 0.7)), "Spine2", 0x4A5630)


def gear_spitter(g: Gear, rng):
    """A swollen glowing throat sac (shoot it: instant kill) and acid tumours on the back."""
    n = g.J("Neck")
    y = n.y - 0.015
    z = min(g.front(0, y, n.z + 0.05), n.z + 0.1)
    g.sphere(0.042, g.at((0, y, z + 0.012), scale=(1.2, 0.9, 0.85)), "Neck", 0x9AFF3A, glow=True, k=0.85)
    g.sphere(0.05, g.at((0, y - 0.008, z - 0.006), scale=(1.3, 0.95, 0.8)), "Neck", 0x55682A)
    top = g.J("Spine2").y
    for _ in range(5):
        x, yy = rng.uniform(-0.13, 0.13), top + rng.uniform(-0.12, 0.14)
        r = rng.uniform(0.035, 0.06)
        zb = g.back(x, yy)
        g.sphere(r * 1.2, g.at((x, yy, zb + r * 0.4)), "Spine2", 0x4A5A26, seg=8)
        g.sphere(r * 0.8, g.at((x, yy, zb - r * 0.15)), "Spine2", 0x7AD02A, glow=True, seg=8)


def gear_screamer(g: Gear, rng):
    """A stretched voice sac under the jaw."""
    n = g.J("Neck")
    y = n.y + 0.03
    z = g.front(0, y, n.z + 0.05)
    g.sphere(0.05, g.at((0, y, z - 0.005), scale=(1.3, 0.85, 0.8)), "Neck", 0x9A6A8A)
    for s in (-1, 1):
        g.sphere(0.014, g.at((s * 0.035, y + 0.01, z + 0.03)), "Neck", 0xFF3AF0, glow=True, seg=6)


def gear_colossus(g: Gear, rng):
    """Torn-open chest with a glowing core (weak spot after a charge), chains, spikes, an iron fist."""
    s1, s2, nk = g.J("Spine1"), g.J("Spine2"), g.J("Neck")
    cy = s1.y + (s2.y - s1.y) * 0.75
    z = g.front(0, cy) + 0.004
    g.sphere(0.12, g.at((0, cy, z - 0.008), scale=(0.9, 1.15, 0.14)), "Spine2", 0x3A0E0A, seg=14)
    g.sphere(0.05, g.at((0, cy + 0.01, z + 0.002), scale=(1, 1, 0.6)), "Spine2", 0xFF3322, glow=True)
    for i in range(4):
        for s in (-1, 1):
            yy = cy - 0.09 + i * 0.06
            g.rod((s * 0.015, yy, z + 0.02), (s * 0.12, yy + 0.02, g.front(s * 0.12, yy + 0.02) + 0.008), 0.009, "Spine2", BONE, seg=6)
    # chain across the chest, shoulder to hip
    a, b = Vector((0.16, nk.y - 0.08, 0)), Vector((-0.15, s1.y - 0.1, 0))
    for i in range(11):
        p = a.lerp(b, i / 10)
        zz = g.front(p.x, p.y) + 0.014
        g.box((0.05, 0.022, 0.03) if i % 2 else (0.05, 0.03, 0.022), g.at((p.x, p.y, zz), rot=(0, 0, 0.75)), "Spine2" if p.y > s2.y - 0.05 else "Spine1", STEEL if i % 3 else RUST)
    # spine spikes
    for i in range(5):
        y = s1.y - 0.02 + i * 0.085
        g.cyl(0.028, 0.17 - i * 0.012, g.at((0, y, g.back(0, y) + 0.02), aim=(0, 0.55, -1)), "Spine2" if y > s2.y else "Spine1", BONE, r2=0.0, seg=6)
    for s, bone, arm in ((1, "LeftShoulder", "LeftArm"), (-1, "RightShoulder", "RightArm")):
        sh = g.J(arm)
        g.cyl(0.045, 0.2, g.at((sh.x, sh.y + 0.03, sh.z), aim=(s * 0.5, 1, 0)), bone, DARK, r2=0.0, seg=7)
        g.cyl(0.03, 0.12, g.at((sh.x - s * 0.06, sh.y + 0.04, sh.z + 0.03), aim=(s * 0.1, 1, 0.3)), bone, STEEL, r2=0.0, seg=6)
    # iron gauntlet on the right fist, a broken shackle
    h, e = g.J("RightHand"), g.J("RightForeArm")
    d = (h - e).normalized()
    c = h + d * 0.07
    g.box((0.14, 0.17, 0.15), g.at(c, aim=d), "RightHand", DARK)
    g.box((0.15, 0.04, 0.16), g.at(c - d * 0.06, aim=d), "RightHand", STEEL)
    for i in (-1, 0, 1):
        g.cyl(0.02, 0.06, g.at(c + d * 0.08 + Vector((i * 0.045, 0, 0)), aim=d), "RightHand", STEEL, r2=0.0, seg=5)
    g.cyl(0.055, 0.04, g.at(h - d * 0.07, aim=d), "RightHand", RUST, seg=10)
    for i in range(3):
        g.box((0.03, 0.045, 0.018) if i % 2 else (0.018, 0.045, 0.03), g.at(h - d * 0.05 + Vector((0.06, -0.03 - i * 0.04, 0))), "RightHand", STEEL)


GEAR = {"armored": gear_armored, "breaker": gear_breaker, "bloater": gear_bloater, "spitter": gear_spitter, "screamer": gear_screamer, "colossus": gear_colossus}

# body shaping: (bones, metres along the normal, extra factor for normals facing forward)
SHAPE = {
    "bloater": [(("Spine", "Spine1", "Hips"), 0.03, 3.0), (("Spine2",), 0.02, 1.0)],
    "colossus": [(("Spine2", "Spine1", "LeftShoulder", "RightShoulder"), 0.025, 0.3)],
}


# --------------------------------------------------------------------------- model
def is_cut_bone(name: str) -> str | None:
    """Bones the game drops -> the bone that takes their weights."""
    n = name[len(P):]
    for f in ("HandThumb", "HandIndex", "HandMiddle", "HandRing", "HandPinky"):
        if f in n:
            return P + n[: n.index("Hand")] + "Hand"
    if n == "HeadTop_End":
        return P + "Head"
    if n.endswith("Toe_End"):
        return P + n.replace("Toe_End", "ToeBase")
    return None


def cut_bones(arm, body) -> int:
    names = {vg.index: vg.name for vg in body.vertex_groups}
    target = {i: is_cut_bone(n) for i, n in names.items()}
    add: dict[str, dict[int, float]] = {}
    for v in body.data.vertices:
        for ge in v.groups:
            t = target.get(ge.group)
            if t and ge.weight > 0:
                d = add.setdefault(t, {})
                d[v.index] = d.get(v.index, 0.0) + ge.weight
    for t, ws in add.items():
        vg = body.vertex_groups.get(t) or body.vertex_groups.new(name=t)
        for i, w in ws.items():
            vg.add([i], w, "ADD")
    for i, t in target.items():
        if t:
            body.vertex_groups.remove(body.vertex_groups[names[i]])
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    n = 0
    for eb in list(arm.data.edit_bones):
        if is_cut_bone(eb.name):
            arm.data.edit_bones.remove(eb)
            n += 1
    bpy.ops.object.mode_set(mode="OBJECT")
    return n


def weld(body) -> None:
    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(me)
    bm.free()
    for name in ("custom_normal", "sharp_edge", "sharp_face"):
        a = me.attributes.get(name)
        if a:
            me.attributes.remove(a)
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))


def shape(body, arm, spec) -> None:
    """Push the vertices of some bones away from the body's vertical axis. The push depends on the
    position only (not on the vertex normals), so layered clothes move together instead of tearing."""
    me = body.data
    idx = {vg.name: vg.index for vg in body.vertex_groups}
    axis = arm.matrix_world @ arm.data.bones[HIPS].head_local
    for bones, amount, fwd in spec:
        ids = {idx[P + b] for b in bones if P + b in idx}
        for v in me.vertices:
            w = sum(ge.weight for ge in v.groups if ge.group in ids)
            if w <= 0:
                continue
            d = Vector((v.co.x - axis.x, v.co.y - axis.y, 0.0))
            if d.length < 1e-4:
                continue
            d.normalize()
            v.co += d * (amount * w * (1.0 + fwd * max(0.0, -d.y)))
    me.update()


def tris(ob) -> int:
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def lod(body, arm, target: int, name: str):
    ob = body.copy()
    ob.data = body.data.copy()
    bpy.context.scene.collection.objects.link(ob)
    ob.name = name
    ob.data.name = name
    n = tris(ob)
    if n > target:
        for m in list(ob.modifiers):
            ob.modifiers.remove(m)
        md = ob.modifiers.new("dec", "DECIMATE")
        md.decimate_type = "COLLAPSE"
        md.ratio = target / n
        md.use_collapse_triangulate = True
        with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
            bpy.ops.object.modifier_apply(modifier=md.name)
        ob.data.polygons.foreach_set("use_smooth", [True] * len(ob.data.polygons))
        ob.modifiers.new("Armature", "ARMATURE").object = arm
    return ob


def set_action(arm, act) -> None:
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = act
    if hasattr(ad, "action_slot") and getattr(act, "slots", None) and len(act.slots):
        ad.action_slot = act.slots[0]


def measure(arm, act) -> dict:
    """Clip length, mean head centre (height, forward) and when the hands reach furthest forward (0-1)."""
    scn = bpy.context.scene
    set_action(arm, act)
    f0, f1 = (int(round(v)) for v in act.frame_range)
    W = arm.matrix_world
    head = arm.pose.bones[P + "Head"]
    hands = [arm.pose.bones[P + s + "Hand"] for s in ("Left", "Right")]
    ys, zs, best, best_f = [], [], -1e9, f0
    for f in range(f0, f1 + 1, 2):
        scn.frame_set(f)
        c = from_bl(W @ (head.head + head.y_axis * 0.1))
        ys.append(c.y)
        zs.append(c.z)
        reach = max(from_bl(W @ h.head).z for h in hands)
        if reach > best:
            best, best_f = reach, f
    return dict(dur=round((f1 - f0) / scn.render.fps, 3), head=[round(sum(ys) / len(ys), 3), round(sum(zs) / len(zs), 3)],
                headMin=round(min(ys), 3), impact=round((best_f - f0) / max(1, f1 - f0), 3))


def strip_glb(path: str) -> None:
    """Keep rotation channels and the hips' translation; drop what nothing references any more."""
    with open(path, "rb") as f:
        data = f.read()
    jlen = struct.unpack_from("<I", data, 12)[0]
    j = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blob = data[off + 8: off + 8 + struct.unpack_from("<I", data, off)[0]]
    hips = next(i for i, n in enumerate(j["nodes"]) if n.get("name") == HIPS)
    for a in j.get("animations", []):
        ch = [c for c in a["channels"] if c["target"]["path"] == "rotation" or (c["target"]["path"] == "translation" and c["target"]["node"] == hips)]
        used = sorted({c["sampler"] for c in ch})
        remap = {s: i for i, s in enumerate(used)}
        a["samplers"] = [a["samplers"][s] for s in used]
        for c in ch:
            c["sampler"] = remap[c["sampler"]]
        a["channels"] = ch
    acc = set()
    for m in j["meshes"]:
        for p in m["primitives"]:
            acc.update(p["attributes"].values())
            if "indices" in p:
                acc.add(p["indices"])
    for s in j.get("skins", []):
        if "inverseBindMatrices" in s:
            acc.add(s["inverseBindMatrices"])
    for a in j.get("animations", []):
        for s in a["samplers"]:
            acc.update((s["input"], s["output"]))
    amap = {old: new for new, old in enumerate(sorted(acc))}
    for m in j["meshes"]:
        for p in m["primitives"]:
            p["attributes"] = {k: amap[v] for k, v in p["attributes"].items()}
            if "indices" in p:
                p["indices"] = amap[p["indices"]]
    for s in j.get("skins", []):
        if "inverseBindMatrices" in s:
            s["inverseBindMatrices"] = amap[s["inverseBindMatrices"]]
    for a in j.get("animations", []):
        for s in a["samplers"]:
            s["input"], s["output"] = amap[s["input"]], amap[s["output"]]
    j["accessors"] = [j["accessors"][i] for i in sorted(acc)]
    views = sorted({a["bufferView"] for a in j["accessors"] if "bufferView" in a} | {im["bufferView"] for im in j.get("images", []) if "bufferView" in im})
    vmap = {old: new for new, old in enumerate(views)}
    out = bytearray()
    new_views = []
    for i in views:
        v = dict(j["bufferViews"][i])
        while len(out) % 4:
            out.append(0)
        start = v.get("byteOffset", 0)
        v["byteOffset"] = len(out)
        out += blob[start:start + v["byteLength"]]
        new_views.append(v)
    while len(out) % 4:
        out.append(0)
    j["bufferViews"] = new_views
    for a in j["accessors"]:
        if "bufferView" in a:
            a["bufferView"] = vmap[a["bufferView"]]
    for im in j.get("images", []):
        if "bufferView" in im:
            im["bufferView"] = vmap[im["bufferView"]]
    j["buffers"] = [dict(byteLength=len(out))]
    js = json.dumps(j, separators=(",", ":")).encode("utf8")
    js += b" " * (-len(js) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(out), 0x004E4942) + bytes(out))


def studio(scene) -> None:
    for name, loc, energy, size, color in (
        ("key", (1.6, -2.6, 2.6), 420, 2.0, (1.0, 0.95, 0.88)),
        ("fill", (-2.4, -1.6, 1.2), 150, 2.5, (0.75, 0.85, 1.0)),
        ("rim", (-1.0, 2.6, 2.2), 300, 1.5, (0.8, 0.9, 1.0)),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.size, data.color = energy, size, color
        ob = bpy.data.objects.new(name, data)
        ob.location = loc
        ob.rotation_euler = (Vector((0, 0, 0.9)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(ob)
    world = bpy.data.worlds.new("studio")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.2, 0.22, 0.25, 1)
    bg.inputs["Strength"].default_value = 0.8
    scene.world = world
    engines = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    for e in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if e in engines:
            scene.render.engine = e
            break
    try:
        scene.eevee.taa_render_samples = 24
        scene.view_settings.view_transform = "Standard"
    except Exception:
        pass
    scene.render.image_settings.file_format = "PNG"
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 70
    scene.collection.objects.link(cam)
    scene.camera = cam


def shoot(scene, path: str, eye, target, w=640, h=900) -> None:
    cam = scene.camera
    cam.location = to_bl(eye)
    cam.rotation_euler = (to_bl(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def build_one(vid: str, kind: str, src: str, render: bool, speeds: dict, log) -> dict:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    # before the import: the importer turns clip times into frames at the scene's rate
    scn.render.fps = 30
    scn.render.fps_base = 1.0
    bpy.ops.import_scene.gltf(filepath=os.path.join(LAB, "anim", f"{src}.glb"))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    for o in [o for o in bpy.data.objects if o.type == "MESH" and len(o.data.vertices) < 200]:
        bpy.data.objects.remove(o, do_unlink=True)
    body = next(o for o in bpy.data.objects if o.type == "MESH")
    scn.render.fps = 30
    cfg = KINDS[kind]
    # clips
    ad = arm.animation_data
    if ad:
        for t in list(ad.nla_tracks):
            ad.nla_tracks.remove(t)
        ad.action = None
    for a in list(bpy.data.actions):
        if a.name in cfg["clips"]:
            a.use_fake_user = True
        else:
            bpy.data.actions.remove(a)
    missing = [c for c in cfg["clips"] if c not in bpy.data.actions]
    if missing:
        raise RuntimeError(f"missing clips {missing}")
    for pb in arm.pose.bones:
        pb.custom_shape = None
    arm.data.pose_position = "REST"
    weld(body)
    head_top = from_bl(arm.matrix_world @ arm.data.bones[P + "HeadTop_End"].head_local)
    cut = cut_bones(arm, body)
    if kind in SHAPE:
        shape(body, arm, SHAPE[kind])
    # textures: base colour / normal 1024, roughness-metal 512
    for img in bpy.data.images:
        if img.size[0] > 0:
            n = 512 if img.name.endswith("_rm") or "rough" in img.name.lower() else 1024
            if img.size[0] > n:
                img.scale(n, n)
    for m in body.data.materials:
        m.name = "body"
        m.use_backface_culling = True
    body.name = "src"
    lods = [lod(body, arm, t, f"lod{i}") for i, t in enumerate(LOD_TRIS)]
    bpy.data.objects.remove(body, do_unlink=True)
    gear = Gear(arm, lods[0])
    rng = random.Random(sum(map(ord, vid)))
    if kind in GEAR:
        GEAR[kind](gear, rng)
    gear_eyes(gear, vid, cfg["eyes"], head_top)
    extra = gear.objects()
    if render:
        studio(scn)
        for o in lods[1:]:
            o.hide_render = True
        hd = gear.J("Head")
        shoot(scn, os.path.join(LOGS, f"{vid}_q.png"), (1.5, 1.25, 3.4), (0, 0.9, 0))
        shoot(scn, os.path.join(LOGS, f"{vid}_back.png"), (-1.6, 1.3, -3.3), (0, 0.9, 0))
        shoot(scn, os.path.join(LOGS, f"{vid}_face.png"), (0.12, hd.y + 0.12, 1.0), (0, hd.y + 0.08, 0), 560, 560)
        for o in lods:
            o.hide_render = False
    arm.data.pose_position = "POSE"
    clips = {}
    for name in cfg["clips"]:
        clips[name] = measure(arm, bpy.data.actions[name])
        if name in speeds:
            clips[name]["speed"] = speeds[name]
    set_action(arm, bpy.data.actions[cfg["clips"][0]])
    scn.frame_set(1)
    path = os.path.join(OUT, f"{vid}.glb")
    keep = lods + extra + [arm]
    for o in bpy.context.view_layer.objects:
        o.select_set(o in keep)
    bpy.context.view_layer.objects.active = arm
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_skins=True, export_animations=True,
              export_animation_mode="ACTIONS", export_force_sampling=True, export_def_bones=False, export_materials="EXPORT",
              export_image_format="WEBP", export_image_quality=82, export_extras=False, export_cameras=False, export_lights=False)
    for more in (dict(export_vertex_color="MATERIAL", export_optimize_animation_size=True), dict(export_optimize_animation_size=True), {}):
        try:
            bpy.ops.export_scene.gltf(**kw, **more)
            break
        except TypeError:
            continue
    raw = os.path.getsize(path)
    strip_glb(path)
    kb = os.path.getsize(path) // 1024
    counts = [tris(o) for o in lods]
    log(f"{vid} ({src}): {cut} bones cut, lods {counts}, gear {[tris(o) for o in extra]}, {raw // 1024} -> {kb} kB; "
        + ", ".join(f"{k.replace('zombie_', '')} {v['dur']}s head {v['head']} min {v['headMin']} hit {v['impact']}" for k, v in clips.items()))
    return dict(id=vid, kind=kind, file=f"{vid}.glb", tris=counts, kb=kb, clips={k.replace("zombie_", ""): v for k, v in clips.items()})


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(LOGS, exist_ok=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    render = "--no-render" not in argv
    want = [a for a in argv if not a.startswith("--")]
    todo = [v for v in VARIANTS if not want or v[0] in want or v[1] in want]
    with open(os.path.join(LAB, "anim", "index.json"), encoding="utf8") as f:
        speeds = {m["name"]: m["speeds"] for m in json.load(f)["models"]}
    path = os.path.join(OUT, "manifest.json")
    old = {}
    if os.path.exists(path):
        with open(path, encoding="utf8") as f:
            old = {v["id"]: v for v in json.load(f).get("variants", [])}
    with open(os.path.join(LOGS, "build.log"), "w", encoding="utf8") as lf:
        def log(msg: str) -> None:
            lf.write(msg + "\n")
            lf.flush()
            print(msg, flush=True)
        ok = True
        for vid, kind, src in todo:
            try:
                old[vid] = build_one(vid, kind, src, render, speeds.get(src, {}), log)
            except Exception:
                ok = False
                log(f"{vid}: FAILED\n{traceback.format_exc()}")
        order = [v[0] for v in VARIANTS]
        variants = [old[i] for i in order if i in old and os.path.exists(os.path.join(OUT, old[i]["file"]))]
        with open(path, "w", encoding="utf8") as f:
            json.dump(dict(height=1.75, variants=variants), f, ensure_ascii=False, indent=1)
        log(f"total {sum(v['kb'] for v in variants) / 1024:.1f} MB in {len(variants)} files")
        log("BUILD_OK" if ok else "BUILD_FAILED")


main()
