"""Create Blender product models used by the Konbini runtime.

The fixture pack owns the shelves and counters. This pack owns the individual
products so the game can clone a Blender-made snack, bottle, can, and the other
stock items while keeping each item's existing interaction box and inventory data.
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "konbini"
BLEND = ROOT / "assets" / "blender" / "konbini-products.blend"
GLB = OUT / "product-templates.glb"
PREVIEW = ROOT / ".logs" / "shots" / "konbini-products-preview.png"
OUT.mkdir(parents=True, exist_ok=True)
BLEND.parent.mkdir(parents=True, exist_ok=True)
PREVIEW.parent.mkdir(parents=True, exist_ok=True)


def clear() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.materials, bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for item in list(datablocks):
            if item.users == 0:
                datablocks.remove(item)


def mat(name: str, color: tuple[float, float, float], roughness: float = 0.52, metal: float = 0.0) -> bpy.types.Material:
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1.0)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metal
    return m


def cube(name: str, dims: tuple[float, float, float], loc: tuple[float, float, float], material: bpy.types.Material,
         bevel: float = 0.004) -> bpy.types.Object:
    # Product coordinates use the game's X/Y/Z convention; Blender stores Z up.
    x, y, z = loc
    w, h, d = dims
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (w, d, h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    if bevel:
        mod = obj.modifiers.new("Soft package edge", "BEVEL")
        mod.width = min(bevel, min(dims) * 0.2)
        mod.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def cyl(name: str, radius: float, height: float, loc: tuple[float, float, float], material: bpy.types.Material,
        vertices: int = 16) -> bpy.types.Object:
    x, y, z = loc
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=height, location=(x, -z, y + height / 2))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def join_parts(parts: list[bpy.types.Object], name: str) -> bpy.types.Object:
    # Bake component offsets into local vertices so the origin stays at the
    # product's bottom center after joining.
    for part in parts:
        bpy.ops.object.select_all(action="DESELECT")
        part.select_set(True)
        bpy.context.view_layer.objects.active = part
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    return obj


def product(kind: str, variant: int, colors: dict[str, list[tuple[float, float, float]]], common: dict[str, bpy.types.Material]) -> bpy.types.Object:
    c = common
    accent = mat(f"Blender product {kind} {variant} label", colors[kind][variant % len(colors[kind])], 0.46)
    parts: list[bpy.types.Object] = []
    if kind == "snack":
        w, h, d = 0.17, 0.24, 0.07
        parts += [cube("snack body", (w, h * 0.86, d), (0, 0.01, 0), accent, 0.008)]
        parts += [cube("snack face label", (w * 0.86, h * 0.52, 0.004), (0, 0.075, d / 2 + 0.003), c["label"], 0.002)]
        parts += [cube("snack top seal", (w * 1.01, 0.018, d * 0.72), (0, h * 0.225, 0), c["silver"], 0.002)]
    elif kind == "bottle":
        r, h = 0.0375, 0.24
        parts += [cyl("bottle liquid", r, h * 0.58, (0, 0, 0), accent, 16)]
        parts += [cyl("bottle label", r * 1.015, h * 0.28, (0, h * 0.16, 0), c["label"], 16)]
        parts += [cyl("bottle neck", r * 0.42, h * 0.16, (0, h * 0.58, 0), accent, 16)]
        parts += [cyl("bottle cap", r * 0.48, h * 0.08, (0, h * 0.84, 0), c["silver"], 12)]
    elif kind == "can":
        r, h = 0.033, 0.12
        parts += [cyl("can body", r, h * 0.86, (0, 0, 0), accent, 16)]
        parts += [cyl("can top", r * 0.82, h * 0.07, (0, h * 0.86, 0), c["silver"], 16)]
        parts += [cyl("can bottom", r * 0.84, h * 0.07, (0, 0, 0), c["silver"], 16)]
    elif kind in ("bread", "sweet", "daily", "mag"):
        dims = {"bread": (0.14, 0.13, 0.07), "sweet": (0.11, 0.08, 0.08), "daily": (0.12, 0.12, 0.1), "mag": (0.2, 0.27, 0.012)}[kind]
        parts += [cube(f"{kind} body", dims, (0, 0, 0), accent, 0.006)]
        parts += [cube(f"{kind} face", (dims[0] * 0.85, dims[1] * 0.68, 0.004), (0, dims[1] * 0.12, dims[2] / 2 + 0.003), c["label"], 0.002)]
    elif kind == "onigiri":
        w, h, d = 0.11, 0.1, 0.045
        parts += [cube("onigiri rice", (w, h, d), (0, 0, 0), c["white"], 0.018)]
        parts += [cube("onigiri seaweed", (w * 0.9, h * 0.32, d * 1.02), (0, 0.005, d / 2 + 0.002), accent, 0.003)]
    elif kind == "bento":
        w, h, d = 0.21, 0.06, 0.15
        parts += [cube("bento tray", (w, h * 0.66, d), (0, 0, 0), c["black"], 0.006)]
        parts += [cube("bento lid", (w * 0.96, h * 0.34, d * 0.96), (0, h * 0.66, 0), accent, 0.004)]
    elif kind == "noodle":
        r, h = 0.06, 0.11
        parts += [cyl("noodle cup", r, h * 0.93, (0, 0, 0), accent, 16)]
        parts += [cyl("noodle lid", r * 1.02, h * 0.07, (0, h * 0.93, 0), c["silver"], 16)]
    elif kind == "ice":
        parts += [cube("ice bar", (0.06, 0.14, 0.03), (0, 0, 0), accent, 0.005)]
    elif kind == "cup":
        parts += [cyl("coffee cup", 0.04, 0.1, (0, 0, 0), c["white"], 16)]
        parts += [cyl("coffee lid", 0.041, 0.012, (0, 0.1, 0), c["black"], 16)]
    model = join_parts(parts, f"Blender product | {kind}-{variant}")
    model.location = (variant * 0.3, 0, 0)
    model["product_key"] = f"{kind}-{variant}"
    model["origin_rule"] = "bottom-center"
    return model


def main() -> None:
    clear()
    mats = {
        "label": mat("printed product label", (0.95, 0.94, 0.88), 0.68),
        "silver": mat("aluminium and foil", (0.58, 0.62, 0.66), 0.25, 0.55),
        "white": mat("white food packaging", (0.9, 0.9, 0.86), 0.5),
        "black": mat("black food tray", (0.025, 0.03, 0.04), 0.4),
    }
    colors = {
        "snack": [(0.83, 0.14, 0.08), (0.1, 0.3, 0.72), (0.8, 0.46, 0.05), (0.2, 0.55, 0.22), (0.45, 0.12, 0.6), (0.75, 0.68, 0.08)],
        "bread": [(0.76, 0.45, 0.18), (0.92, 0.75, 0.32), (0.4, 0.18, 0.08), (0.7, 0.2, 0.18), (0.25, 0.5, 0.35)],
        "bottle": [(0.18, 0.5, 0.2), (0.88, 0.75, 0.12), (0.5, 0.08, 0.05), (0.95, 0.45, 0.08), (0.2, 0.42, 0.76), (0.72, 0.52, 0.22), (0.18, 0.68, 0.76), (0.35, 0.2, 0.1)],
        "can": [(0.86, 0.12, 0.12), (0.1, 0.25, 0.65), (0.1, 0.55, 0.32), (0.82, 0.52, 0.06), (0.45, 0.12, 0.54), (0.1, 0.56, 0.68), (0.8, 0.8, 0.82), (0.2, 0.2, 0.24)],
        "onigiri": [(0.1, 0.1, 0.12)], "bento": [(0.78, 0.68, 0.3)], "noodle": [(0.83, 0.14, 0.08), (0.1, 0.35, 0.7), (0.9, 0.65, 0.08), (0.15, 0.48, 0.25)],
        "sweet": [(0.85, 0.3, 0.55), (0.2, 0.35, 0.75), (0.9, 0.6, 0.15), (0.3, 0.7, 0.5), (0.65, 0.2, 0.65), (0.85, 0.2, 0.18)],
        "daily": [(0.8, 0.4, 0.12), (0.2, 0.45, 0.7), (0.25, 0.65, 0.34), (0.65, 0.25, 0.2)],
        "mag": [(0.12, 0.3, 0.65), (0.75, 0.15, 0.12), (0.18, 0.55, 0.35), (0.7, 0.48, 0.08), (0.45, 0.2, 0.68), (0.18, 0.5, 0.65), (0.75, 0.3, 0.12), (0.28, 0.28, 0.3)],
        "ice": [(0.9, 0.25, 0.5)], "cup": [(0.55, 0.23, 0.12)],
    }
    counts = {"snack": 6, "bread": 5, "bottle": 8, "can": 8, "onigiri": 6, "bento": 4, "noodle": 4, "mag": 8, "sweet": 6, "daily": 4, "ice": 1, "cup": 1}
    created: list[bpy.types.Object] = []
    for kind, count in counts.items():
        for v in range(count):
            created.append(product(kind, v, colors, mats))

    # A small Blender render of representative snack/drink models for review.
    bpy.ops.object.camera_add(location=(0.3, -1.2, 0.23))
    cam = bpy.context.object
    cam.rotation_mode = "QUATERNION"
    from mathutils import Vector
    cam.rotation_quaternion = Vector((0.3, 0.25, 0.09)).to_track_quat("-Z", "Y")
    cam.data.lens = 52
    bpy.context.scene.camera = cam
    world = bpy.data.worlds.new("Product studio")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.035, 0.05, 0.08, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
    bpy.ops.object.light_add(type="AREA", location=(0, -0.3, 0.8))
    bpy.context.object.data.energy = 250
    bpy.context.object.data.shape = "DISK"
    bpy.context.object.data.size = 1.2
    bpy.context.object.rotation_euler[0] = 0
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 360
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW)
    bpy.ops.render.render(write_still=True)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in created:
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = created[0]
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_texcoords=True, export_normals=True, export_materials="EXPORT")
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    print(f"Created {GLB}")
    print(f"Created {BLEND}")
    print(f"Created {PREVIEW}")


if __name__ == "__main__":
    main()
