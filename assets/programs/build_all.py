"""Build every atom program in the library, then refresh the manifest.

    conda run -n sand3d python assets/programs/build_all.py

Each program module exposes ``build_all()``; this script finds them, runs
them, and rewrites the runtime manifest. A program that fails stops the run:
a half-built library is worse than a broken one, because the manifest would
list atoms whose GLB is missing.
"""
from __future__ import annotations

import importlib.util
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(HERE, "_lib")
sys.path.insert(0, LIB)

#: Where the atom programs live.
PROGRAM_DIRS = [os.path.join(HERE, "regions")]


def iter_programs():
    """Yield the path of every program file."""
    for root_dir in PROGRAM_DIRS:
        if not os.path.isdir(root_dir):
            continue
        for dirpath, _dirnames, filenames in os.walk(root_dir):
            for name in sorted(filenames):
                if not name.endswith(".py") or name.startswith("_"):
                    continue
                yield os.path.join(dirpath, name)


def load_module(path: str):
    rel = os.path.relpath(path, HERE)
    mod_name = rel[:-3].replace(os.sep, ".")
    spec = importlib.util.spec_from_file_location(mod_name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    import sand3d as s3d  # noqa: F401  (importing bpy is what makes the verbs work)

    total = 0
    failures = []
    for path in iter_programs():
        rel = os.path.relpath(path, HERE)
        try:
            module = load_module(path)
        except Exception:
            failures.append((rel, traceback.format_exc()))
            print(f"FAIL import {rel}")
            continue
        builder = getattr(module, "build_all", None)
        if builder is None:
            print(f"skip {rel} (no build_all)")
            continue
        try:
            s3d.empty_scene()
            paths = builder()
            total += len(paths)
            print(f"ok   {rel}: {len(paths)} atoms")
        except Exception:
            failures.append((rel, traceback.format_exc()))
            print(f"FAIL build {rel}")

    print(f"--- {total} atoms built, {len(failures)} failures ---")
    for rel, tb in failures:
        print(f"\n=== {rel} ===\n{tb}")

    if failures:
        return 1

    # 刷新运行时清单
    import build_manifest

    build_manifest.main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
