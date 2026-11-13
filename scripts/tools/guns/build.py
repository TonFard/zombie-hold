"""Build the gun models: public/guns/<kind>.glb + public/guns/manifest.json, previews in .logs/guns/.

    blender -b --factory-startup --python scripts/tools/guns/build.py -- [kind ...] [--no-render] [--tiers 0,4,8]

Each gun lives in its own module (``build(g)`` adds the solids, ``info(tier)`` returns the grip / muzzle /
sight points the first-person view needs). The log goes to .logs/guns/build.log; a failure writes the
traceback there (Blender's own stdout is often swallowed by the shell).
"""
from __future__ import annotations

import importlib
import json
import math
import os
import sys
import traceback

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)

import kit  # noqa: E402

KINDS = ("pistol", "smg", "shotgun", "rifle", "sniper", "lmg")
OUT = os.path.join(ROOT, "public", "guns")
LOGS = os.path.join(ROOT, ".logs", "guns")


def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    kit._mats.clear()


def studio(scene) -> None:
    """Soft three-point lighting on a mid-grey backdrop: the same look as the in-game weapon bench."""
    for name, loc, energy, size, color in (
        ("key", (0.9, -1.1, 1.3), 90, 1.4, (1.0, 0.95, 0.88)),
        ("fill", (-1.2, -0.6, 0.5), 30, 1.8, (0.75, 0.85, 1.0)),
        ("rim", (-0.4, 1.3, 0.9), 70, 1.0, (0.8, 0.9, 1.0)),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.size = size
        data.color = color
        ob = bpy.data.objects.new(name, data)
        ob.location = loc
        ob.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(ob)
    world = bpy.data.worlds.new("studio")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.22, 0.24, 0.27, 1)
    bg.inputs["Strength"].default_value = 0.9
    scene.world = world
    engines = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    for e in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if e in engines:
            scene.render.engine = e
            break
    try:
        scene.eevee.taa_render_samples = 32
    except Exception:
        pass
    for vt in ("Standard",):
        try:
            scene.view_settings.view_transform = vt
        except Exception:
            pass
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 560
    scene.render.image_settings.file_format = "PNG"
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 85
    scene.collection.objects.link(cam)
    scene.camera = cam


def frame(scene, gun, yaw: float, pitch: float, zoom: float = 1.0, focus=None) -> None:
    """Aim the camera at the visible solids. yaw 0 = looking at the gun's left side (+X, what the player sees).
    zoom < 1 moves the camera closer; focus = a point in the weapon frame to look at instead of the centre."""
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in gun.objs:
        if ob.hide_render:
            continue
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    c = (lo + hi) / 2
    r = (hi - lo).length / 2
    cam = scene.camera
    fov = 2 * math.atan(36 / 2 / cam.data.lens) * (scene.render.resolution_y / scene.render.resolution_x)
    d = r / math.sin(fov / 2) * 0.62 * zoom
    if focus is not None:
        c = kit.to_bl(focus)
    # weapon +X is Blender +X; the muzzle (+Z weapon) is Blender -Y: put it on the right of the picture
    v = Vector((math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch)))
    cam.location = c + v * d
    cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()


def stats(gun, t: int) -> tuple[int, int]:
    tris = 0
    n = 0
    for ob in gun.objs:
        lo, hi = ob["tier"]
        if lo <= t <= hi:
            n += 1
            tris += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return tris, n


def build_one(kind: str, render: bool, tiers: list[int], log) -> dict:
    reset()
    mod = importlib.import_module(kind)
    importlib.reload(mod)
    gun = kit.Gun(kind)
    mod.build(gun)
    kit.join(gun)
    scene = bpy.context.scene
    if render:
        studio(scene)
        for t in tiers:
            kit.show_tier(gun, t)
            for tag, yaw, pitch, zoom, focus in (
                ("side", 0.0, 0.04, 1.0, None),
                ("q", 0.62, 0.3, 1.0, None),
                ("back", math.pi - 0.5, 0.25, 1.0, None),
                # close-ups: the receiver from the player's side, and from below (trigger guard, magazine well)
                ("mid", 0.3, 0.15, 0.4, (0, 0.0, 0.07)),
                ("under", 0.25, -0.5, 0.4, (0, -0.03, 0.07)),
            ):
                frame(scene, gun, yaw, pitch, zoom, focus)
                scene.render.filepath = os.path.join(LOGS, f"{kind}_t{t}_{tag}.png")
                bpy.ops.render.render(write_still=True)
    for ob in gun.objs:
        ob.hide_render = False
    kit.export_glb(gun, os.path.join(OUT, f"{kind}.glb"))
    per = {t: stats(gun, t) for t in range(kit.MAX_TIER + 1)}
    log(f"{kind}: {len(gun.objs)} nodes, triangles per tier {[per[t][0] for t in per]}, draw calls per tier {[per[t][1] for t in per]}, "
        f"{os.path.getsize(os.path.join(OUT, f'{kind}.glb')) // 1024} kB")
    return {
        "file": f"{kind}.glb",
        "parts": sorted({ob["part"] for ob in gun.objs if ob["part"] != "body"}),
        "tiers": [mod.info(t) for t in range(kit.MAX_TIER + 1)],
        "tris": [per[t][0] for t in per],
    }


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(LOGS, exist_ok=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    render = "--no-render" not in argv
    tiers = [0, 4, 8]
    if "--tiers" in argv:
        tiers = [int(x) for x in argv[argv.index("--tiers") + 1].split(",")]
    kinds = [a for a in argv if a in KINDS] or [k for k in KINDS if os.path.exists(os.path.join(HERE, f"{k}.py"))]
    path = os.path.join(OUT, "manifest.json")
    manifest = {"guns": {}}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            manifest = json.load(f)
    with open(os.path.join(LOGS, "build.log"), "w", encoding="utf-8") as lf:
        def log(msg: str) -> None:
            lf.write(msg + "\n")
            lf.flush()
            print(msg)
        ok = True
        for kind in kinds:
            try:
                manifest["guns"][kind] = build_one(kind, render, tiers, log)
            except Exception:
                ok = False
                log(f"{kind}: FAILED\n{traceback.format_exc()}")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=1)
        log("BUILD_OK" if ok else "BUILD_FAILED")


main()
