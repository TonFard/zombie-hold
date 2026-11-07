"""Shared helpers for the post-outbreak convenience-store scene.

Coordinate system
-----------------
The scene is authored directly in Blender's native Z-up space:

* ``+X``  runs along the shop front
* ``+Y``  points into the shop; the storefront plane sits at ``y = STORE_Y0``
* ``+Z``  is up; the sidewalk surface is ``z = SIDEWALK_TOP`` and the road ``z = ROAD_TOP``

The glTF exporter rewrites Z-up into the Y-up convention used by three.js, so
the storefront ends up facing ``+Z`` in the runtime scene.

Assembly rule for the whole scene: parts are **mated**, never **interpenetrated**.
Every helper below therefore exposes the exact bounding faces of a part so
callers can butt them against a neighbour instead of sinking one into another.
"""
from __future__ import annotations

import math
import os
import random

import bpy
from mathutils import Matrix, Vector

# --------------------------------------------------------------------------- paths
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
ASSET_DIR = os.path.join(ROOT, "assets", "blender")
BLEND_OUT = os.path.join(ASSET_DIR, "konbini-post-outbreak.blend")
WHITE_OUT = os.path.join(ASSET_DIR, "konbini-post-outbreak-white.png")
LIT_OUT = os.path.join(ASSET_DIR, "konbini-post-outbreak-lit.png")
GLB_OUT = os.path.join(ROOT, "public", "konbini", "post-outbreak.glb")

# --------------------------------------------------------------------------- layout
SIDEWALK_TOP = 0.15  # z of the paved walk in front of the store
ROAD_TOP = 0.0  # z of the asphalt

STORE_X0, STORE_X1 = -6.5, 6.5  # shop footprint along the front
STORE_Y0, STORE_Y1 = -4.5, 4.5  # shop footprint into the depth
FLOOR_Z = SIDEWALK_TOP  # interior floor is flush with the walk
WALL_T = 0.18  # wall thickness
WALL_H = 3.4  # wall height above the floor
ROOF_Z = FLOOR_Z + WALL_H  # top of the walls / underside of the roof slab

CURB_Y = -11.0  # kerb line of the front road
SIDE_ROAD_X = 12.5  # x where the side street begins (the street corner)
REAR_Y = 11.0  # far edge of the rear walk
WEST_X = -14.0
EAST_X = 14.0

CJK_FONTS = (
    "C:/Windows/Fonts/YUGothM.ttc",
    "C:/Windows/Fonts/YUGothB.ttc",
    "C:/Windows/Fonts/msgothic.ttc",
    "C:/Windows/Fonts/meiryo.ttc",
    "C:/Windows/Fonts/MSGothic.ttc",
)


# --------------------------------------------------------------------------- scene plumbing
def ensure_dir(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.collections):
        bpy.data.collections.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    root = bpy.context.scene.collection
    for child in list(root.children):
        root.children.unlink(child)


def collection(name: str) -> bpy.types.Collection:
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def move_to(obj: bpy.types.Object, col: bpy.types.Collection) -> bpy.types.Object:
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    col.objects.link(obj)
    return obj


def attach(obj: bpy.types.Object, parent: bpy.types.Object) -> bpy.types.Object:
    """Parent while keeping the object's current transform *local* to the parent.

    Used for hinged / sliding groups: the children are authored around the
    parent's origin, so rotating or translating the parent moves the assembly
    exactly like the real mechanism.
    """
    obj.parent = parent
    obj.matrix_parent_inverse = Matrix.Identity(4)
    return obj


