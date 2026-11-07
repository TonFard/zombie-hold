"""Check that an exported GLB has the size, materials and names the runtime expects.

    conda run -n sand3d python assets/programs/_lib/check_glb.py <file.glb>

The runtime loader places atoms by their real-world size, so a millimetre
program that exports as metres (or the other way round) is a silent bug that
only shows up as furniture the size of a football stadium.

sand3d exports millimetre programs with a 0.001 scale on each node, so the
bounds below are computed through the node transforms: what you read here is
what three.js will show.
"""
from __future__ import annotations

import json
import os
import struct
import sys


def read_glb(path: str) -> dict:
    """Parse the three GLB chunks without any third-party dependency."""
    with open(path, "rb") as fh:
        data = fh.read()
    magic, version, total = struct.unpack("<4sII", data[:12])
    if magic != b"glTF":
        raise ValueError(f"{path} is not a GLB")
    chunks = {}
    off = 12
    while off < total:
        length, kind = struct.unpack("<I4s", data[off:off + 8])
        chunks[kind.decode()] = data[off + 8:off + 8 + length]
        off += 8 + length
    return {"version": version, "json": json.loads(chunks["JSON"]), "bin": chunks.get("BIN\0", b"")}


def _mat4(node: dict) -> list:
    """A node's local matrix as a column-major 4x4 (glTF convention)."""
    if "matrix" in node:
        return node["matrix"]
    t = node.get("translation", [0, 0, 0])
    r = node.get("rotation", [0, 0, 0, 1])
    s = node.get("scale", [1, 1, 1])
    x, y, z, w = r
    # rotation, row-major
    rot = (
        (1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)),
        (2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)),
        (2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)),
    )
    out = [0.0] * 16
    for col in range(3):
        for row in range(3):
            out[col * 4 + row] = rot[row][col] * s[col]
    out[12], out[13], out[14] = t
    out[15] = 1.0
    return out


def _apply(m: list, v: list) -> list:
    return [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
        m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
    ]


def _children(doc: dict) -> dict:
    """node index -> list of child node indices"""
    out: dict = {i: [] for i in range(len(doc.get("nodes", [])))}
    for i, node in enumerate(doc.get("nodes", [])):
        for c in node.get("children", []):
            out.setdefault(i, []).append(c)
    return out


def _multiply(a: list, b: list) -> list:
    """Column-major 4x4 multiply: a * b."""
    out = [0.0] * 16
    for c in range(4):
        for r in range(4):
            out[c * 4 + r] = sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4))
    return out


def bounds(doc: dict) -> tuple:
    """World-space min/max over every mesh in the file.

    The scene graph is walked so that a node nested under an assembly inherits
    its parent's transform. sand3d puts the millimetre-to-metre scale on the
    leaf mesh nodes, so the numbers below are the real world size.
    """
    nodes = doc.get("nodes", [])
    kids = _children(doc)
    acc_min = [float("inf")] * 3
    acc_max = [float("-inf")] * 3

    def visit(index: int, parent: list):
        node = nodes[index]
        world = _multiply(parent, _mat4(node))
        if "mesh" in node:
            mesh = doc["meshes"][node["mesh"]]
            for prim in mesh["primitives"]:
                acc = doc["accessors"][prim["attributes"]["POSITION"]]
                if "min" not in acc:
                    continue
                lo, hi = acc["min"], acc["max"]
                corners = []
                for cx in (lo[0], hi[0]):
                    for cy in (lo[1], hi[1]):
                        for cz in (lo[2], hi[2]):
                            corners.append(_apply(world, [cx, cy, cz, 1.0]))
                for p in corners:
                    for i in range(3):
                        acc_min[i] = min(acc_min[i], p[i])
                        acc_max[i] = max(acc_max[i], p[i])
        for c in kids.get(index, []):
            visit(c, world)

    for scene in doc.get("scenes", []):
        root = _mat4({"translation": [0, 0, 0]})
        for index in scene.get("nodes", []):
            visit(index, root)
    return acc_min, acc_max


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    path = argv[1]
    doc = read_glb(path)
    lo, hi = bounds(doc["json"])
    size = [round(hi[i] - lo[i], 4) for i in range(3)]
    j = doc["json"]
    print(f"file      : {os.path.basename(path)}")
    print(f"glTF ver  : {doc['version']}")
    print(f"generator : {j.get('asset', {}).get('generator', '?')}")
    print(f"nodes     : {len(j.get('nodes', []))}")
    print(f"meshes    : {len(j.get('meshes', []))}")
    print(f"materials : {[m.get('name') for m in j.get('materials', [])]}")
    print(f"bbox min  : {[round(v, 4) for v in lo]}")
    print(f"bbox max  : {[round(v, 4) for v in hi]}")
    print(f"size (m)  : {size}")
    print(f"node names: {[n.get('name') for n in j.get('nodes', [])][:24]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
