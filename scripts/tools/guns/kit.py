"""Gun modelling kit (Blender, headless).

Every gun is authored in the game's weapon frame, the same one ``src/render/weapons`` uses:

* origin at the rear grip (right hand), metres
* ``+Z`` towards the muzzle, ``+Y`` up, ``+X`` to the shooter's left (the side the player sees)

The helpers take coordinates in that frame and bake them into Blender's Z-up space
(``(x, y, z) -> (x, -z, y)``), so the glTF exporter (Y-up) writes the weapon frame back out unchanged.

A gun is a set of small solids. Each one gets a bevel (so edges catch the light) and smooth shading
with weighted normals. On export the solids are joined per (moving part, tier range):

* node ``<part>__<lo>_<hi>``: shown when ``lo <= tier <= hi``; ``part`` is ``body`` or a moving part
  (``slide`` ``mag`` ``pump`` ``bolt`` ``drum`` ``belt``), whose node origin is the part's pivot
* worn edges are baked into vertex colours (convex edges lighter, creases darker)
"""
from __future__ import annotations

import math
from contextlib import contextmanager

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

MAX_TIER = 8
PARTS = ("body", "slide", "mag", "pump", "bolt", "drum", "belt")


def to_bl(v) -> Vector:
    """Weapon frame -> Blender frame (a proper rotation, so face winding is kept)."""
    return Vector((v[0], -v[2], v[1]))


# --------------------------------------------------------------------------- materials
_mats: dict[str, bpy.types.Material] = {}


def _mat(name: str, color, rough: float, metal: float, emit=None, strength: float = 0.0, wear: float = 1.0):
    """Principled material. ``wear`` > 0: the base colour is multiplied by the baked edge-wear vertex colour."""
    m = _mats.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    if wear > 0:
        # base colour x vertex colour: the pattern the glTF exporter writes as COLOR_0
        col = nt.nodes.new("ShaderNodeVertexColor")
        col.layer_name = "Col"
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs["A"].default_value = (*color, 1.0)
        nt.links.new(col.outputs["Color"], mix.inputs["B"])
        nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    m["wear"] = wear
    m.diffuse_color = (*color, 1.0)
    _mats[name] = m
    return m


def hexc(h: int):
    """sRGB hex -> linear RGB."""
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin((h >> 16) & 255), lin((h >> 8) & 255), lin(h & 255))


class M:
    """Material library. Colours are a little lighter than the target: flat faces are multiplied by
    the wear colour (about 0.75), only the worn edges reach the full value."""

    @staticmethod
    # Metalness is kept well below 1: the game is lit by a dim dusk / night environment, and a fully
    # metallic dark surface has almost nothing to reflect there, so the whole gun turns into a black blob.
    def gunmetal(): return _mat("gunmetal", hexc(0x5a6068), 0.5, 0.55)       # parkerised steel: receivers, slides
    @staticmethod
    def blued(): return _mat("blued", hexc(0x3c4149), 0.4, 0.65)             # barrels, bolts
    @staticmethod
    def steel(): return _mat("steel", hexc(0xa4a9b0), 0.34, 0.85)            # pins, triggers, bright parts
    @staticmethod
    def anodized(): return _mat("anodized", hexc(0x474b52), 0.58, 0.4)       # aluminium: handguards, rails, scope tubes
    @staticmethod
    def polymer(): return _mat("polymer", hexc(0x3a3c40), 0.66, 0.0)         # grips, stocks, magazines
    @staticmethod
    def rubber(): return _mat("rubber", hexc(0x242526), 0.88, 0.0, wear=0.4)
    @staticmethod
    def tan(): return _mat("tan", hexc(0x8a7350), 0.66, 0.0)                 # FDE furniture
    @staticmethod
    def olive(): return _mat("olive", hexc(0x4f5638), 0.66, 0.0)
    @staticmethod
    def wood(): return _mat("wood", hexc(0x6a3f1e), 0.5, 0.0, wear=0.6)
    @staticmethod
    def brass(): return _mat("brass", hexc(0xc79a45), 0.3, 1.0, wear=0.5)
    @staticmethod
    def copper(): return _mat("copper", hexc(0xb06a3a), 0.35, 1.0, wear=0.5)
    @staticmethod
    def red(): return _mat("red", hexc(0xb8341e), 0.5, 0.0, wear=0.5)        # shells, selector marks
    @staticmethod
    def orange(): return _mat("orange", hexc(0xe07a1a), 0.5, 0.0, wear=0.5)
    @staticmethod
    def yellow(): return _mat("yellow", hexc(0xe0b820), 0.5, 0.0, wear=0.5)
    @staticmethod
    def hole(): return _mat("hole", (0.002, 0.002, 0.002), 0.9, 0.0, wear=0)  # bores, slots
    @staticmethod
    def lens(): return _mat("lens", hexc(0x0c1826), 0.04, 1.0, emit=hexc(0x2a5aa0), strength=0.06, wear=0)

    @staticmethod
    def glow(h: int, k: float = 2.0):
        """Self-lit part (sight dots, tritium, indicator lights). Not shaded: reads the same day and night."""
        return _mat(f"glow_{h:06x}_{k:g}", (0, 0, 0), 1.0, 0.0, emit=hexc(h), strength=k, wear=0)