# --------------------------------------------------------------------------- materials
def material(name: str, color, rough: float = 0.8, metallic: float = 0.0,
             emission=None, emission_strength: float = 0.0, alpha: float = 1.0) -> bpy.types.Material:
    """Create a plain PBR material.

    Only Principled BSDF values are used so the glTF export stays lossless;
    procedural noise produced heavy moire on the large flat slabs before.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None and "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        try:
            mat.surface_render_method = "BLENDED"
        except Exception:
            pass
    mat.diffuse_color = (*color, 1.0)
    return mat


def glass_material(name: str, color=(0.55, 0.62, 0.60), rough: float = 0.14,
                   alpha: float = 0.22) -> bpy.types.Material:
    return material(name, color, rough, 0.0, alpha=alpha)


def build_materials() -> dict:
    """All scene materials, keyed by a short stable name.

    The first pass used flat Principled colours only, which made every surface
    read as untextured plastic under the wet night lighting. Now the large
    surfaces carry baked albedo / roughness / normal maps, and the remaining
    materials get hand-tuned PBR values so the metal, plastic and glass still
    separate from each other.
    """
    from konbini_scene import textures

    m = {}

    # --- baked surface maps -------------------------------------------------
    concrete_maps = _map_set(textures.concrete(), "concrete")
    asphalt_maps = _map_set(textures.asphalt(), "asphalt")
    paint_maps = _map_set(textures.painted_metal(), "paint")
    tile_maps = _map_set(textures.tile_floor(), "tile")
    cardboard_maps = _map_set(textures.cardboard(), "cardboard")
    steel_maps = _map_set(textures.brushed_steel(), "steel")
    panel_maps = _map_set(textures.corrugated(), "panel")
    grime_maps = _map_set(textures.grime_stain(), "grime")

    def tex(tint, roughness, metallic=0.0, maps=None, scale=(1.0, 1.0, 1.0),
            emission=None, emission_strength=0.0, alpha=1.0, name="Surface"):
        """Build a textured material.

        ``tint`` is a multiplier on the baked albedo map, so the maps carry the
        surface value and the tint carries the hue. Keeping the tints close to
        white is what stops the textured surfaces from going black.
        """
        return textures.textured_material(
            name, tint, roughness, metallic, maps, scale,
            emission=emission, emission_strength=emission_strength, alpha=alpha)

    # --- ground -------------------------------------------------------------
    m["asphalt"] = tex((0.88, 0.90, 0.96), 0.90, 0.0, asphalt_maps, (0.5, 0.5, 0.5),
                       name="Asphalt | wet aged aggregate")
    m["asphalt_patch"] = tex((0.80, 0.84, 0.90), 0.84, 0.0, asphalt_maps, (0.7, 0.7, 0.7),
                             name="Asphalt | repair patch")
    m["concrete"] = tex((0.98, 0.95, 0.90), 0.90, 0.0, concrete_maps, (0.45, 0.45, 0.45),
                        name="Concrete | rain stained walk")
    m["concrete_clean"] = tex((1.05, 1.02, 0.96), 0.86, 0.0, concrete_maps, (0.7, 0.7, 0.7),
                              name="Concrete | kerb face")
    m["tactile"] = tex((1.60, 1.10, 0.18), 0.85, 0.0, concrete_maps, (1.6, 1.6, 1.6),
                       name="Tactile paving | faded yellow")
    m["floor_tile"] = tex((1.00, 0.98, 0.94), 0.58, 0.0, tile_maps, (0.35, 0.35, 0.35),
                          name="Shop floor | worn vinyl tile")

    # --- shell --------------------------------------------------------------
    m["wall"] = tex((1.00, 0.96, 0.88), 0.94, 0.0, concrete_maps, (0.35, 0.35, 0.35),
                    name="Render | aged warm grey")
    m["wall_back"] = tex((0.72, 0.70, 0.66), 0.96, 0.0, grime_maps, (0.8, 0.8, 0.8),
                         name="Render | grimy back wall")
    m["paint_blue"] = tex((0.10, 0.30, 0.78), 0.68, 0.0, paint_maps, (0.8, 0.8, 0.8),
                          name="Paint | faded convenience blue")
    m["paint_yellow"] = tex((1.70, 1.20, 0.14), 0.70, 0.0, paint_maps, (0.8, 0.8, 0.8),
                            name="Paint | faded convenience yellow")
    m["sign_white"] = tex((1.65, 1.60, 1.48), 0.66, 0.0, paint_maps, (1.0, 1.0, 1.0),
                          name="Sign face | weathered white")
    m["sign_black"] = material("Sign | black kanji", (0.016, 0.016, 0.018), 0.78)
    m["sign_blue"] = tex((0.07, 0.28, 0.95), 0.58, 0.0, paint_maps, (1.0, 1.0, 1.0),
                         name="Sign | traffic blue")

    # --- metals -------------------------------------------------------------
    m["steel"] = tex((0.52, 0.55, 0.58), 0.50, 0.65, steel_maps, (0.9, 0.9, 0.9),
                     name="Steel | galvanised dull")
    m["steel_dark"] = tex((0.22, 0.24, 0.26), 0.58, 0.40, paint_maps, (0.9, 0.9, 0.9),
                           name="Steel | dark powder coated")
    m["aluminium"] = tex((1.05, 1.08, 1.12), 0.38, 0.82, steel_maps, (1.4, 1.4, 1.4),
                         name="Aluminium | anodised shop front")
    m["rust"] = tex((1.30, 0.52, 0.22), 0.94, 0.10, grime_maps, (1.5, 1.5, 1.5),
                    name="Steel | oxidised")
    m["chrome"] = material("Chrome | worn shop front", (0.500, 0.510, 0.520), 0.22, 0.92)

    # --- glass --------------------------------------------------------------
    m["glass"] = glass_material("Glass | dirty storefront", (0.40, 0.48, 0.46), 0.16, 0.24)
    m["glass_broken"] = glass_material("Glass | cracked pane", (0.44, 0.50, 0.48), 0.30, 0.34)
    m["glass_cooler"] = glass_material("Glass | cooler door", (0.48, 0.54, 0.52), 0.10, 0.16)

    # --- plastics, paper, organics -----------------------------------------
    m["plastic_white"] = material("Plastic | aged white", (0.560, 0.560, 0.545), 0.46)
    m["plastic_grey"] = material("Plastic | grey crate", (0.140, 0.150, 0.160), 0.55)
    m["plastic_red"] = material("Plastic | faded red", (0.210, 0.032, 0.026), 0.52)
    m["plastic_blue"] = material("Plastic | crate blue", (0.032, 0.070, 0.160), 0.52)
    m["cardboard"] = tex((0.62, 0.44, 0.24), 0.95, 0.0, cardboard_maps, (1.2, 1.2, 1.2),
                          name="Cardboard | water damaged")
    m["paper"] = tex((1.45, 1.36, 1.18), 0.76, 0.0, paint_maps, (2.6, 2.6, 2.6),
                     name="Paper | printed film")
    m["rubber"] = material("Rubber | tyre and gasket", (0.018, 0.018, 0.020), 0.88)
    m["wood"] = tex((0.52, 0.36, 0.20), 0.92, 0.0, cardboard_maps, (0.8, 0.8, 0.8),
                    name="Wood | water damaged ply")
    m["fabric"] = tex((0.48, 0.40, 0.28), 0.98, 0.0, grime_maps, (2.2, 2.2, 2.2),
                      name="Coir mat | entrance")
    m["blood"] = material("Blood | dried dark", (0.048, 0.007, 0.005), 0.94)
    m["blood_dilute"] = material("Blood | diluted run-off", (0.095, 0.020, 0.012), 0.88)
    m["dirt"] = tex((0.30, 0.26, 0.20), 1.0, 0.0, grime_maps, (1.8, 1.8, 1.8),
                    name="Dirt | dust and soot")
    m["grime"] = tex((0.18, 0.18, 0.17), 0.95, 0.0, grime_maps, (1.2, 1.2, 1.2),
                     name="Grime | rain runnels")
    m["leaf"] = material("Foliage | dead leaf", (0.085, 0.052, 0.026), 0.95)
    m["water"] = material("Water | shallow puddle", (0.016, 0.028, 0.034), 0.07, 0.25)

    # --- fixtures ------------------------------------------------------------
    m["shelf_deck"] = tex((0.95, 0.98, 1.02), 0.54, 0.55, panel_maps, (2.2, 2.2, 2.2),
                          name="Shelf | powder coated deck")
    m["shelf_panel"] = tex((0.85, 0.88, 0.92), 0.58, 0.50, panel_maps, (1.4, 1.4, 1.4),
                           name="Shelf | perforated back panel")
    m["gondola_top"] = tex((0.12, 0.34, 0.82), 0.66, 0.0, paint_maps, (1.1, 1.1, 1.1),
                           name="Shelf | top board fascia")

    # --- lighting ------------------------------------------------------------
    m["lamp_warm"] = material("Lamp | warm fluorescent tube", (0.80, 0.74, 0.58), 0.35,
                              emission=(1.0, 0.86, 0.62), emission_strength=4.5)
    m["lamp_dead"] = material("Lamp | dead amber tube", (0.105, 0.055, 0.017), 0.40)
    m["lamp_led"] = material("Lamp | canopy downlight", (0.78, 0.80, 0.84), 0.30,
                             emission=(0.85, 0.90, 1.0), emission_strength=3.5)
    m["emergency"] = material("Lamp | emergency exit green", (0.045, 0.28, 0.13), 0.35,
                               emission=(0.10, 0.85, 0.35), emission_strength=2.2)
    m["sky"] = material("Sky | deep night blue", (0.012, 0.022, 0.052), 0.95,
                        emission=(0.014, 0.028, 0.070), emission_strength=1.0)
    m["white_clay"] = material("Review | neutral white clay", (0.620, 0.630, 0.640), 0.88)
    return m


def _map_set(maps: tuple, prefix: str) -> dict:
    """Turn a generator's (albedo, rough, normal) triple into a map dict."""
    from konbini_scene import textures as _t
    albedo, rough, normal = maps
    return {
        "albedo": _t._make_image(f"{prefix}_albedo", albedo),
        "rough": _t._make_image(f"{prefix}_rough", rough),
        "normal": _t._make_image(f"{prefix}_normal", normal),
    }


