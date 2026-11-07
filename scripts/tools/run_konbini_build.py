"""Run the post-outbreak scene builder inside Blender and capture any error.

    blender -b --factory-startup --python scripts/tools/run_konbini_build.py

The traceback is written to ``.logs/konbini-build.log`` so a failure is visible
even when Blender's own stdout is swallowed by the shell.
"""
from __future__ import annotations

import os
import sys
import traceback

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOG = os.path.join(ROOT, ".logs", "konbini-build.log")
os.makedirs(os.path.dirname(LOG), exist_ok=True)

sys.path.insert(0, os.path.join(ROOT, "scripts", "tools"))


def main() -> None:
    with open(LOG, "w", encoding="utf-8") as handle:
        try:
            import konbini_post_outbreak as builder
            builder.main()
            handle.write("BUILD_OK\n")
        except Exception:
            handle.write(traceback.format_exc())
            handle.flush()
        finally:
            handle.flush()


main()