# --------------------------------------------------------------------------- gun
class Gun:
    def __init__(self, kind: str):
        self.kind = kind
        self.col = bpy.data.collections.new(f"gun_{kind}")
        bpy.context.scene.collection.children.link(self.col)
        self.objs: list[bpy.types.Object] = []
        self.cutters: list[bpy.types.Object] = []
        self.pivots: dict[str, tuple] = {}
        self._tier = (0, MAX_TIER)
        self._part = "body"
        self._n = 0

    # ---- context ----
    @contextmanager
    def tier(self, lo: int, hi: int = MAX_TIER):
        """Solids added inside are only shown for ``lo <= tier <= hi``."""
        old = self._tier
        self._tier = (max(lo, old[0]), min(hi, old[1]))
        try:
            yield
        finally:
            self._tier = old

    @contextmanager
    def part(self, name: str, pivot=(0.0, 0.0, 0.0)):
        """Solids added inside belong to a moving part; coordinates stay in the gun frame."""
        assert name in PARTS, name
        self.pivots.setdefault(name, tuple(pivot))
        old = self._part
        self._part = name
        try:
            yield
        finally:
            self._part = old

    # ---- plumbing ----
    def _finish(self, bm, mat, at, rot, bevel, seg, cut, smooth=True):
        """Bake rotation / translation (weapon frame) into the vertices and make the object."""
        if rot != (0, 0, 0):
            # same convention as three.js 'YXZ': Ry * Rx * Rz
            r = Matrix.Rotation(rot[1], 4, "Y") @ Matrix.Rotation(rot[0], 4, "X") @ Matrix.Rotation(rot[2], 4, "Z")
            bmesh.ops.transform(bm, matrix=r, verts=bm.verts)
        bmesh.ops.translate(bm, vec=Vector(at), verts=bm.verts)
        for v in bm.verts:
            v.co = to_bl(v.co)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        self._n += 1
        me = bpy.data.meshes.new(f"{self.kind}_{self._n}")
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(me.name, me)
        self.col.objects.link(ob)
        if cut is not None:
            ob.hide_render = True
            ob.display_type = "WIRE"
            self.cutters.append(ob)
            for target in cut if isinstance(cut, (list, tuple)) else [cut]:
                mod = target.modifiers.new("cut", "BOOLEAN")
                mod.operation = "DIFFERENCE"
                mod.object = ob
                mod.solver = "EXACT"
                # booleans go before the bevel: the cut edges get bevelled too
                target.modifiers.move(len(target.modifiers) - 1, 0)
            return ob
        me.materials.append(mat)
        if smooth:
            me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        if bevel > 0:
            mod = ob.modifiers.new("bevel", "BEVEL")
            mod.width = bevel
            mod.segments = seg
            mod.limit_method = "ANGLE"
            mod.angle_limit = math.radians(38)
            mod.harden_normals = False
        wn = ob.modifiers.new("wn", "WEIGHTED_NORMAL")
        wn.keep_sharp = False
        ob["tier"] = self._tier
        ob["part"] = self._part
        self.objs.append(ob)
        return ob

    # ---- solids (weapon frame) ----
    def box(self, size, at, mat=None, bevel=0.0015, rot=(0, 0, 0), seg=2, cut=None):
        """Box ``size = (x, y, z)`` centred on ``at``."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
        return self._finish(bm, mat, at, rot, bevel, seg, cut)

    def prof(self, pts, width, mat=None, bevel=0.002, x=0.0, seg=2, cut=None, at=(0, 0, 0), rot=(0, 0, 0)):
        """Side profile extruded across X. ``pts``: ``(z, y)`` corners; ``(cz, cy, z, y)`` = quadratic curve to (z, y)."""
        ring = _outline(pts)
        bm = bmesh.new()
        vs = [bm.verts.new((-width / 2, y, z)) for z, y in ring]
        f = bm.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        bmesh.ops.translate(bm, vec=Vector((width, 0, 0)), verts=[e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)])
        return self._finish(bm, mat, (at[0] + x, at[1], at[2]), rot, bevel, seg, cut)

    def cyl(self, r, length, at, mat=None, r2=None, seg=24, bevel=0.0008, axis="z", rot=(0, 0, 0), cut=None, bseg=2):
        """Cylinder / cone starting at ``at`` and running ``length`` along ``axis`` (``x`` ``y`` ``z``)."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=length)
        bmesh.ops.translate(bm, vec=Vector((0, 0, length / 2)), verts=bm.verts)
        _aim(bm, axis)
        return self._finish(bm, mat, at, rot, bevel, bseg, cut)

    def lathe(self, profile, at, mat=None, seg=28, bevel=0.0006, axis="z", rot=(0, 0, 0), cut=None, closed=False):
        """Solid of revolution about ``axis``. ``profile``: ``(radius, distance along the axis)``.
        ``closed``: the profile is a loop (hollow tube walls); otherwise both ends are capped."""
        bm = bmesh.new()
        rings = []
        for r, z in profile:
            rings.append([bm.verts.new((max(r, 1e-6) * math.cos(math.tau * i / seg), max(r, 1e-6) * math.sin(math.tau * i / seg), z)) for i in range(seg)])
        n = len(rings)
        for k in range(n if closed else n - 1):
            a, b = rings[k], rings[(k + 1) % n]
            for i in range(seg):
                j = (i + 1) % seg
                bm.faces.new((a[i], a[j], b[j], b[i]))
        if not closed:
            bm.faces.new(list(reversed(rings[0])))
            bm.faces.new(rings[-1])
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-6)
        _aim(bm, axis)
        return self._finish(bm, mat, at, rot, bevel, 2, cut)

    def tube(self, r_out, r_in, length, at, mat=None, seg=28, bevel=0.0006, axis="z", rot=(0, 0, 0)):
        """Hollow tube: the bore is real geometry, so you can look into it."""
        return self.lathe([(r_in, 0), (r_out, 0), (r_out, length), (r_in, length)], at, mat, seg, bevel, axis, rot, closed=True)

    def torus(self, R, r, at, mat=None, seg=28, rseg=10, axis="z", rot=(0, 0, 0)):
        prof = [(R + r * math.cos(math.tau * k / rseg), r * math.sin(math.tau * k / rseg)) for k in range(rseg)]
        return self.lathe(prof, at, mat, seg, 0.0, axis, rot, closed=True)

    def sphere(self, r, at, mat=None, seg=16, scale=(1, 1, 1)):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(6, seg // 2), radius=r)
        bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
        return self._finish(bm, mat, at, (0, 0, 0), 0.0, 2, None)

    def rod(self, a, b, r, mat=None, seg=12):
        """Thin cylinder from point ``a`` to point ``b``."""
        a, b = Vector(a), Vector(b)
        d = b - a
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length)
        bmesh.ops.translate(bm, vec=Vector((0, 0, d.length / 2)), verts=bm.verts)
        bmesh.ops.transform(bm, matrix=Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4(), verts=bm.verts)
        return self._finish(bm, mat, tuple(a), (0, 0, 0), 0.0, 2, None)

    # ---- common gun details ----
    def rail(self, z0, length, y_top, mat=None, w=0.0212, x=0.0, rot=(0, 0, 0)):
        """Picatinny rail: a base strip and a row of teeth. Top face at ``y_top``."""
        mat = mat or M.anodized()
        self.box((w * 0.74, 0.005, length), (x, y_top - 0.0065, z0 + length / 2), mat, 0.0006, rot)
        n = int(length / 0.01)
        for i in range(n):
            self.box((w, 0.004, 0.0052), (x, y_top - 0.002, z0 + 0.005 + i * 0.01), mat, 0.0006, rot)

    def pin(self, y, z, r, half_w, mat=None):
        """Cross pin: a head on each side."""
        mat = mat or M.steel()
        for s in (1, -1):
            self.cyl(r, 0.0016, (s * half_w - (0.0016 if s < 0 else 0), y, z), mat, axis="x", seg=14, bevel=0.0004)

    def serrations(self, x, y0, y1, z0, n, pitch, mat=None, depth=0.0012, w=0.0026, slant=0.0, both=True):
        """A row of raised ribs on a side face (slide serrations, grip texture)."""
        mat = mat or M.blued()
        for s in ((1, -1) if both else (1,)):
            for i in range(n):
                self.box((depth, y1 - y0, w), (s * x, (y0 + y1) / 2, z0 + i * pitch), mat, 0.0004, (slant, 0, 0))


