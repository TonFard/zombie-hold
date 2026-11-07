"""Procedural surface textures for the post-outbreak konbini scene.

The first pass of this scene used flat Principled colours only, and the result
read as untextured plastic: every slab was a single value with no roughness
break-up, so the wet night lighting produced flat, dead surfaces.

This module bakes real texture images with numpy and feeds them into the
materials as regular image textures. That keeps the glTF export lossless
(Blender bakes the maps into the exported texture set) while giving the render
the surface break-up the brief asks for: "roughness variation, subtle
normal/bump detail, edge wear, and restrained reflections".

Every generator returns a ``bpy.types.Image`` with generated (non-colour)
pixels, so the caller can plug it into a Color / Roughness / Normal input.
"""
from __future__ import annotations

import math
import os

import bpy
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
TEXTURE_DIR = os.path.join(ROOT, "assets", "blender", "textures")

# --------------------------------------------------------------------------- noise


def _value_noise(size: int, freq: int, seed: int) -> np.ndarray:
    """Tileable value noise in [0, 1]."""
    rng = np.random.default_rng(seed)
    grid = rng.random((freq, freq)).astype(np.float32)
    # Tile by wrapping the lattice.
    grid = np.pad(grid, ((1, 0), (1, 0)), mode="wrap")

    coords = np.linspace(0.0, freq, size, endpoint=False, dtype=np.float32)
    fx = coords
    fy = coords
    x0 = np.floor(fx).astype(np.int32)
    y0 = np.floor(fy).astype(np.int32)
    tx = fx - x0
    ty = fy - y0
    # Smoothstep for C1 continuity.
    tx = tx * tx * (3.0 - 2.0 * tx)
    ty = ty * ty * (3.0 - 2.0 * ty)

    v00 = grid[np.ix_(y0, x0)]
    v10 = grid[np.ix_(y0, x0 + 1)]
    v01 = grid[np.ix_(y0 + 1, x0)]
    v11 = grid[np.ix_(y0 + 1, x0 + 1)]

    top = v00 * (1 - tx)[None, :] + v10 * tx[None, :]
    bot = v01 * (1 - tx)[None, :] + v11 * tx[None, :]
    out = top * (1 - ty)[:, None] + bot * ty[:, None]
    return out


def fbm(size: int, base_freq: int, octaves: int, seed: int,
        gain: float = 0.5, lacunarity: float = 2.0) -> np.ndarray:
    """Fractal sum of value noise, normalised to [0, 1]."""
    total = np.zeros((size, size), dtype=np.float32)
    amp = 1.0
    freq = base_freq
    norm = 0.0
    for octave in range(octaves):
        total += amp * _value_noise(size, max(1, int(freq)), seed + octave * 977)
        norm += amp
        amp *= gain
        freq *= lacunarity
    total /= norm
    lo, hi = float(total.min()), float(total.max())
    if hi - lo > 1e-6:
        total = (total - lo) / (hi - lo)
    return total


