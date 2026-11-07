"""The desk of the Japanese bedroom, as separate atoms.

    desk_top_oak          1200 x 600 x 25, one slab, rounded corners
    desk_leg_taper        four tapered legs, 40 -> 28 mm
    desk_apron            the rail that ties the legs under the top
    desk_drawer_box       the open box of one drawer
    desk_drawer_face      the front board of one drawer
    desk_handle_bar       the bar handle of that drawer
    desk_cable_grommet    the hole plate at the back of the top
    desk_pin_leg          the adjustable foot pin under each leg

Nothing here is joined across atoms: the top is one mesh, the legs are one
mesh instanced four times, the drawer is three meshes that move together at
runtime.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))

import sand3d as s3d  # noqa: E402

from common import MODEL_OUT, dress, meta, run  # noqa: E402
from parts import plank, taper_post  # noqa: E402

# ---------------------------------------------------------------- dimensions
TOP_W, TOP_D, TOP_T = 1200, 600, 25
LEG_TOP, LEG_BOTTOM = 28, 40
LEG_H = 700
INSET = 55
APRON_H, APRON_T = 90, 18
DRAWER_W, DRAWER_D, DRAWER_H = 460, 480, 130
FACE_T = 14


def desk_top_oak():
    top = plank(TOP_W, TOP_D, TOP_T, r=8)
    dress(top, "oak", color="#8a6a48")
    return top


def desk_leg_taper():
    """One leg: tapered, standing on z = 0, its top face at LEG_H."""
    leg = taper_post(LEG_H, LEG_BOTTOM, LEG_TOP, r=2)
    dress(leg, "oak", color="#7d5f40")
    return leg


def desk_apron():
    """The rail under the top, along X, at the front and back."""
    rail = plank(TOP_W - 2 * INSET, APRON_T, APRON_H)
    dress(rail, "oak", color="#75593c")
    return rail


def desk_drawer_box():
    """The open box of one drawer: a bottom and four thin walls."""
    wall = 12
    bottom = plank(DRAWER_W, DRAWER_D, wall)
    front = s3d.at(plank(DRAWER_W, wall, DRAWER_H), y=DRAWER_D / 2 - wall / 2, z=wall)
    back = s3d.transform(s3d.copy(front), mirror="y")
    left = s3d.at(plank(wall, DRAWER_D - 2 * wall, DRAWER_H), x=-(DRAWER_W - wall) / 2, z=wall)
    right = s3d.transform(s3d.copy(left), mirror="x")
    box = s3d.join(bottom, front, back, left, right)
    dress(box, "birch", color="#c9b58c")
    return box


def desk_drawer_face():
    """The front board of one drawer, with a finger pull recess at the top."""
    face = plank(DRAWER_W + 12, FACE_T, DRAWER_H + 8)
    dress(face, "oak", color="#8a6a48")
    return face


def desk_handle_bar():
    """A straight bar handle on two stand-offs, 160 mm apart."""
    from parts import handle_bar as bar
    h = bar(length=160, d=11, stand=20)
    dress(h, "brushed_steel", color="#b6bcc2")
    return h


def desk_cable_grommet():
    """The plastic ring that covers the cable hole at the back of the top."""
    ring = s3d.revolve("grommet", s3d.poly([(28, 0), (34, 0), (34, 4), (28, 4)]))
    dress(ring, "plastic", color="#2a2a2c")
    return ring


def desk_pin_leg():
    """The small adjustable foot pin under a leg."""
    pin = s3d.cylinder("pin", d=12, h=18)
    dress(pin, "plastic", color="#1e1e20")
    return pin


ATOMS = [
    ("jp_bedroom_desk_top_oak", desk_top_oak,
     meta("jp_bedroom_desk_top_oak", "jp", "bedroom", "rm_jp_06", "desk", "top",
          size_m=(TOP_W / 1000, TOP_D / 1000, TOP_T / 1000), materials=("oak",),
          tags=("interior", "surface"))),
    ("jp_bedroom_desk_leg_taper", desk_leg_taper,
     meta("jp_bedroom_desk_leg_taper", "jp", "bedroom", "rm_jp_06", "desk", "leg",
          size_m=(LEG_BOTTOM / 1000, LEG_BOTTOM / 1000, LEG_H / 1000), materials=("oak",),
          tags=("interior", "instanced"))),
    ("jp_bedroom_desk_apron", desk_apron,
     meta("jp_bedroom_desk_apron", "jp", "bedroom", "rm_jp_06", "desk", "apron",
          size_m=((TOP_W - 2 * INSET) / 1000, APRON_T / 1000, APRON_H / 1000),
          materials=("oak",), tags=("interior",))),
    ("jp_bedroom_desk_drawer_box", desk_drawer_box,
     meta("jp_bedroom_desk_drawer_box", "jp", "bedroom", "rm_jp_06", "desk", "drawer_box",
          size_m=(DRAWER_W / 1000, DRAWER_D / 1000, DRAWER_H / 1000), materials=("birch",),
          tags=("interior", "loot_container", "drawer"))),
    ("jp_bedroom_desk_drawer_face", desk_drawer_face,
     meta("jp_bedroom_desk_drawer_face", "jp", "bedroom", "rm_jp_06", "desk", "drawer_face",
          size_m=((DRAWER_W + 12) / 1000, FACE_T / 1000, (DRAWER_H + 8) / 1000),
          materials=("oak",), tags=("interior", "drawer"))),
    ("jp_bedroom_desk_handle_bar", desk_handle_bar,
     meta("jp_bedroom_desk_handle_bar", "jp", "bedroom", "rm_jp_06", "desk", "handle",
          size_m=(0.16, 0.03, 0.03), materials=("brushed_steel",), tags=("interior",))),
    ("jp_bedroom_desk_cable_grommet", desk_cable_grommet,
     meta("jp_bedroom_desk_cable_grommet", "jp", "bedroom", "rm_jp_06", "desk", "grommet",
          size_m=(0.068, 0.068, 0.004), materials=("plastic",), tags=("interior",))),
    ("jp_bedroom_desk_pin_leg", desk_pin_leg,
     meta("jp_bedroom_desk_pin_leg", "jp", "bedroom", "rm_jp_06", "desk", "pin",
          size_m=(0.012, 0.012, 0.018), materials=("plastic",), tags=("interior",))),
]


def build_all(out_dir=None):
    out_dir = out_dir or os.path.join(MODEL_OUT, "jp", "bedroom")
    paths = []
    for atom_id, builder, info in ATOMS:
        paths.append(run(builder, atom_id, info, out_dir))
    return paths


if __name__ == "__main__":
    for p in build_all():
        print("wrote", p)