# --------------------------------------------------------------------------- primitives
def _finish(obj: bpy.types.Object, name: str, mat, col: bpy.types.Collection,
            bevel: float = 0.0, segments: int = 2) -> bpy.types.Object:
    obj.name = name
    if mat is not None:
        # The mesh may be shared between objects, so the material is linked at
        # the object level instead of being appended to the shared mesh data.
        if not obj.data.materials:
            obj.data.materials.append(mat)
        obj.material_slots[0].link = "OBJECT"
        obj.material_slots[0].material = mat
    move_to(obj, col)
    if bevel > 0:
        mod = obj.modifiers.new("Worn edge radius", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(40)
        obj.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
    return obj


# Building every drink with bpy.ops is far too slow (the operator overhead
# dominates once a scene holds thousands of small parts). The meshes below are
# therefore generated once and reused as linked duplicates.
_mesh_cache: dict[tuple, bpy.types.Mesh] = {}


def _cached_mesh(key: tuple, build) -> bpy.types.Mesh:
    mesh = _mesh_cache.get(key)
    if mesh is None:
        mesh = build()
        _mesh_cache[key] = mesh
    return mesh


def _cone_mesh(radius1: float, radius2: float, depth: float, vertices: int) -> bpy.types.Mesh:
    key = ("cone", round(radius1, 5), round(radius2, 5), round(depth, 5), vertices)

    def build():
        mesh = bpy.data.meshes.new("cone")
        # Build a truncated cone by hand: two rings plus caps.
        half = depth / 2
        verts = []
        for z, r in ((-half, radius1), (half, radius2)):
            for i in range(vertices):
                a = math.tau * i / vertices
                verts.append((r * math.cos(a), r * math.sin(a), z))
        faces = []
        for i in range(vertices):
            j = (i + 1) % vertices
            faces.append((i, j, vertices + j, vertices + i))
        faces.append(tuple(reversed(range(vertices))))
        faces.append(tuple(range(vertices, vertices * 2)))
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        _uv_cone(mesh, vertices, depth, max(radius1, radius2))
        return mesh

    return _cached_mesh(key, build)


def _uv_cone(mesh: bpy.types.Mesh, vertices: int, depth: float, radius: float) -> None:
    """Cylindrical UVs in world units: u runs around the barrel, v along it."""
    uv_layer = mesh.uv_layers.new(name="UVMap")
    circumference = math.tau * radius
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            angle = math.atan2(co.y, co.x)
            u = (angle + math.pi) / math.tau * circumference
            v = co.z + depth / 2
            if poly.index >= vertices:
                # The two caps use a planar projection of the disc.
                u = co.x + radius
                v = co.y + radius
            uv_layer.data[loop_index].uv = (u, v)


def _torus_mesh(major: float, minor: float, major_seg: int, minor_seg: int) -> bpy.types.Mesh:
    key = ("torus", round(major, 5), round(minor, 5), major_seg, minor_seg)

    def build():
        mesh = bpy.data.meshes.new("torus")
        verts = []
        for i in range(major_seg):
            u = math.tau * i / major_seg
            for j in range(minor_seg):
                v = math.tau * j / minor_seg
                r = major + minor * math.cos(v)
                verts.append((r * math.cos(u), r * math.sin(u), minor * math.sin(v)))
        faces = []
        for i in range(major_seg):
            i2 = (i + 1) % major_seg
            for j in range(minor_seg):
                j2 = (j + 1) % minor_seg
                a = i * minor_seg + j
                b = i2 * minor_seg + j
                c = i2 * minor_seg + j2
                d = i * minor_seg + j2
                faces.append((a, b, c, d))
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        uv_layer = mesh.uv_layers.new(name="UVMap")
        for poly in mesh.polygons:
            for loop_index in poly.loop_indices:
                co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
                angle = math.atan2(co.y, co.x)
                uv_layer.data[loop_index].uv = (
                    (angle + math.pi) / math.tau * math.tau * major,
                    math.sqrt(max(co.x * co.x + co.y * co.y, 0.0)) - major + minor)
        return mesh

    return _cached_mesh(key, build)


def _cylinder_mesh(radius: float, depth: float, vertices: int) -> bpy.types.Mesh:
    return _cone_mesh(radius, radius, depth, vertices)


def box(name: str, bounds, mat, col: bpy.types.Collection, bevel: float = 0.0):
    """Create a box from ``(x0, x1, y0, y1, z0, z1)`` so faces stay exact.

    The UVs are laid out in world units rather than 0..1 per face, so a texture
    keeps a constant texel density no matter how big the slab is. Without this
    the concrete map is stretched across the 13 m storefront and invisible on
    a 0.3 m crate lid.
    """
    x0, x1, y0, y1, z0, z1 = bounds
    size = (x1 - x0, y1 - y0, z1 - z0)
    key = ("box", tuple(round(v, 5) for v in size))

    def build():
        mesh = bpy.data.meshes.new("box")
        sx, sy, sz = (v / 2 for v in size)
        verts = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
                 (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                 (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        # World-unit UVs: each face is unwrapped across its two real extents.
        w, h, d = size
        face_uvs = [
            (d, h), (d, h),      # -Z / +Z
            (w, d), (w, d),      # -Y / +Y
            (w, h), (w, h),      # -X / +X
        ]
        uv_layer = mesh.uv_layers.new(name="UVMap")
        for poly, (fw, fh) in zip(mesh.polygons, face_uvs):
            for loop_index in poly.loop_indices:
                corner = mesh.vertices[mesh.loops[loop_index].vertex_index].co
                # Local coordinates of this face, in world units.
                if poly.index in (0, 1):
                    u, v = corner.x + sx, corner.y + sy
                elif poly.index in (2, 3):
                    u, v = corner.x + sx, corner.z + sz
                else:
                    u, v = corner.y + sy, corner.z + sz
                uv_layer.data[loop_index].uv = (u, v)
        return mesh

    obj = bpy.data.objects.new(name, _cached_mesh(key, build))
    obj.location = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    return _finish(obj, name, mat, col, bevel)


def cylinder(name: str, radius: float, z0: float, z1: float, x: float, y: float, mat,
             col: bpy.types.Collection, vertices: int = 16, bevel: float = 0.0,
             axis: str = "z", taper: float = 1.0):
    depth = abs(z1 - z0)
    mesh = _cone_mesh(radius, radius * taper, depth, vertices)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = (x, y, (z0 + z1) / 2)
    if axis == "x":
        obj.rotation_euler[1] = math.radians(90)
    elif axis == "y":
        obj.rotation_euler[0] = math.radians(90)
    return _finish(obj, name, mat, col, bevel)


def cylinder_between(name: str, a, b, radius: float, mat, col: bpy.types.Collection,
                     vertices: int = 12, taper: float = 1.0):
    a_v, b_v = Vector(a), Vector(b)
    d = b_v - a_v
    mesh = _cone_mesh(radius, radius * taper, d.length, vertices)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = (a_v + b_v) * 0.5
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = d.to_track_quat("Z", "Y")
    return _finish(obj, name, mat, col)


def torus(name: str, major: float, minor: float, x: float, y: float, z: float, mat,
          col: bpy.types.Collection, rot_x: float = math.pi / 2, major_seg: int = 28,
          minor_seg: int = 8):
    mesh = _torus_mesh(major, minor, major_seg, minor_seg)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = (x, y, z)
    obj.rotation_euler = (rot_x, 0, 0)
    return _finish(obj, name, mat, col)


def curve_line(name: str, points, radius: float, mat, col: bpy.types.Collection):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.resolution_u = 1
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    spline = cu.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, vec in zip(spline.points, points):
        point.co = (*vec, 1)
    obj = bpy.data.objects.new(name, cu)
    col.objects.link(obj)
    if mat:
        cu.materials.append(mat)
    return obj


def empty(name: str, location, col: bpy.types.Collection, size: float = 0.2):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = size
    obj.location = location
    col.objects.link(obj)
    return obj


def decal(name: str, x: float, y: float, z: float, width: float, height: float, mat,
          col: bpy.types.Collection, normal: str = "-y", seed: int = 1, count: int = 13):
    """Irregular flat stain seated 1.5 mm off the surface it describes."""
    rng = random.Random(seed)
    verts = []
    for i in range(count):
        angle = math.tau * i / count
        r = 0.72 + rng.random() * 0.30
        du = math.cos(angle) * width * 0.5 * r
        dv = math.sin(angle) * height * 0.5 * r
        if normal == "-y":
            verts.append((x + du, y - 0.0015, z + dv))
        elif normal == "+y":
            verts.append((x + du, y + 0.0015, z + dv))
        elif normal == "+z":
            verts.append((x + du, y + dv, z + 0.0015))
        else:
            verts.append((x + du, y + dv, z - 0.0015))
    mesh = bpy.data.meshes.new(name + " | outline")
    # Winding so the flat face points away from the surface it is stuck to.
    if normal in ("+y", "-z"):
        faces = [tuple(reversed(range(count)))]
    else:
        faces = [tuple(range(count))]
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    col.objects.link(obj)
    return obj


# --------------------------------------------------------------------------- text
_font_cache = []


def load_cjk_font():
    """Load a system CJK font so the sign text renders as real glyphs."""
    if _font_cache:
        return _font_cache[0]
    for path in CJK_FONTS:
        if os.path.exists(path):
            try:
                font = bpy.data.fonts.load(path, check_existing=True)
                _font_cache.append(font)
                return font
            except Exception:
                continue
    return None


def text(name: str, body: str, x: float, y: float, z: float, size: float, mat,
         col: bpy.types.Collection, facing: str = "-y", extrude: float = 0.0015,
         spacing: float = 1.0):
    """Flat text mesh facing one of the four axis directions.

    ``facing`` is the direction the glyph fronts point at. The rotations below
    are chosen so the text reads left to right for a viewer standing on that
    side, so no mirroring is needed.
    """
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.space_character = spacing
    font = load_cjk_font()
    if font is not None:
        cu.font = font
    obj = bpy.data.objects.new(name, cu)
    col.objects.link(obj)
    obj.location = (x, y, z)
    if facing == "-y":
        obj.rotation_euler = (math.pi / 2, 0, 0)
    elif facing == "+y":
        obj.rotation_euler = (math.pi / 2, 0, math.pi)
    elif facing == "-x":
        obj.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
    else:
        obj.rotation_euler = (math.pi / 2, 0, math.pi / 2)
    if mat:
        cu.materials.append(mat)
    # Font objects are not exported to glTF, so bake them into meshes.
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    return obj