def _normal_from_height(height: np.ndarray, strength: float) -> np.ndarray:
    """Tangent-space normal map (RGB) derived from a height field."""
    dy, dx = np.gradient(height.astype(np.float32))
    dx = dx * strength
    dy = dy * strength
    normals = np.stack([-dx, -dy, np.ones_like(dx)], axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    return normals * 0.5 + 0.5


def _make_image(name: str, pixels: np.ndarray, non_color: bool = True) -> bpy.types.Image:
    """Create a Blender image from an (H, W, C) float array in [0, 1].

    The pixels are written to a PNG on disk and the file is packed into the
    blend, so the image survives the glTF export (the exporter only writes
    images that have a file behind them).
    """
    height, width, channels = pixels.shape
    if channels == 1:
        pixels = np.repeat(pixels[:, :, None], 3, axis=2)
    rgba = np.ones((height, width, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(pixels[:, :, :3], 0.0, 1.0)

    image = bpy.data.images.new(name, width=width, height=height, alpha=False)
    # Blender images are bottom-up; numpy rows are top-down.
    image.pixels.foreach_set(rgba[::-1].reshape(-1))
    image.update()
    if non_color:
        image.colorspace_settings.name = "Non-Color"

    os.makedirs(TEXTURE_DIR, exist_ok=True)
    path = os.path.join(TEXTURE_DIR, name.replace(" ", "_") + ".png")
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    image.pack()
    return image


# --------------------------------------------------------------------------- generators

def concrete(size: int = 512, seed: int = 11) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Stained poured concrete: albedo, roughness, normal."""
    grain = fbm(size, 8, 5, seed)
    blotch = fbm(size, 3, 3, seed + 31)
    pores = fbm(size, 64, 2, seed + 57)
    height = grain * 0.55 + blotch * 0.35 + pores * 0.10
    # Rain runnels: vertical streaks that darken the albedo.
    streaks = fbm(size, 48, 2, seed + 91)
    runnel = np.clip(streaks * 1.6 - 0.75, 0.0, 1.0)
    albedo = 0.30 + grain * 0.16 - blotch * 0.09 - runnel * 0.16
    albedo = np.clip(albedo, 0.0, 1.0)
    rough = np.clip(0.86 + blotch * 0.12 - runnel * 0.20, 0.35, 1.0)
    return (np.repeat(albedo[:, :, None], 3, axis=2),
            np.repeat(rough[:, :, None], 3, axis=2),
            _normal_from_height(height, 2.4))


def asphalt(size: int = 512, seed: int = 23) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Coarse aggregate asphalt with patchy repairs and a wet sheen."""
    aggregate = fbm(size, 96, 3, seed)
    coarse = fbm(size, 10, 4, seed + 13)
    patch = fbm(size, 4, 2, seed + 71)
    height = aggregate * 0.62 + coarse * 0.38
    albedo = 0.055 + aggregate * 0.075 + coarse * 0.035 - patch * 0.020
    albedo = np.clip(albedo, 0.0, 1.0)
    # Damp asphalt is unevenly glossy: the roughness is the main visual cue.
    rough = np.clip(0.52 + coarse * 0.36 - patch * 0.10, 0.18, 1.0)
    return (np.repeat(albedo[:, :, None], 3, axis=2),
            np.repeat(rough[:, :, None], 3, axis=2),
            _normal_from_height(height, 3.2))


def painted_metal(size: int = 512, seed: int = 37) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Chipped enamel over steel: colour, roughness, normal."""
    chips = fbm(size, 24, 4, seed)
    scratches = fbm(size, 120, 2, seed + 19)
    dirt = fbm(size, 5, 3, seed + 43)
    height = chips * 0.35 + scratches * 0.65
    # Exposed steel where the paint has flaked.
    bare = np.clip(chips * 1.9 - 1.05, 0.0, 1.0)
    albedo = 0.62 - dirt * 0.30 - bare * 0.24 + scratches * 0.10
    albedo = np.clip(albedo, 0.0, 1.0)
    rough = np.clip(0.44 + chips * 0.30 + bare * 0.16, 0.20, 1.0)
    return (np.repeat(albedo[:, :, None], 3, axis=2),
            np.repeat(rough[:, :, None], 3, axis=2),
            _normal_from_height(height, 2.0))


def tile_floor(size: int = 512, seed: int = 53) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Worn vinyl tile with grout lines and scuffing."""
    grid = 8
    yy, xx = np.mgrid[0:size, 0:size]
    tx = (xx * grid // size)
    ty = (yy * grid // size)
    grout = ((xx % (size // grid)) < 2) | ((yy % (size // grid)) < 2)
    tile_id = ((tx * 7 + ty * 13) % 5).astype(np.float32) / 5.0
    wear = fbm(size, 6, 4, seed)
    scuff = fbm(size, 40, 2, seed + 29)
    height = np.where(grout, 0.0, 0.6) + wear * 0.25
    albedo = 0.30 + tile_id * 0.05 + wear * 0.10 - np.where(grout, 0.20, 0.0)
    albedo = np.clip(albedo, 0.0, 1.0)
    rough = np.clip(0.52 + wear * 0.24 + scuff * 0.12 + np.where(grout, 0.20, 0.0), 0.2, 1.0)
    return (np.repeat(albedo[:, :, None], 3, axis=2),
            np.repeat(rough[:, :, None], 3, axis=2),
            _normal_from_height(height, 1.8))


def cardboard(size: int = 512, seed: int = 67) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Damp corrugated cardboard: fibre texture and water staining."""
    fibre = fbm(size, 128, 2, seed)
    board = fbm(size, 7, 3, seed + 17)
    damp = fbm(size, 4, 3, seed + 61)
    height = fibre * 0.30 + board * 0.70
    albedo = 0.34 + fibre * 0.12 - damp * 0.18
    albedo = np.clip(albedo, 0.0, 1.0)
    rough = np.clip(0.90 + damp * 0.08, 0.55, 1.0)
    return (np.repeat(albedo[:, :, None], 3, axis=2),
            np.repeat(rough[:, :, None], 3, axis=2),
            _normal_from_height(height, 1.6))


def brushed_steel(size: int = 512, seed: int = 79) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Brushed aluminium: fine horizontal grain."""
    rng = np.random.default_rng(seed)
    rows = rng.random((size, 1)).astype(np.float32)
    rows = np.repeat(rows, size, axis=1)
    grain = rows * 0.55 + fbm(size, 100, 2, seed + 5) * 0.45
    height = grain * 0.5
    albedo = np.clip(0.55 + grain * 0.16, 0.0, 1.0)
    rough = np.clip(0.26 + grain * 0.20, 0.10, 0.70)
    return (np.repeat(albedo[:, :, None], 3, axis=2),
            np.repeat(rough[:, :, None], 3, axis=2),
            _normal_from_height(height, 0.9))


def corrugated(size: int = 512, seed: int = 83) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Perforated shelf back panel: dimples plus powder-coat speckle."""
    yy, xx = np.mgrid[0:size, 0:size]
    hole = 6
    hx = (xx % (size // hole)) - (size // hole) // 2
    hy = (yy % (size // hole)) - (size // hole) // 2
    dist = np.sqrt(hx * hx + hy * hy)
    hole_mask = np.clip(1.0 - dist / (size // hole * 0.30), 0.0, 1.0)
    speck = fbm(size, 80, 3, seed)
    height = hole_mask * 0.85 + speck * 0.15
    albedo = np.clip(0.42 - hole_mask * 0.22 + speck * 0.10, 0.0, 1.0)
    rough = np.clip(0.52 + speck * 0.26, 0.25, 1.0)
    return (np.repeat(albedo[:, :, None], 3, axis=2),
            np.repeat(rough[:, :, None], 3, axis=2),
            _normal_from_height(height, 2.6))


def grime_stain(size: int = 256, seed: int = 97) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Generic dirt / soot overlay."""
    blotch = fbm(size, 5, 4, seed)
    fine = fbm(size, 40, 2, seed + 11)
    height = blotch * 0.7 + fine * 0.3
    albedo = np.clip(0.20 + blotch * 0.22 + fine * 0.06, 0.0, 1.0)
    rough = np.clip(0.88 + fine * 0.10, 0.5, 1.0)
    return (np.repeat(albedo[:, :, None], 3, axis=2),
            np.repeat(rough[:, :, None], 3, axis=2),
            _normal_from_height(height, 1.1))


# --------------------------------------------------------------------------- wiring

def _texture_node(nodes, image: bpy.types.Image, location, label: str):
    node = nodes.new("ShaderNodeTexImage")
    node.image = image
    node.location = location
    node.label = label
    node.interpolation = "Smart"
    node.extension = "REPEAT"
    return node


def _mapping(nodes, location, scale=(1.0, 1.0, 1.0)):
    node = nodes.new("ShaderNodeMapping")
    node.location = location
    node.inputs["Scale"].default_value = scale
    return node


def textured_material(name: str, base_color, roughness: float, metallic: float = 0.0,
                      maps: dict | None = None, tex_scale=(1.0, 1.0, 1.0),
                      emission=None, emission_strength: float = 0.0,
                      alpha: float = 1.0) -> bpy.types.Material:
    """Build a Principled material with optional albedo / roughness / normal maps.

    ``maps`` accepts the keys ``albedo``, ``rough`` and ``normal``; each value
    is a ``bpy.types.Image``. The maps multiply (albedo) or replace (roughness,
    normal) the flat values, which keeps the material readable even if a map
    fails to load.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")

    maps = maps or {}
    if "albedo" in maps:
        tex = _texture_node(nodes, maps["albedo"], (-760, 320), "albedo")
        mapping = _mapping(nodes, (-960, 320), tex_scale)
        links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
        mix = nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MULTIPLY"
        mix.location = (-460, 320)
        mix.inputs["Fac"].default_value = 1.0
        mix.inputs["Color1"].default_value = (*base_color, 1.0)
        links.new(tex.outputs["Color"], mix.inputs["Color2"])
        links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)

    if "rough" in maps:
        tex = _texture_node(nodes, maps["rough"], (-760, 20), "roughness")
        mapping = _mapping(nodes, (-960, 20), tex_scale)
        links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
        ramp = nodes.new("ShaderNodeMapRange")
        ramp.location = (-460, 20)
        ramp.inputs["From Min"].default_value = 0.0
        ramp.inputs["From Max"].default_value = 1.0
        ramp.inputs["To Min"].default_value = max(0.02, roughness - 0.28)
        ramp.inputs["To Max"].default_value = min(1.0, roughness + 0.28)
        links.new(tex.outputs["Color"], ramp.inputs["Value"])
        links.new(ramp.outputs["Result"], bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Roughness"].default_value = roughness

    if "normal" in maps:
        tex = _texture_node(nodes, maps["normal"], (-760, -300), "normal")
        mapping = _mapping(nodes, (-960, -300), tex_scale)
        links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
        normal = nodes.new("ShaderNodeNormalMap")
        normal.location = (-460, -300)
        normal.inputs["Strength"].default_value = 0.65
        links.new(tex.outputs["Color"], normal.inputs["Color"])
        links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])

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
    mat.diffuse_color = (*base_color, 1.0)
    return mat