def _aim(bm, axis: str) -> None:
    """Geometry built along +Z -> along the requested weapon axis."""
    if axis == "x":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"), verts=bm.verts)
    elif axis == "y":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, "X"), verts=bm.verts)


def _outline(pts):
    """Corner list -> polyline (curves sampled)."""
    out = []
    cur = None
    for p in pts:
        if len(p) == 4:
            cz, cy, z, y = p
            for k in range(1, 7):
                t = k / 6
                out.append(((1 - t) ** 2 * cur[0] + 2 * (1 - t) * t * cz + t * t * z, (1 - t) ** 2 * cur[1] + 2 * (1 - t) * t * cy + t * t * y))
            cur = (z, y)
        else:
            out.append((p[0], p[1]))
            cur = (p[0], p[1])
    return out


# --------------------------------------------------------------------------- export
def _wear(me: bpy.types.Mesh) -> None:
    """Bake worn edges into the ``Col`` vertex colours: convex edges 1.0, flat 0.75, creases 0.5."""
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    k = [0.0] * len(bm.verts)
    for v in bm.verts:
        best = 0.0
        low = 0.0
        for e in v.link_edges:
            if len(e.link_faces) != 2:
                continue
            a = e.calc_face_angle_signed()
            best = max(best, a)
            low = min(low, a)
        # a bevelled 90 degree corner is two steps of ~30 degrees
        k[v.index] = min(1.0, best / 0.5) if best > -low else -min(1.0, -low / 0.7)
    bm.free()
    col = me.color_attributes.get("Col") or me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    data = col.data
    wear_of = [float(m.get("wear", 0.0)) if m else 0.0 for m in me.materials]
    for poly in me.polygons:
        w = wear_of[poly.material_index] if poly.material_index < len(wear_of) else 0.0
        for li in poly.loop_indices:
            c = k[me.loops[li].vertex_index]
            v = 0.75 + 0.25 * c if c >= 0 else 0.75 + 0.3 * c
            v = 1.0 - (1.0 - v) * w if w > 0 else 1.0
            data[li].color = (v, v, v, 1.0)
    me.color_attributes.active_color = col
    me.color_attributes.render_color_index = list(me.color_attributes).index(col)


