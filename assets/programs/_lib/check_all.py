"""Check every exported atom against the size its descriptor claims.

    conda run -n sand3d python assets/programs/_lib/check_all.py

Three things go wrong in an atom library, and all three are silent:

* the program exports at the wrong scale (a 1200 mm table that ends up 12 m);
* the descriptor and the mesh disagree (the manifest says 1.2 m, the GLB says 0.012 m);
* an atom is missing its GLB, or its file was renamed.

This script fails on all three. It is the gate the whole library goes through
before the runtime manifest is trusted.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from check_glb import bounds, read_glb  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
MODEL_DIR = os.path.join(ROOT, "assets", "models")

#: 允许的误差：GLB 的包围盒是 AABB，程序里的 size_m 是标称尺寸。
TOLERANCE = 0.02  # 2 cm，绝对值


def check_one(path: str, info: dict) -> list:
    problems = []
    doc = read_glb(path)
    lo, hi = bounds(doc["json"])
    actual = [hi[i] - lo[i] for i in range(3)]

    claimed = info.get("size_m") or [0, 0, 0]
    for i, axis in enumerate("xyz"):
        want = claimed[i]
        got = actual[i]
        if abs(want - got) > max(TOLERANCE, abs(want) * 0.12):
            problems.append(
                f"{info['id']}: {axis} 尺寸不符：清单 {want:.4f} m，实际 {got:.4f} m")

    if not doc["json"].get("meshes"):
        problems.append(f"{info['id']}: GLB 里没有 mesh")
    return problems


def main() -> int:
    problems = []
    checked = 0
    for dirpath, _dirnames, filenames in os.walk(MODEL_DIR):
        for name in sorted(filenames):
            if not name.endswith(".json") or name.startswith("manifest-"):
                continue
            with open(os.path.join(dirpath, name), "r", encoding="utf-8") as fh:
                info = json.load(fh)
            if "id" not in info:
                continue
            glb = os.path.join(dirpath, name[:-5] + ".glb")
            if not os.path.exists(glb):
                problems.append(f"{info['id']}: 缺少 GLB（{os.path.relpath(glb, ROOT)}）")
                continue
            problems += check_one(glb, info)
            checked += 1

    print(f"检查了 {checked} 个原子")
    if problems:
        print(f"--- {len(problems)} 个问题 ---")
        for p in problems:
            print("  " + p)
        return 1
    print("全部通过：尺寸、mesh、文件都在")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
