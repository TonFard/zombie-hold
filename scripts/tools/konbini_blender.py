"""Build the Konbini interior fixture pack in Blender and export it for Three.js.

Run with:
  blender -b --python scripts/tools/konbini_blender.py

The saved .blend keeps a simple shop shell, lights, camera and Cycles bake setup for
editing. The exported GLB contains only the replacement fixtures; the interactive
product and door meshes remain controlled by the game's existing TypeScript code.
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "konbini"
BLEND = ROOT / "assets" / "blender" / "konbini-interior.blend"
GLB = OUT / "interior-fixtures.glb"
PREVIEW = ROOT / ".logs" / "shots" / "konbini-blender-preview.png"
FLOOR = 0.3
CEILING = 3.2

OUT.mkdir(parents=True, exist_ok=True)
BLEND.parent.mkdir(parents=True, exist_ok=True)
PREVIEW.parent.mkdir(parents=True, exist_ok=True)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.materials, bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for item in list(datablocks):
            if item.users == 0:
                datablocks.remove(item)


def material(name: str, color: tuple[float, float, float], roughness: float = 0.55, metal: float = 0.0) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metal
    return mat


def cube(name: str, dims: tuple[float, float, float], loc: tuple[float, float, float], mat: bpy.types.Material,
         bevel: float = 0.015, collection: bpy.types.Collection | None = None) -> bpy.types.Object:
    # Call sites use Three.js axes (Y up, +Z toward the shop front). Blender uses
    # Z up; GLTF's Y-up export then restores the original game coordinates.
    game_x, game_y, game_z = loc
    width, height, depth = dims
    blender_loc = (game_x, -game_z, game_y)
    blender_dims = (width, depth, height)
    bpy.ops.mesh.primitive_cube_add(size=1, location=blender_loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = blender_dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel > 0:
        mod = obj.modifiers.new("Soft machined edges", "BEVEL")
        mod.width = min(bevel, min(dims) * 0.22)
        mod.segments = 3
        mod.profile = 0.5
        normal = obj.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
        normal.keep_sharp = True
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.ops.object.modifier_apply(modifier=normal.name)
    if collection and obj.name not in collection.objects:
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
        collection.objects.link(obj)
    return obj


def cylinder(name: str, radius: float, depth: float, loc: tuple[float, float, float], mat: bpy.types.Material,
             vertices: int = 24, axis: str = "Z", collection: bpy.types.Collection | None = None) -> bpy.types.Object:
    game_x, game_y, game_z = loc
    bpy_loc = (game_x, -game_z, game_y)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=bpy_loc)
    obj = bpy.context.object
    obj.name = name
    if axis == "X":
        obj.rotation_euler[1] = math.pi / 2
    elif axis == "Y":
        pass  # Blender's native Z axis is game Y (up).
    elif axis == "Z":
        obj.rotation_euler[0] = math.pi / 2
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = len(p.vertices) == 4
    if collection and obj.name not in collection.objects:
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
        collection.objects.link(obj)
    return obj


def curve_beam(name: str, a: tuple[float, float, float], b: tuple[float, float, float], radius: float,
               mat: bpy.types.Material, collection: bpy.types.Collection) -> bpy.types.Object:
    cv = lambda p: Vector((p[0], -p[2], p[1]))
    aa, bb = cv(a), cv(b)
    mid = (aa + bb) * 0.5
    direction = bb - aa
    obj = cylinder(name, radius, direction.length, tuple(mid), mat, vertices=12, collection=collection)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    return obj


def label_panel(name: str, dims: tuple[float, float, float], loc: tuple[float, float, float],
                mat: bpy.types.Material, collection: bpy.types.Collection, rot_z: float = 0) -> bpy.types.Object:
    obj = cube(name, dims, loc, mat, bevel=min(dims) * 0.25, collection=collection)
    obj.rotation_euler[2] = rot_z
    return obj


def create_materials() -> dict[str, bpy.types.Material]:
    return {
        "porcelain": material("warm white enamel", (0.72, 0.73, 0.71), 0.32, 0.08),
        "white": material("refrigerator ceramic", (0.83, 0.84, 0.81), 0.28, 0.06),
        "dark": material("charcoal powder coat", (0.035, 0.043, 0.055), 0.42, 0.38),
        "steel": material("brushed stainless steel", (0.43, 0.47, 0.49), 0.28, 0.72),
        "shelf": material("galvanized shelf metal", (0.59, 0.61, 0.60), 0.38, 0.55),
        "black": material("rubber and black plastic", (0.025, 0.028, 0.033), 0.62, 0.02),
        "navy": material("game navy accent", (0.035, 0.12, 0.31), 0.43, 0.12),
        "teal": material("game teal accent", (0.035, 0.52, 0.49), 0.4, 0.04),
        "orange": material("warm safety accent", (0.88, 0.29, 0.055), 0.47, 0.03),
        "wood": material("countertop oak laminate", (0.34, 0.22, 0.13), 0.46, 0.0),
        "glass": material("cooler door clear glass", (0.55, 0.68, 0.76), 0.16, 0.12),
        "screen": material("screen dark glass", (0.012, 0.02, 0.035), 0.18, 0.12),
        "led": material("cool white LED", (0.76, 0.88, 1.0), 0.25, 0.0),
        "food": material("hot food golden brown", (0.48, 0.22, 0.07), 0.48, 0.0),
        "paper": material("price ticket stock", (0.85, 0.82, 0.72), 0.72, 0.0),
    }


def create_gondola(M: dict[str, bpy.types.Material], col: bpy.types.Collection, z: float, idx: int) -> None:
    x0, length, height = -2.5, 7.0, 1.45
    zc = z
    def box(label: str, dims: tuple[float, float, float], p: tuple[float, float, float], mat: str, bevel: float = 0.012) -> None:
        cube(f"Aisle {idx} | {label}", dims, p, M[mat], bevel, col)

    # Recessed center back panel and steel end posts.
    box("perforated centre spine", (length, 1.32, 0.045), (x0, FLOOR + 0.78, zc), "dark", 0.01)
    for side in (-1, 1):
        zz = zc + side * 0.43
        for xx in (x0 - length / 2 + 0.04, x0, x0 + length / 2 - 0.04):
            box("upright", (0.045, height, 0.045), (xx, FLOOR + height / 2, zz), "dark", 0.008)
        box("end frame", (0.045, height, 0.86), (x0 - length / 2 + 0.02, FLOOR + height / 2, zc), "dark", 0.008)
        box("end frame", (0.045, height, 0.86), (x0 + length / 2 - 0.02, FLOOR + height / 2, zc), "dark", 0.008)
        # Shelf trays, raised back lips, and the recognizable teal rail at the base.
        for li, y in enumerate((0.12, 0.45, 0.78, 1.11)):
            depth = 0.39 if li else 0.78
            center_z = zc + side * (0.22 if li else 0.0)
            box("formed shelf", (length - 0.1, 0.025, depth), (x0, FLOOR + y - 0.0125, center_z), "shelf", 0.006)
            edge_z = center_z + side * depth / 2
            box("rolled shelf lip", (length - 0.12, 0.035, 0.018), (x0, FLOOR + y + 0.005, edge_z), "steel", 0.008)
            if li:
                box("price rail", (length - 0.12, 0.038, 0.022), (x0, FLOOR + y - 0.045, edge_z - side * 0.012), "paper", 0.005)
        box("base plinth", (length + 0.03, 0.12, 0.82), (x0, FLOOR + 0.06, zc), "dark", 0.025)
        box("teal base accent", (length - 0.08, 0.025, 0.014), (x0, FLOOR + 0.135, zc + side * 0.414), "teal", 0.005)
    box("top cap", (length + 0.04, 0.035, 0.91), (x0, FLOOR + height + 0.012, zc), "porcelain", 0.015)
    # Small zinc bolts at each upright make the rack read as assembled hardware.
    for xx in (x0 - 3.42, x0, x0 + 3.42):
        for side in (-1, 1):
            for yy in (FLOOR + 0.25, FLOOR + 1.25):
                cylinder(f"Aisle {idx} | upright bolt", 0.012, 0.008, (xx, yy, zc + side * 0.456), M["steel"], 12, "Y", col)


def create_cooler(M: dict[str, bpy.types.Material], col: bpy.types.Collection) -> None:
    x0, bays, w = -7.7, 9, 1.08
    x1, zb, zf = x0 + bays * w, -11.8, -10.9
    midx, midz = (x0 + x1) / 2, (zb + zf) / 2
    # Keep the front open: the in-game drink meshes and animated glass doors sit
    # in this volume. A solid cabinet here would hide every bottle behind it.
    cube("Cooler bank | insulated back", (x1 - x0, 2.58, 0.10), (midx, FLOOR + 1.29, zb + 0.05), M["dark"], 0.035, col)
    cube("Cooler bank | insulated left side", (0.10, 2.58, zf - zb), (x0 + 0.05, FLOOR + 1.29, midz), M["dark"], 0.025, col)
    cube("Cooler bank | insulated right side", (0.10, 2.58, zf - zb), (x1 - 0.05, FLOOR + 1.29, midz), M["dark"], 0.025, col)
    cube("Cooler bank | insulated roof", (x1 - x0, 0.10, zf - zb), (midx, FLOOR + 2.53, midz), M["dark"], 0.025, col)
    cube("Cooler bank | kick plate", (x1 - x0 - 0.04, 0.16, 0.08), (midx, FLOOR + 0.08, zf + 0.03), M["steel"], 0.018, col)
    cube("Cooler bank | illuminated header", (x1 - x0 - 0.08, 0.26, 0.045), (midx, FLOOR + 2.4, zf + 0.052), M["navy"], 0.018, col)
    cube("Cooler bank | header light", (x1 - x0 - 0.18, 0.025, 0.018), (midx, FLOOR + 2.245, zf + 0.065), M["led"], 0.008, col)
    # Interior shelf rails and cool white strips remain visible through the animated glass doors.
    for bay in range(bays):
        cx = x0 + bay * w + w / 2
        cube(f"Cooler bay {bay + 1} | divider", (0.025, 2.15, 0.8), (x0 + bay * w, FLOOR + 1.25, midz), M["steel"], 0.008, col)
        for li, y in enumerate((0.48, 0.88, 1.28, 1.68, 2.08)):
            cube(f"Cooler bay {bay + 1} | shelf {li + 1}", (w - 0.08, 0.018, 0.72), (cx, FLOOR + y, midz + 0.02), M["shelf"], 0.006, col)
            cube(f"Cooler bay {bay + 1} | shelf light {li + 1}", (w - 0.12, 0.012, 0.012), (cx, FLOOR + y + 0.022, zf + 0.045), M["led"], 0.004, col)
        # Dark door jambs align exactly with the existing interactive sliding hinges.
        cube(f"Cooler bay {bay + 1} | door jamb L", (0.018, 2.04, 0.028), (x0 + bay * w + 0.018, FLOOR + 1.24, zf + 0.04), M["black"], 0.004, col)
    cube("Cooler bank | right jamb", (0.025, 2.04, 0.028), (x1 - 0.015, FLOOR + 1.24, zf + 0.04), M["black"], 0.004, col)


def create_deli_case(M: dict[str, bpy.types.Material], col: bpy.types.Collection) -> None:
    # Open refrigerated deli case on the west wall. Existing goods sit on the three shelves.
    length = 6.4
    x, z = -7.8, -6.9
    rot = math.pi / 2
    def part(label: str, dims: tuple[float, float, float], local: tuple[float, float, float], mat: str, bevel: float = 0.012) -> None:
        # Same transform as a Three.js Y rotation: local X -> world -Z,
        # local Z -> world +X.
        obj = cube(f"Deli display | {label}", dims,
                   (x + local[2], FLOOR + local[1], z - local[0]), M[mat], bevel, col)
        obj.rotation_euler[2] = rot
    # Rotation swaps local X into world -Z; x remains the case's west-wall line.
    part("insulated base", (length, 0.62, 0.75), (0, 0.31, 0), "porcelain", 0.035)
    part("dark toe kick", (length + 0.02, 0.12, 0.77), (0, 0.06, 0), "dark", 0.02)
    part("teal service stripe", (length - 0.08, 0.045, 0.018), (0, 0.43, -0.39), "teal", 0.008)
    part("orange service stripe", (length - 0.08, 0.035, 0.018), (0, 0.36, -0.39), "orange", 0.008)
    part("rear chilled panel", (length, 1.8, 0.045), (0, 1.15, -0.31), "white", 0.015)
    for li, (y, depth) in enumerate(((1.05, 0.55), (1.35, 0.46), (1.65, 0.38))):
        part(f"product tray {li + 1}", (length - 0.06, 0.025, depth), (0, y - 0.025, -0.03), "shelf", 0.008)
        part(f"tray front edge {li + 1}", (length - 0.06, 0.045, 0.018), (0, y, -0.03 + depth / 2), "steel", 0.006)
    part("cooling top hood", (length, 0.09, 0.72), (0, 1.98, -0.02), "white", 0.022)
    part("cold LED strip", (length - 0.14, 0.018, 0.025), (0, 1.935, 0.27), "led", 0.006)


def create_magazine_rack(M: dict[str, bpy.types.Material], col: bpy.types.Collection) -> None:
    x, z, length = -4.6, -2.12, 5.6
    # The open top tilts toward the entrance and keeps the existing cover images visible.
    cube("Magazine rack | low cabinet", (length, 0.35, 0.50), (x, FLOOR + 0.175, z), M["dark"], 0.025, col)
    cube("Magazine rack | teal trim", (length - 0.08, 0.024, 0.018), (x, FLOOR + 0.34, z + 0.245), M["teal"], 0.006, col)
    for row in range(3):
        y = FLOOR + 0.36 + row * 0.24
        zz = z + 0.18 - row * 0.13
        cube(f"Magazine rack | tray {row + 1}", (length - 0.12, 0.025, 0.16), (x, y, zz), M["shelf"], 0.008, col)
        cube(f"Magazine rack | retaining lip {row + 1}", (length - 0.12, 0.065, 0.018), (x, y + 0.03, zz + 0.07), M["steel"], 0.008, col)
    cube("Magazine rack | back panel", (length, 1.08, 0.035), (x, FLOOR + 0.55, z - 0.232), M["porcelain"], 0.02, col)


def create_counter(M: dict[str, bpy.types.Material], col: bpy.types.Collection) -> None:
    x, z = 4.55, -5.9
    length = 5.4
    cube("Checkout | cabinet", (0.70, 0.95, length), (x, FLOOR + 0.475, z), M["porcelain"], 0.035, col)
    cube("Checkout | recessed kick", (0.72, 0.13, length + 0.02), (x, FLOOR + 0.065, z), M["dark"], 0.018, col)
    cube("Checkout | navy fascia", (0.018, 0.065, length - 0.06), (4.195, FLOOR + 0.62, z), M["navy"], 0.004, col)
    cube("Checkout | teal fascia", (0.022, 0.04, length - 0.06), (4.194, FLOOR + 0.535, z), M["teal"], 0.004, col)
    cube("Checkout | safety line", (0.024, 0.035, length - 0.06), (4.193, FLOOR + 0.48, z), M["orange"], 0.004, col)
    cube("Checkout | oak worktop", (0.82, 0.055, length + 0.12), (x - 0.03, FLOOR + 0.965, z), M["wood"], 0.035, col)
    for idx, zz in enumerate((-5.8, -7.0)):
        # Customer display and scanner; the item labels and register functions remain in code.
        cube(f"Register {idx + 1} | base", (0.34, 0.09, 0.32), (4.60, FLOOR + 1.055, zz), M["dark"], 0.02, col)
        cube(f"Register {idx + 1} | housing", (0.32, 0.27, 0.21), (4.60, FLOOR + 1.22, zz), M["black"], 0.025, col)
        display = cube(f"Register {idx + 1} | customer screen", (0.25, 0.16, 0.018), (4.60, FLOOR + 1.25, zz + 0.117), M["screen"], 0.015, col)
        display.rotation_euler[0] = math.radians(12)
        cube(f"Register {idx + 1} | scanner glass", (0.15, 0.012, 0.12), (4.83, FLOOR + 1.04, zz), M["screen"], 0.01, col)
        cube(f"Register {idx + 1} | scanner red line", (0.08, 0.004, 0.055), (4.83, FLOOR + 1.049, zz), M["orange"], 0.002, col)
        cube(f"Register {idx + 1} | receipt slot", (0.12, 0.018, 0.006), (4.57, FLOOR + 1.05, zz - 0.14), M["black"], 0.003, col)
    # Hot food case, warm LED shelves and a few faceted karaage pieces.
    hx, hz, hy = 4.55, -4.6, FLOOR + 1.0
    cube("Hot case | dark base", (0.58, 0.10, 0.68), (hx, hy + 0.05, hz), M["dark"], 0.025, col)
    cube("Hot case | warming deck", (0.52, 0.025, 0.62), (hx, hy + 0.17, hz), M["steel"], 0.012, col)
    cube("Hot case | upper warming shelf", (0.50, 0.018, 0.59), (hx, hy + 0.38, hz), M["steel"], 0.01, col)
    for y in (hy + 0.20, hy + 0.41):
        cube("Hot case | warm LED", (0.45, 0.012, 0.012), (hx, y, hz - 0.27), M["orange"], 0.004, col)
    for row in range(2):
        for i in range(6):
            xx = hx - 0.18 + (i % 3) * 0.16
            zz = hz - 0.18 + (i // 3) * 0.18
            piece = cylinder(f"Hot case | karaage {row}-{i}", 0.034, 0.055, (xx, hy + 0.20 + row * 0.20, zz), M["food"], 10, "Z", col)
            piece.scale.x = 1.2
            piece.scale.y = 0.75


def create_self_service(M: dict[str, bpy.types.Material], col: bpy.types.Collection) -> None:
    # Oden station
    x, z, y = 4.55, -8.05, FLOOR + 1.0
    cube("Oden | stainless warmer", (0.54, 0.20, 0.48), (x, y + 0.10, z), M["steel"], 0.028, col)
    cube("Oden | broth tray", (0.45, 0.018, 0.38), (x, y + 0.20, z), M["wood"], 0.012, col)
    for xx in (-0.14, 0.0, 0.14):
        cube("Oden | divider", (0.012, 0.025, 0.38), (x + xx, y + 0.22, z), M["steel"], 0.004, col)
    for i in range(8):
        xx = x - 0.15 + (i % 4) * 0.1
        zz = z - 0.12 + (i // 4) * 0.22
        cylinder(f"Oden | ingredient {i}", 0.035, 0.045, (xx, y + 0.24, zz), M["food"], 12, "Z", col)
    # Coffee brewer with metal drip tray and touch display.
    x, z = 4.60, -3.6
    cube("Coffee machine | body", (0.42, 0.62, 0.40), (x, y + 0.31, z), M["dark"], 0.035, col)
    cube("Coffee machine | front panel", (0.32, 0.28, 0.022), (x, y + 0.39, z + 0.207), M["navy"], 0.018, col)
    cube("Coffee machine | display", (0.25, 0.14, 0.012), (x, y + 0.45, z + 0.222), M["screen"], 0.01, col)
    cube("Coffee machine | dispense bay", (0.22, 0.09, 0.16), (x, y + 0.15, z + 0.12), M["black"], 0.012, col)
    cube("Coffee machine | drip tray", (0.32, 0.022, 0.19), (x, y + 0.01, z + 0.12), M["steel"], 0.012, col)
    for i in range(6):
        cylinder(f"Coffee | cup stack {i + 1}", 0.038 - i * 0.001, 0.07, (x - 0.38, y + i * 0.018, z + 0.05), M["white"], 16, "Z", col)


def create_back_corner(M: dict[str, bpy.types.Material], col: bpy.types.Collection) -> None:
    zb = -11.8
    # ATM body with the existing screen overlay placed on the front.
    cube("ATM | cabinet", (0.62, 1.55, 0.50), (2.5, FLOOR + 0.775, zb + 0.25), M["porcelain"], 0.04, col)
    cube("ATM | dark display bezel", (0.49, 0.35, 0.022), (2.5, FLOOR + 1.26, zb + 0.512), M["dark"], 0.025, col)
    cube("ATM | card reader", (0.15, 0.035, 0.055), (2.5, FLOOR + 0.76, zb + 0.29), M["black"], 0.01, col)
    cube("ATM | receipt slot", (0.18, 0.025, 0.012), (2.5, FLOOR + 0.48, zb + 0.509), M["dark"], 0.004, col)
    cube("ATM | red light strip", (0.60, 0.18, 0.028), (2.5, FLOOR + 1.67, zb + 0.51), M["orange"], 0.016, col)
    # Copier/printer.
    cube("Copier | lower cabinet", (0.90, 0.95, 0.60), (3.45, FLOOR + 0.475, zb + 0.30), M["white"], 0.04, col)
    cube("Copier | glass top", (0.84, 0.025, 0.47), (3.45, FLOOR + 0.98, zb + 0.28), M["screen"], 0.015, col)
    cube("Copier | control panel", (0.34, 0.16, 0.018), (3.73, FLOOR + 0.67, zb + 0.608), M["navy"], 0.014, col)
    cube("Copier | paper output", (0.28, 0.045, 0.12), (3.45, FLOOR + 0.58, zb + 0.49), M["dark"], 0.01, col)
    # Parcel locker carcass: animated individual doors from TypeScript remain in front of these cells.
    x0, w, y0, ch = 4.12, 0.96, FLOOR + 0.05, 1.66 / 5
    cube("Parcel locker | case", (w, 1.95, 0.50), (x0 + w / 2, FLOOR + 0.975, zb + 0.25), M["steel"], 0.035, col)
    for c in range(3):
        for r in range(5):
            if c == 1 and r in (2, 3):
                continue
            cx = x0 + (c + 0.5) * w / 3
            cy = y0 + r * ch + ch / 2
            cube(f"Parcel locker | recessed bay {r * 3 + c + 1}", (w / 3 - 0.035, ch - 0.035, 0.012), (cx, cy, zb + 0.507), M["dark"], 0.01, col)
    cube("Parcel locker | touch terminal", (0.22, 0.38, 0.035), (x0 + w / 2, FLOOR + 0.95, zb + 0.53), M["black"], 0.018, col)
    cube("Parcel locker | blue screen", (0.15, 0.18, 0.014), (x0 + w / 2, FLOOR + 1.02, zb + 0.554), M["navy"], 0.01, col)
    # Chest freezer under the animated glass sliding lids.
    x0, x1, z0, z1 = 2.3, 3.6, -9.4, -8.5
    cube("Chest freezer | insulated body", (x1 - x0, 0.73, z1 - z0), ((x0 + x1) / 2, FLOOR + 0.365, (z0 + z1) / 2), M["white"], 0.045, col)
    cube("Chest freezer | blue bumper", (x1 - x0 + 0.02, 0.12, z1 - z0 + 0.025), ((x0 + x1) / 2, FLOOR + 0.30, (z0 + z1) / 2), M["navy"], 0.022, col)
    cube("Chest freezer | inner cavity", (x1 - x0 - 0.16, 0.09, z1 - z0 - 0.16), ((x0 + x1) / 2, FLOOR + 0.72, (z0 + z1) / 2), M["dark"], 0.015, col)


def create_stockroom(M: dict[str, bpy.types.Material], col: bpy.types.Collection) -> None:
    # A restrained staff-side smoke cabinet behind checkout.
    cube("Staff cabinet | body", (0.30, 0.90, 2.55), (6.78, FLOOR + 0.45, -5.8), M["porcelain"], 0.025, col)
    cube("Staff cabinet | black base", (0.34, 0.13, 2.60), (6.78, FLOOR + 0.065, -5.8), M["dark"], 0.018, col)
    cube("Staff cabinet | product display face", (0.018, 1.05, 2.40), (6.615, FLOOR + 0.98, -5.8), M["navy"], 0.01, col)
    # Simple cigarette pack blocks are behind the dark glass and do not replace active goods.
    for row in range(4):
        for i in range(12):
            z = -6.86 + i * 0.19
            y = FLOOR + 0.54 + row * 0.22
            cube(f"Staff cabinet | pack {row}-{i}", (0.04, 0.16, 0.12), (6.595, y, z), M["paper" if row % 2 else "white"], 0.006, col)
    # A couple of tidy delivery cartons in the staff corner.
    cube("Stock carton | lower", (0.48, 0.38, 0.40), (6.4, FLOOR + 0.19, -10.4), M["wood"], 0.018, col)
    cube("Stock carton | upper", (0.44, 0.30, 0.37), (6.42, FLOOR + 0.53, -10.42), M["paper"], 0.018, col)
    for x in (6.26, 6.54):
        cube("Stock carton | tape", (0.04, 0.005, 0.39), (x, FLOOR + 0.385, -10.4), M["orange"], 0.002, col)


def create_room_shell(room: bpy.types.Collection, M: dict[str, bpy.types.Material]) -> None:
    # Shell is used to bake realistic indirect lighting and to render a preview, but
    # deliberately excluded from the GLB because the interactive game already owns it.
    cube("Bake room | rear wall", (15, 3.1, 0.22), (-0.5, 1.85, -12.02), M["porcelain"], 0.0, room)
    cube("Bake room | left wall", (0.22, 3.1, 10), (-8.02, 1.85, -7), M["porcelain"], 0.0, room)
    cube("Bake room | right wall", (0.22, 3.1, 10), (7.02, 1.85, -7), M["porcelain"], 0.0, room)
    cube("Bake room | ceiling", (15, 0.12, 10), (-0.5, 3.26, -7), M["white"], 0.0, room)
    floor = cube("Bake room | floor", (15, 0.12, 10), (-0.5, 0.22, -7), M["white"], 0.0, room)
    # Floor is for the preview only: the in-game tile shader remains in charge.
    floor.hide_render = False


def setup_lights_and_camera(room: bpy.types.Collection) -> None:
    world = bpy.data.worlds.new("Warm shop ambient")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.42, 0.46, 0.54, 1)
    bg.inputs["Strength"].default_value = 0.24
    bpy.context.scene.view_settings.view_transform = "AgX"
    bpy.context.scene.view_settings.look = "AgX - Medium High Contrast"

    for i, (x, z, power) in enumerate(((-4.8, -7.0, 130), (0.2, -7.0, 145), (4.8, -6.0, 130))):
        data = bpy.data.lights.new(f"Fluorescent softbox {i + 1}", type="AREA")
        data.energy = power
        data.shape = "RECTANGLE"
        data.size = 2.0
        data.size_y = 0.55
        obj = bpy.data.objects.new(data.name, data)
        room.objects.link(obj)
        obj.location = (x, -z, 2.88)
        obj.rotation_euler = (0, 0, 0)
    cam_data = bpy.data.cameras.new("First person interior preview")
    cam = bpy.data.objects.new(cam_data.name, cam_data)
    room.objects.link(cam)
    cam.location = (1.0, 1.6, 1.73)
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = Vector((0, 1, 0)).to_track_quat("-Z", "Y")
    cam_data.lens = 20
    bpy.context.scene.camera = cam


def set_first_person_preview_view() -> None:
    """Aim the saved Blender viewport like the included eye-height render."""
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue
            space = area.spaces.active
            rv3d = space.region_3d
            rv3d.view_location = Vector((0, 7, 1.7))  # Blender coordinates: game z=-7
            rv3d.view_distance = 12.5
            rv3d.view_perspective = "PERSP"
            rv3d.view_rotation = Vector((0, -1, -0.03)).to_track_quat("-Z", "Y")


def bake_static_fixture_atlas(fixture_col: bpy.types.Collection) -> bpy.types.Object:
    meshes = [o for o in fixture_col.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    active = meshes[0]
    bpy.context.view_layer.objects.active = active
    bpy.ops.object.join()
    baked = bpy.context.object
    baked.name = "Konbini | baked static fixtures"
    # A single non-overlapping UV atlas makes the baked light/material map stable in WebGL.
    if baked.data.uv_layers:
        baked.data.uv_layers.active.name = "UVMap"
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(island_margin=0.012, area_weight=0.25, correct_aspect=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    baked.data.uv_layers.active.name = "UVMap"

    img = bpy.data.images.new("Konbini fixtures | baked diffuse", width=1024, height=1024, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "sRGB"
    for mat in baked.data.materials:
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        image_node = nodes.new("ShaderNodeTexImage")
        image_node.name = "Konbini baked atlas"
        image_node.image = img
        nodes.active = image_node
        bsdf = nodes.get("Principled BSDF")

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 8
    scene.cycles.use_denoising = True
    scene.render.bake.margin = 8
    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.use_pass_color = True
    bpy.ops.object.select_all(action="DESELECT")
    baked.select_set(True)
    bpy.context.view_layer.objects.active = baked
    print("Baking combined fixture lighting in Cycles…", flush=True)
    bpy.ops.object.bake(type="COMBINED")
    img.filepath_raw = str(OUT / "interior-lighting.png")
    img.file_format = "PNG"
    img.save()

    # Store the combined static light and materials in the base-color atlas. The
    # game loads these fixtures unlit so fixed light/shadow detail stays stable
    # as the first-person camera moves and the shadow map remains unchanged.
    for index, old in enumerate(list(baked.data.materials)):
        new = bpy.data.materials.new(f"Baked | {old.name}")
        new.use_nodes = True
        nodes = new.node_tree.nodes
        bsdf = nodes.get("Principled BSDF")
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.interpolation = "Linear"
        new.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.78
        bsdf.inputs["Metallic"].default_value = 0.0
        baked.data.materials[index] = new
    return baked


def main() -> None:
    clear_scene()
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    mats = create_materials()
    fixture_col = bpy.data.collections.new("Export | static interior fixtures")
    scene.collection.children.link(fixture_col)
    room_col = bpy.data.collections.new("Bake and render only | room shell, lights, camera")
    scene.collection.children.link(room_col)

    create_gondola(mats, fixture_col, -4.75, 1)
    create_gondola(mats, fixture_col, -7.0, 2)
    create_gondola(mats, fixture_col, -9.3, 3)
    create_cooler(mats, fixture_col)
    create_deli_case(mats, fixture_col)
    create_magazine_rack(mats, fixture_col)
    create_counter(mats, fixture_col)
    create_self_service(mats, fixture_col)
    create_back_corner(mats, fixture_col)
    create_stockroom(mats, fixture_col)
    create_room_shell(room_col, mats)
    setup_lights_and_camera(room_col)
    set_first_person_preview_view()

    # Bake while the model is still in the scene with the room around it.
    baked = bake_static_fixture_atlas(fixture_col)
    baked["konbini_asset"] = "static fixtures with Cycles combined-light bake"
    for obj in fixture_col.objects:
        if obj.type == "MESH":
            obj.select_set(False)
    baked.select_set(True)
    bpy.context.view_layer.objects.active = baked

    # Export only the joined fixture mesh; runtime room surfaces and animation proxies stay in TypeScript.
    bpy.ops.export_scene.gltf(
        filepath=str(GLB),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )

    # Save an editable Blender source and render a matching eye-height first-person preview.
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.cycles.samples = 24
    scene.render.filepath = str(PREVIEW)
    bpy.context.view_layer.objects.active = baked
    print("Rendering first-person Blender preview…", flush=True)
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    print(f"Created {GLB}", flush=True)
    print(f"Created {BLEND}", flush=True)
    print(f"Created {PREVIEW}", flush=True)


if __name__ == "__main__":
    main()