def join(gun: Gun) -> list[bpy.types.Object]:
    """Apply modifiers and join the solids into one object per (part, tier range)."""
    deps = bpy.context.evaluated_depsgraph_get()
    groups: dict[tuple, list[bpy.types.Object]] = {}
    for ob in gun.objs:
        # nested tier ranges that do not overlap (e.g. a tier-3 part inside a 0–1 variant): never shown, drop it
        if ob["tier"][0] > ob["tier"][1]:
            continue
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(deps), preserve_all_data_layers=True, depsgraph=deps)
        new = bpy.data.objects.new(ob.name + "_e", me)
        gun.col.objects.link(new)
        groups.setdefault((ob["part"], tuple(ob["tier"])), []).append(new)
    for ob in gun.objs + gun.cutters:
        bpy.data.objects.remove(ob, do_unlink=True)
    gun.objs, gun.cutters = [], []
    out = []
    for (part, (lo, hi)), obs in sorted(groups.items()):
        with bpy.context.temp_override(active_object=obs[0], selected_editable_objects=obs, selected_objects=obs, object=obs[0]):
            if len(obs) > 1:
                bpy.ops.object.join()
        ob = obs[0]
        ob.name = f"{part}__{lo}_{hi}"
        ob.data.name = f"{gun.kind}_{ob.name}"
        pivot = to_bl(gun.pivots.get(part, (0, 0, 0)))
        ob.data.transform(Matrix.Translation(-pivot))
        ob.location = pivot
        _wear(ob.data)
        ob["tier"] = (lo, hi)
        ob["part"] = part
        out.append(ob)
    gun.objs = out
    return out


def export_glb(gun: Gun, path: str) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for ob in gun.objs:
        ob.hide_render = False
        ob.hide_set(False)
        ob.select_set(True)
    bpy.context.view_layer.objects.active = gun.objs[0]
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=True, export_materials="EXPORT",
              export_cameras=False, export_lights=False, export_animations=False, export_extras=False)
    # vertex colours: the option was renamed between Blender versions
    for extra in (dict(export_vertex_color="MATERIAL"), dict(export_colors=True), {}):
        try:
            bpy.ops.export_scene.gltf(**kw, **extra)
            return
        except TypeError:
            continue


def show_tier(gun: Gun, t: int) -> None:
    for ob in gun.objs:
        lo, hi = ob["tier"]
        ob.hide_render = not (lo <= t <= hi)
