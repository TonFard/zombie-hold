"""Build the post-outbreak Japanese convenience store corner.

Run with Blender:

    blender -b --factory-startup --python scripts/tools/konbini_post_outbreak.py

The scene is authored in Blender's Z-up space (see ``konbini_scene/common``) and
exported to glTF with ``export_yup`` so the runtime scene in three.js keeps the
same orientation.

Everything is **mated** rather than overlapped: walls are built around their
openings, shelf decks rest on their uprights, products sit on their shelves,
and the bicycles lean on the rack with real contact points.
"""
from __future__ import annotations

import math
import os
import random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from konbini_scene import goods  # noqa: E402
from konbini_scene.common import (  # noqa: E402
    ASSET_DIR,
    BLEND_OUT,
    CURB_Y,
    EAST_X,
    FLOOR_Z,
    GLB_OUT,
    LIT_OUT,
    REAR_Y,
    ROAD_TOP,
    ROOF_Z,
    SIDE_ROAD_X,
    SIDEWALK_TOP,
    STORE_X0,
    STORE_X1,
    STORE_Y0,
    STORE_Y1,
    WALL_H,
    WALL_T,
    WEST_X,
    WHITE_OUT,
    attach,
    box,
    build_materials,
    clear_scene,
    collection,
    curve_line,
    cylinder,
    cylinder_between,
    decal,
    empty,
    ensure_dir,
    material,
    move_to,
    text,
    torus,
)

random.seed(20241107)

COL: dict[str, bpy.types.Collection] = {}

# Interior plan (world coordinates)
COOLER_X0, COOLER_X1 = -0.70, 3.30
COOLER_Y0, COOLER_Y1 = 3.55, 4.25
CHECKOUT_X0, CHECKOUT_X1 = 3.05, 5.35
CHECKOUT_Y0, CHECKOUT_Y1 = -3.85, -3.20


# ===========================================================================
# Architecture
# ===========================================================================
def build_shell(M):
    """Store shell, canopy, roof and signage.

    The storefront is built as piers + a lintel so the glazing bays and the
    sliding door sit in real openings instead of on top of a solid wall.
    """
    arch = COL["Architecture"]
    glass_col = COL["Glazing"]
    sign_col = COL["Signage"]

    x0, x1 = STORE_X0, STORE_X1
    y0, y1 = STORE_Y0, STORE_Y1
    z0 = FLOOR_Z
    ztop = ROOF_Z

    # --- floor slab: top face exactly at FLOOR_Z -----------------------------
    # The slab spans only the interior; the walls stand beside it rather than
    # on top of it, so the two meet edge to edge instead of interpenetrating.
    box("Store_Floor_Slab", (x0, x1, y0, y1, ROAD_TOP - 0.14, z0),
        M["floor_tile"], arch, bevel=0.01)

    # --- rear and side walls -------------------------------------------------
    box("Wall_Rear", (x0 - WALL_T, x1 + WALL_T, y1, y1 + WALL_T, ROAD_TOP - 0.14, ztop),
        M["wall_back"], arch, bevel=0.008)
    box("Wall_Left", (x0 - WALL_T, x0, y0, y1, ROAD_TOP - 0.14, ztop), M["wall"], arch, bevel=0.008)
    box("Wall_Right", (x1, x1 + WALL_T, y0, y1, ROAD_TOP - 0.14, ztop), M["wall"], arch, bevel=0.008)

    # --- front facade: piers + lintel, glazing and door in real openings -----
    door_half = 1.30
    pier_w = 1.55
    head_z = z0 + 2.72
    # The piers stop under the lintel so the two meet face to face.
    box("Facade_Pier_Left", (x0, -door_half - pier_w, y0 - WALL_T, y0, z0, head_z),
        M["wall"], arch, bevel=0.01)
    box("Facade_Pier_Right", (door_half + pier_w, x1, y0 - WALL_T, y0, z0, head_z),
        M["wall"], arch, bevel=0.01)
    box("Facade_Lintel", (x0, x1, y0 - WALL_T, y0, head_z, ztop), M["wall"], arch, bevel=0.01)
    # The kick panels stop short of the door reveal so the jambs have room.
    kick_gap = 0.10
    for side, a, b in (("Left", -door_half - pier_w, -door_half - kick_gap),
                       ("Right", door_half + kick_gap, door_half + pier_w)):
        box(f"Facade_Kick_{side}", (a, b, y0 - WALL_T, y0, z0, z0 + 0.22),
            M["concrete"], arch, bevel=0.006)

    # --- glazing bays: aluminium frame + individual panes -------------------
    # Each bay stops 140 mm short of the door opening so the door jamb has
    # room to sit in the reveal without cutting into the glazing.
    frame_y0, frame_y1 = y0 - WALL_T - 0.09, y0 - WALL_T
    glass_y = (frame_y0 + frame_y1) * 0.5
    sill_z = z0 + 0.22
    bay_gap = 0.14
    for side, a, b in (("Left", -door_half - pier_w + bay_gap, -door_half - bay_gap),
                       ("Right", door_half + bay_gap, door_half + pier_w - bay_gap)):
        box(f"Window_Sill_{side}", (a, b, frame_y0, frame_y1, sill_z, sill_z + 0.09),
            M["aluminium"], glass_col, bevel=0.005)
        box(f"Window_Head_{side}", (a, b, frame_y0, frame_y1, head_z - 0.09, head_z),
            M["aluminium"], glass_col, bevel=0.005)
        span = b - a
        for i in range(1, 4):
            mx = a + span * i / 4
            box(f"Window_Mullion_{side}_{i}",
                (mx - 0.035, mx + 0.035, frame_y0, frame_y1, sill_z + 0.09, head_z - 0.09),
                M["aluminium"], glass_col, bevel=0.004)
        for i in range(4):
            px0 = a + span * i / 4 + 0.047
            px1 = a + span * (i + 1) / 4 - 0.047
            pane = box(f"Storefront_Glass_{side}_{i + 1}",
                       (px0, px1, glass_y - 0.006, glass_y + 0.006,
                        sill_z + 0.102, head_z - 0.102),
                       M["glass_broken"] if i == 1 else M["glass"], glass_col)
            pane["damage_state"] = "cracked" if i == 1 else "dirty"

    build_sliding_door(M)

    # --- canopy above the shop front ----------------------------------------
    # The canopy hangs in front of the lintel and stops short of the piers in
    # plan, so the two never fight for the same space.
    canopy_y0 = y0 - WALL_T - 1.35
    canopy_z = head_z + 0.16
    box("Storefront_Canopy_Slab",
        (x0 - 0.35, x1 + 0.35, canopy_y0, y0 - WALL_T - 0.02, canopy_z, canopy_z + 0.14),
        M["steel_dark"], arch, bevel=0.008)
    box("Storefront_Canopy_Fascia",
        (x0 - 0.35, x1 + 0.35, canopy_y0 - 0.05, canopy_y0, canopy_z - 0.20, canopy_z + 0.14),
        M["paint_blue"], arch, bevel=0.008)
    for i in range(6):
        lx = x0 + 0.9 + i * 2.1
        box(f"Canopy_Downlight_{i + 1}",
            (lx - 0.11, lx + 0.11, canopy_y0 + 0.34, canopy_y0 + 0.56,
             canopy_z - 0.038, canopy_z - 0.006), M["lamp_led"], COL["Lighting"], bevel=0.012)

    # --- roof ----------------------------------------------------------------
    box("Roof_Deck", (x0 - WALL_T - 0.20, x1 + WALL_T + 0.20,
                      y0 - WALL_T - 0.06, y1 + WALL_T + 0.06, ztop, ztop + 0.16),
        M["steel_dark"], arch, bevel=0.012)
    box("Parapet_Front", (x0 - WALL_T - 0.20, x1 + WALL_T + 0.20,
                          y0 - WALL_T - 0.06, y0 - WALL_T + 0.10, ztop + 0.16, ztop + 0.50),
        M["concrete"], arch, bevel=0.008)
    box("Parapet_Back", (x0 - WALL_T - 0.20, x1 + WALL_T + 0.20,
                         y1 + WALL_T - 0.10, y1 + WALL_T + 0.06, ztop + 0.16, ztop + 0.50),
        M["concrete"], arch, bevel=0.008)
    box("Parapet_Left", (x0 - WALL_T - 0.20, x0 - WALL_T + 0.10,
                         y0 - WALL_T + 0.10, y1 + WALL_T - 0.10, ztop + 0.16, ztop + 0.50),
        M["concrete"], arch, bevel=0.008)
    box("Parapet_Right", (x1 + WALL_T - 0.10, x1 + WALL_T + 0.20,
                          y0 - WALL_T + 0.10, y1 + WALL_T - 0.10, ztop + 0.16, ztop + 0.50),
        M["concrete"], arch, bevel=0.008)

    for i, (ax, ay) in enumerate([(-4.2, 1.8), (-1.6, 2.6), (3.9, 2.4)], 1):
        box(f"AC_Outdoor_Unit_{i}", (ax - 0.52, ax + 0.52, ay - 0.36, ay + 0.36,
                                     ztop + 0.16, ztop + 0.92), M["steel"], arch, bevel=0.012)
        cylinder(f"AC_Fan_{i}", 0.28, ztop + 0.92, ztop + 0.95, ax, ay,
                 M["steel_dark"], arch, vertices=18)
        box(f"AC_Grille_{i}", (ax - 0.42, ax + 0.42, ay - 0.02, ay + 0.02,
                               ztop + 0.96, ztop + 0.99), M["steel_dark"], arch)
    cylinder("Roof_Vent", 0.16, ztop + 0.16, ztop + 0.72, 0.8, -2.0, M["steel"], arch, vertices=14)
    cylinder("Roof_Vent_Cap", 0.22, ztop + 0.72, ztop + 0.80, 0.8, -2.0, M["steel"], arch, vertices=14)

    # --- fascia sign board ---------------------------------------------------
    # The board hangs off the front of the parapet, so it clears the parapet
    # face instead of cutting into it.
    board_z0 = ztop + 0.50
    board_z1 = board_z0 + 0.86
    board_y0 = y0 - WALL_T - 0.06 - 0.12
    board_y1 = y0 - WALL_T - 0.06
    box("Sign_Board_Back", (x0 - 0.10, x1 + 0.10, board_y0, board_y1, board_z0, board_z1),
        M["steel_dark"], sign_col, bevel=0.006)
    box("Sign_Board_Face", (x0 - 0.04, x1 + 0.04, board_y0 - 0.014, board_y0,
                            board_z0 + 0.05, board_z1 - 0.05), M["sign_white"], sign_col, bevel=0.003)
    text("Sign_Text_Shop", "Toki Store", 0, board_y0 - 0.020, (board_z0 + board_z1) * 0.5,
         0.44, M["sign_black"], sign_col, facing="-y")
    box("Sign_Band_Blue", (x0 - 0.10, x1 + 0.10, board_y0 - 0.02, board_y1,
                           board_z0 - 0.16, board_z0), M["paint_blue"], sign_col, bevel=0.004)
    box("Sign_Band_Yellow", (x0 - 0.10, x1 + 0.10, board_y0 - 0.02, board_y1,
                             board_z0 - 0.30, board_z0 - 0.16), M["paint_yellow"], sign_col, bevel=0.004)

    # --- entrance mat, flush with the floor --------------------------------
    # The mat sits just inside the door reveal, clear of the sill track.
    box("Entrance_Mat", (-0.95, 0.95, STORE_Y0 - 1.05, STORE_Y0 - 0.30,
                         FLOOR_Z, FLOOR_Z + 0.018), M["fabric"], COL["Props"], bevel=0.006)

    # --- attached grime and blood on the facade ----------------------------
    decal("Decal_Blood_Facade_Right", 4.35, STORE_Y0 - WALL_T - 0.002, FLOOR_Z + 1.05,
          0.75, 0.52, M["blood"], COL["Decals"], normal="-y", seed=11)
    decal("Decal_Blood_Facade_Left", -4.10, STORE_Y0 - WALL_T - 0.002, FLOOR_Z + 0.95,
          0.55, 0.42, M["blood_dilute"], COL["Decals"], normal="-y", seed=12)
    decal("Decal_Soot_Pier", 5.55, STORE_Y0 - WALL_T - 0.002, FLOOR_Z + 0.45,
          1.10, 0.34, M["dirt"], COL["Decals"], normal="-y", seed=13)
    decal("Decal_Runnel_Pier", -5.45, STORE_Y0 - WALL_T - 0.002, FLOOR_Z + 1.85,
          0.30, 1.40, M["grime"], COL["Decals"], normal="-y", seed=14)


# ===========================================================================
# Sliding entrance door
# ===========================================================================
def build_sliding_door(M):
    """Two sliding leaves that each run in their own track.

    Each leaf is parented to an empty that carries ``closed_x`` / ``open_x``
    metadata, so the runtime can slide them without re-authoring the geometry.
    The leaves are authored in the empty's local space, which means the
    movement is a plain translation along the shop front.
    """
    door_col = COL["Doors"]
    y0 = STORE_Y0
    frame_y = y0 - WALL_T - 0.055  # leaves sit just inside the shop front plane

    aperture = 2.60
    leaf_w = 1.24
    leaf_h = 2.30
    base_z = FLOOR_Z + 0.04
    # The jambs sit outside the glazing bay, so the leaves have a clear run.
    jamb_x = aperture / 2 + 0.09

    roots = []
    for side, cx, direction in (("Left", -0.655, -1.0), ("Right", 0.655, 1.0)):
        root = empty(f"Door_{side}_Panel", (cx, frame_y, base_z), door_col, size=0.3)
        root["interaction"] = "slide horizontally along X"
        root["closed_x"] = cx
        root["open_x"] = cx + direction * 1.28
        root["travel"] = 1.28

        # Leaf parts are authored so the stiles butt the rails instead of
        # overlapping: the rails span the full width, the stiles fit between.
        rail_t = 0.09
        parts = [
            (f"Door_{side}_Glass", (-leaf_w / 2 + 0.045, leaf_w / 2 - 0.045, -0.006, 0.006,
                                    rail_t + 0.012, leaf_h - rail_t - 0.012), M["glass_broken"]),
            (f"Door_{side}_Rail_Bottom", (-leaf_w / 2, leaf_w / 2, -0.022, 0.022, 0.0, rail_t),
             M["aluminium"]),
            (f"Door_{side}_Rail_Top", (-leaf_w / 2, leaf_w / 2, -0.022, 0.022,
                                       leaf_h - rail_t, leaf_h), M["aluminium"]),
            (f"Door_{side}_Stile_Left", (-leaf_w / 2, -leaf_w / 2 + 0.045, -0.022, 0.022,
                                         rail_t + 0.002, leaf_h - rail_t - 0.002), M["aluminium"]),
            (f"Door_{side}_Stile_Right", (leaf_w / 2 - 0.045, leaf_w / 2, -0.022, 0.022,
                                          rail_t + 0.002, leaf_h - rail_t - 0.002), M["aluminium"]),
        ]
        for name, (lx0, lx1, ly0, ly1, lz0, lz1), mat in parts:
            obj = box(name, (lx0, lx1, ly0, ly1, lz0, lz1), mat, door_col, bevel=0.004)
            attach(obj, root)
        roots.append(root)

    # Head track spans the whole opening; the sill track stops at the jambs.
    box("Door_Upper_Track", (-aperture / 2, aperture / 2, frame_y - 0.035, frame_y + 0.035,
                              base_z + leaf_h, base_z + leaf_h + 0.10),
        M["aluminium"], door_col, bevel=0.005)
    box("Door_Sill_Track", (-aperture / 2 + 0.04, aperture / 2 - 0.04,
                            frame_y - 0.028, frame_y + 0.028, base_z - 0.04, base_z),
        M["aluminium"], door_col, bevel=0.003)
    for side, jx in (("Left", -jamb_x), ("Right", jamb_x)):
        box(f"Door_Jamb_{side}", (jx - 0.06, jx + 0.06, frame_y - 0.06, frame_y + 0.06,
                                  base_z - 0.04, base_z + leaf_h + 0.10),
            M["aluminium"], door_col, bevel=0.004)

    # Blood smears ride on the leaves and travel with them.
    for side, root, sx, sz, mat, seed in (
        ("Left", roots[0], -0.24, 1.15, M["blood"], 21),
        ("Right", roots[1], 0.26, 0.95, M["blood_dilute"], 22),
    ):
        smear = decal(f"Door_{side}_Blood_Smear", sx, -0.011, sz, 0.24, 0.44, mat,
                      door_col, normal="-y", seed=seed)
        attach(smear, root)


# ===========================================================================
# Interior fixtures
# ===========================================================================
BAY_W = 1.02
BAY_D = 0.42
BAY_H = 1.62
DECK_T = 0.020
TIER_STEP = 0.34
TIER_BASE = 0.26


class Bay:
    """A shelf bay plus a local->world transform, so stock lands on the deck."""

    def __init__(self, name: str, cx: float, cy: float, rot: float):
        self.name = name
        self.cx, self.cy, self.rot = cx, cy, rot
        self.c = math.cos(rot)
        self.s = math.sin(rot)

    def point(self, lx: float, ly: float, lz: float) -> tuple[float, float, float]:
        return (self.cx + lx * self.c - ly * self.s,
                self.cy + lx * self.s + ly * self.c,
                FLOOR_Z + lz)

    def rect(self, lx0: float, lx1: float, ly0: float, ly1: float,
             lz0: float, lz1: float) -> tuple[float, ...]:
        """World-space bounds of a rectangle expressed in the bay's own frame.

        The bay is only ever rotated by a multiple of 90 degrees, so the
        axis-aligned world box of the four transformed corners is exact. This
        is what lets every fixture part be authored in local coordinates and
        still meet its neighbour face to face.
        """
        xs, ys = [], []
        for lx in (lx0, lx1):
            for ly in (ly0, ly1):
                wx, wy, _ = self.point(lx, ly, 0)
                xs.append(wx)
                ys.append(wy)
        return (min(xs), max(xs), min(ys), max(ys), FLOOR_Z + lz0, FLOOR_Z + lz1)

    def deck_top(self, level: int) -> float:
        return FLOOR_Z + TIER_BASE + level * TIER_STEP + DECK_T


def build_gondola(M, bay: Bay, tiers: int = 5):
    """One modular shelf bay: feet, uprights, back panel, decks, price rails.

    The bay is built from the blueprint proportions: a 1.02 m wide module with a
    0.42 m deep deck, a perforated back panel and five tiers of product.

    Every part meets its neighbour **face to face**. The four uprights sit on
    their feet, the decks span exactly between the uprights' inner faces, the
    back panel closes the rear plane, and the top board caps the run. Nothing
    is pushed into anything else.
    """
    fix = COL["Fixtures"]
    bw, bd, bh = BAY_W, BAY_D, BAY_H

    # Faces of the bay in its own local frame.
    up_x = bw / 2 - 0.03          # upright centre line, 40 mm section
    up_y = bd / 2 - 0.04
    half = 0.020                  # half of the 40 mm upright section
    deck_x = up_x - half          # deck stops on the upright inner face
    deck_y0, deck_y1 = -bd / 2, bd / 2 - half   # deck stops on the back panel
    back_y0, back_y1 = bd / 2 - half, bd / 2   # back panel closes the rear

    for i, (ux, uy) in enumerate([(-up_x, -up_y), (up_x, -up_y),
                                  (-up_x, up_y), (up_x, up_y)], 1):
        fx, fy, _ = bay.point(ux, uy, 0)
        box(f"{bay.name}_Foot_{i}", (fx - 0.030, fx + 0.030, fy - 0.030, fy + 0.030,
                                     FLOOR_Z, FLOOR_Z + 0.018), M["steel_dark"], fix, bevel=0.004)
        box(f"{bay.name}_Upright_{i}", (fx - half, fx + half, fy - half, fy + half,
                                        FLOOR_Z + 0.018, FLOOR_Z + bh), M["steel"], fix, bevel=0.004)

    # Back panel closes the rear plane of the bay, between the rear uprights.
    box(f"{bay.name}_Back_Panel",
        bay.rect(-deck_x, deck_x, back_y0, back_y1, 0.10, bh),
        M["shelf_panel"], fix, bevel=0.003)

    for level in range(tiers):
        lz = TIER_BASE + level * TIER_STEP
        # The deck spans exactly between the uprights' inner faces.
        box(f"{bay.name}_Deck_{level + 1}",
            bay.rect(-deck_x, deck_x, deck_y0, deck_y1, lz, lz + DECK_T),
            M["shelf_deck"], fix, bevel=0.002)
        # Price rail hangs on the front edge of the deck, clear of the uprights.
        box(f"{bay.name}_Price_Rail_{level + 1}",
            bay.rect(-deck_x, deck_x, -bd / 2 - 0.028, -bd / 2, lz - 0.032, lz),
            M["sign_white"], fix, bevel=0.002)

    # Top board caps the run and stays inside the bay footprint, so it never
    # pushes into the wall the run is standing against. It starts on top of
    # the highest deck, so the two meet face to face.
    top_z = TIER_BASE + (tiers - 1) * TIER_STEP + DECK_T
    box(f"{bay.name}_Top_Board",
        bay.rect(-bw / 2, bw / 2, back_y1 - 0.09, back_y1, top_z, top_z + 0.14),
        M["gondola_top"], fix, bevel=0.004)
    # Category strip sits on the front face of the top board.
    box(f"{bay.name}_Category_Strip",
        bay.rect(-bw / 2, bw / 2, back_y1 - 0.099, back_y1 - 0.09, top_z + 0.02, top_z + 0.12),
        M["sign_white"], fix, bevel=0.002)


def stock_bay(M, bay: Bay, tiers: int = 5, snack: bool = False, density: float = 0.12):
    """Place drinks (or snacks) on the decks of a bay.

    ``density`` is the chance a slot was cleared out; the rest of the shelf is
    packed. The blueprint shows the aisles almost completely full, so the
    default leaves only a few gaps.

    Each slot gets a **facing row** of product plus a **back-up row**, which is
    what makes a real konbini shelf look full rather than like a display row.
    """
    goods_col = COL["Goods"]
    flavour_mats = {k: material(f"Label | {k}", v, 0.42) for k, v in goods.LABEL_COLORS.items()}
    wrap_mats = {k: material(f"Wrap | {k}", v, 0.38) for k, v in goods.WRAP_COLORS.items()}
    snack_mats = [material(f"Wrap | snack {i}", c, 0.34)
                  for i, c in enumerate(goods.SNACK_COLORS)]
    slots = 8
    for level in range(tiers):
        deck_z = bay.deck_top(level)
        # The top shelf of a gondola is usually a slow-moving line with boxes.
        top = level == tiers - 1
        for k in range(slots):
            lx = -BAY_W / 2 + 0.09 + k * ((BAY_W - 0.18) / (slots - 1))
            if random.random() < density:
                continue  # some slots were cleared out
            for row, ly in enumerate((-0.09, 0.09)):
                if row == 1 and random.random() < 0.18:
                    continue
                px, py, _ = bay.point(lx, ly, 0)
                if snack:
                    pick = random.random()
                    wrap = random.choice(snack_mats)
                    if top:
                        goods.carton(f"Snack_Box_{bay.name}_{level}_{k}_{row}", px, py, deck_z,
                                     M["cardboard"], goods_col)
                    elif pick < 0.42:
                        goods.chip_bag(f"Snack_Bag_{bay.name}_{level}_{k}_{row}", px, py, deck_z,
                                       wrap, goods_col, lean=random.uniform(-0.09, 0.09))
                    elif pick < 0.70:
                        goods.pouch(f"Snack_Pouch_{bay.name}_{level}_{k}_{row}", px, py, deck_z,
                                    wrap, goods_col)
                    elif pick < 0.87:
                        goods.cup_noodle(f"Noodle_Cup_{bay.name}_{level}_{k}_{row}", px, py, deck_z,
                                         wrap, M["plastic_white"], goods_col)
                    else:
                        goods.onigiri(f"Onigiri_{bay.name}_{level}_{k}_{row}", px, py, deck_z,
                                      M["paper"], wrap, goods_col)
                else:
                    flavour = random.choice(list(goods.LABEL_COLORS))
                    lmat = flavour_mats[flavour]
                    wmat = wrap_mats[flavour]
                    pick = random.random()
                    if top:
                        goods.carton(f"Drink_Box_{bay.name}_{level}_{k}_{row}", px, py, deck_z,
                                     M["cardboard"], goods_col)
                    elif pick < 0.38:
                        goods.can(f"Drink_Can_{bay.name}_{level}_{k}_{row}", px, py, deck_z, flavour,
                                  lmat, goods_col, mat_wrap=wmat)
                    elif pick < 0.68:
                        goods.pet_bottle(f"Drink_Bottle_{bay.name}_{level}_{k}_{row}", px, py, deck_z,
                                         flavour, M["plastic_white"], wmat, goods_col)
                    elif pick < 0.84:
                        goods.glass_bottle(f"Drink_Glass_{bay.name}_{level}_{k}_{row}", px, py, deck_z,
                                           M["plastic_white"], wmat, goods_col)
                    else:
                        goods.pouch(f"Drink_Pouch_{bay.name}_{level}_{k}_{row}", px, py, deck_z,
                                    wmat, goods_col)


def build_interior(M):
    """Shelf gondolas, wall runs, the drinks cooler and the checkout counter.

    The blueprint plan shows a typical konbini: a deep run of shelving along
    the left wall, a second run down the middle of the shop, a cooler wall on
    the right and the checkout near the entrance. The first pass only had a
    handful of sparse bays, which read as an empty warehouse, so the runs are
    now continuous and packed with stock.
    """
    fix = COL["Fixtures"]

    # --- left wall run: continuous shelving from the front to the back ------
    # The back panel faces the wall and the product faces the aisle. The bay's
    # back stops 20 mm clear of the wall face, so nothing is buried in the wall.
    left_bays = []
    for i, y in enumerate((-3.30, -2.25, -1.20, -0.15, 0.90, 1.95, 3.00), 1):
        bay = Bay(f"Gondola_L{i}", STORE_X0 + WALL_T + 0.02 + BAY_D / 2, y, math.pi / 2)
        build_gondola(M, bay)
        stock_bay(M, bay, snack=(i % 3 == 0), density=0.10)
        left_bays.append(bay)

    # --- centre island: double sided, product faces both aisles ------------
    # A konbini centre run is a back-to-back gondola: two mirrored modules
    # whose back panels meet on the centre line, each showing product to its
    # own aisle.
    centre_bays = []
    for i, y in enumerate((-3.10, -2.05, -1.00, 0.05, 1.10, 2.15, 3.20), 1):
        for side, rot, ox in (("A", math.pi / 2, BAY_D / 2), ("B", -math.pi / 2, -BAY_D / 2)):
            bay = Bay(f"Gondola_M{i}{side}", -2.55 + ox, y, rot)
            build_gondola(M, bay)
            stock_bay(M, bay, snack=(i % 2 == 0), density=0.08)
            centre_bays.append(bay)

    # --- right of the entrance aisle, in front of the cooler -----------------
    right_bays = []
    for i, y in enumerate((-3.30, -2.25, -1.20, -0.15, 0.90), 1):
        bay = Bay(f"Gondola_R{i}", 1.55, y, -math.pi / 2)
        build_gondola(M, bay)
        stock_bay(M, bay, snack=(i == 2), density=0.10)
        right_bays.append(bay)

    # --- right wall run behind the cooler ------------------------------------
    for i, y in enumerate((0.60, 1.70, 2.80), 1):
        bay = Bay(f"Gondola_W{i}", STORE_X1 - WALL_T - 0.02 - BAY_D / 2, y, -math.pi / 2)
        build_gondola(M, bay)
        stock_bay(M, bay, snack=(i == 2), density=0.12)

    # --- back wall run: dry goods shelving across the rear -------------------
    for i, x in enumerate((-4.00, -2.90, -1.80), 1):
        bay = Bay(f"Gondola_B{i}", x, STORE_Y1 - WALL_T - 0.02 - BAY_D / 2, 0.0)
        build_gondola(M, bay)
        stock_bay(M, bay, snack=True, density=0.12)

    build_cooler(M)

    # --- wall-mounted wire baskets on the right-hand front pier ---------------
    # They hang on the inside face of the front pier, clear of the checkout.
    for i in range(3):
        bx = 3.10 + i * 0.60
        box(f"Wall_Basket_{i + 1}", (bx - 0.21, bx + 0.21, -4.48, -4.16,
                                     FLOOR_Z + 1.05 + i * 0.30, FLOOR_Z + 1.09 + i * 0.30),
            M["shelf_deck"], fix, bevel=0.003)

    # --- checkout counter near the entrance ----------------------------------
    cx0, cx1 = CHECKOUT_X0, CHECKOUT_X1
    cy0, cy1 = CHECKOUT_Y0, CHECKOUT_Y1
    box("Checkout_Counter_Carcass", (cx0, cx1, cy0, cy1, FLOOR_Z, FLOOR_Z + 0.88),
        M["wood"], fix, bevel=0.012)
    box("Checkout_Counter_Top", (cx0 - 0.04, cx1 + 0.04, cy0 - 0.05, cy1 + 0.02,
                                 FLOOR_Z + 0.88, FLOOR_Z + 0.95), M["steel"], fix, bevel=0.008)
    box("POS_Register_Base", (4.58, 4.98, cy0 + 0.42, cy0 + 0.74, FLOOR_Z + 0.95, FLOOR_Z + 1.05),
        M["plastic_grey"], fix, bevel=0.008)
    box("POS_Register_Screen", (4.61, 4.95, cy0 + 0.68, cy0 + 0.72, FLOOR_Z + 1.05, FLOOR_Z + 1.34),
        M["glass"], fix, bevel=0.006)
    box("POS_Scanner", (4.30, 4.56, cy0 + 0.46, cy0 + 0.58, FLOOR_Z + 0.95, FLOOR_Z + 1.02),
        M["plastic_grey"], fix, bevel=0.005)
    box("Counter_Display_Stand", (cx1 - 0.34, cx1 - 0.06, cy1 - 0.16, cy1,
                                  FLOOR_Z + 0.95, FLOOR_Z + 1.28), M["steel"], fix, bevel=0.005)
    # Impulse goods on the counter: the small, high-margin rack.
    for i in range(3):
        bx = cx0 + 0.18 + i * 0.42
        box(f"Counter_Goods_Rack_{i + 1}", (bx - 0.16, bx + 0.16, cy0 + 0.02, cy0 + 0.30,
                                            FLOOR_Z + 0.95, FLOOR_Z + 1.02), M["shelf_deck"], fix,
            bevel=0.003)
        for k in range(3):
            goods.can(f"Counter_Can_{i + 1}_{k + 1}", bx - 0.10 + k * 0.10, cy0 + 0.16,
                      FLOOR_Z + 1.02, "cola", M["paper"], COL["Goods"])

    # --- magazine rack on the left pier -------------------------------------
    box("Magazine_Rack_Back", (-6.30, -5.10, -4.28, -4.24, FLOOR_Z + 0.35, FLOOR_Z + 1.45),
        M["steel"], fix, bevel=0.004)
    for i in range(4):
        goods.magazine(f"Magazine_{i + 1}", -6.18 + i * 0.29, -4.26, FLOOR_Z + 0.42,
                       M["paper"], COL["Goods"], tilt=random.uniform(-0.05, 0.05))

    # --- ceiling and interior lighting --------------------------------------
    box("Ceiling_Slab", (STORE_X0, STORE_X1, STORE_Y0, STORE_Y1, ROOF_Z - 0.14, ROOF_Z),
        M["wall"], fix)
    for i in range(5):
        lx = -4.8 + i * 2.4
        for j in range(3):
            ly = -2.8 + j * 2.4
            box(f"Ceiling_Fluorescent_Housing_{i}_{j}",
                (lx - 0.65, lx + 0.65, ly - 0.16, ly + 0.16, ROOF_Z - 0.17, ROOF_Z - 0.14),
                M["plastic_white"], fix, bevel=0.004)
            box(f"Ceiling_Fluorescent_Tube_{i}_{j}",
                (lx - 0.60, lx + 0.60, ly - 0.12, ly + 0.12, ROOF_Z - 0.196, ROOF_Z - 0.17),
                M["lamp_warm"] if random.random() < 0.45 else M["lamp_dead"], COL["Lighting"],
                bevel=0.003)
    box("Emergency_Exit_Sign", (0.85, 1.45, STORE_Y0 + 0.02, STORE_Y0 + 0.07,
                                ROOF_Z - 0.42, ROOF_Z - 0.22), M["emergency"], COL["Lighting"],
        bevel=0.004)

    # --- back-of-house door and storage lockers -----------------------------
    # The rear wall has a real opening: the wall is split around the door
    # instead of the door being pushed through a solid slab.
    door_x0, door_x1 = 4.20, 5.30
    box("Back_Door_Frame", (door_x0, door_x1, STORE_Y1 - 0.02, STORE_Y1 + 0.06,
                            FLOOR_Z, FLOOR_Z + 2.10), M["steel"], fix, bevel=0.005)
    box("Back_Door_Leaf", (door_x0 + 0.06, door_x1 - 0.06, STORE_Y1 - 0.06, STORE_Y1 - 0.02,
                           FLOOR_Z + 0.02, FLOOR_Z + 2.04), M["steel_dark"], fix, bevel=0.004)
    for i in range(4):
        lx = -6.05 + i * 0.42
        box(f"Storage_Locker_{i + 1}", (lx - 0.19, lx + 0.19, STORE_Y1 - 0.48, STORE_Y1 - 0.02,
                                       FLOOR_Z, FLOOR_Z + 1.80), M["steel"], fix, bevel=0.006)
        box(f"Storage_Locker_Vent_{i + 1}", (lx - 0.13, lx + 0.13, STORE_Y1 - 0.50, STORE_Y1 - 0.48,
                                             FLOOR_Z + 1.42, FLOOR_Z + 1.62), M["steel_dark"], fix)

    # --- abandoned boxes on the floor, clear of the back-wall run ------------
    # They sit in the left aisle so they neither hit the shelving nor the cooler.
    for i, (bx, by, bw, bh) in enumerate([(-5.20, 3.45, 0.62, 0.52), (-4.55, 3.50, 0.55, 0.42),
                                          (-3.95, 3.42, 0.48, 0.34)], 1):
        box(f"Carton_{i}", (bx - bw / 2, bx + bw / 2, by - bw / 2, by + bw / 2,
                            FLOOR_Z, FLOOR_Z + bh), M["cardboard"], COL["Props"], bevel=0.008)

    # --- floor stock: crates of drinks left on the floor ---------------------
    for i, (cx, cy) in enumerate([(-4.60, -1.60), (-4.55, -0.90), (3.55, 1.20)], 1):
        box(f"Floor_Crate_{i}", (cx - 0.24, cx + 0.24, cy - 0.17, cy + 0.17,
                                 FLOOR_Z, FLOOR_Z + 0.28), M["plastic_grey"], COL["Props"],
            bevel=0.006)
        for k in range(3):
            goods.can(f"Floor_Crate_Can_{i}_{k + 1}", cx - 0.14 + k * 0.14, cy,
                      FLOOR_Z + 0.28, "cola", M["paper"], COL["Goods"])


def build_cooler(M):
    """Refrigerated drinks cabinet standing against the back wall."""
    cool = COL["Cooler"]
    goods_col = COL["Goods"]
    cx0, cx1 = COOLER_X0, COOLER_X1
    cy0, cy1 = COOLER_Y0, COOLER_Y1
    base_z = FLOOR_Z
    height = 2.05

    box("Cooler_Plinth", (cx0, cx1, cy0, cy1, base_z, base_z + 0.12), M["steel_dark"], cool, bevel=0.006)
    box("Cooler_Carcass_Back", (cx0, cx1, cy1 - 0.06, cy1, base_z + 0.12, base_z + height),
        M["plastic_white"], cool, bevel=0.006)
    box("Cooler_Carcass_Top", (cx0, cx1, cy0, cy1, base_z + height, base_z + height + 0.12),
        M["plastic_white"], cool, bevel=0.006)
    box("Cooler_Carcass_Bottom", (cx0, cx1, cy0, cy1, base_z + 0.12, base_z + 0.20),
        M["plastic_white"], cool, bevel=0.006)
    box("Cooler_Side_Left", (cx0, cx0 + 0.08, cy0, cy1, base_z + 0.20, base_z + height),
        M["plastic_white"], cool, bevel=0.006)
    box("Cooler_Side_Right", (cx1 - 0.08, cx1, cy0, cy1, base_z + 0.20, base_z + height),
        M["plastic_white"], cool, bevel=0.006)
    box("Cooler_Interior_Back", (cx0 + 0.08, cx1 - 0.08, cy1 - 0.08, cy1 - 0.06,
                                 base_z + 0.20, base_z + height), M["steel"], cool)

    # Four hinged glass doors; each is a child of an empty placed on its hinge axis.
    door_count = 4
    door_w = (cx1 - cx0 - 0.16) / door_count
    for i in range(door_count):
        hinge_x = cx0 + 0.08 + i * door_w + 0.012
        leaf_w = door_w - 0.024
        root = empty(f"Cooler_Door_{i + 1}", (hinge_x, cy0 - 0.022, base_z + 0.20), cool, size=0.12)
        root["interaction"] = "hinged on the left stile, swings toward -y"
        root["closed_x"] = hinge_x
        root["hinge_x"] = hinge_x
        root["open_angle"] = -55.0
        parts = [
            (f"Cooler_Door_Glass_{i + 1}", (0.05, leaf_w - 0.05, -0.012, 0.0, 0.06, height - 0.26),
             M["glass_cooler"]),
            (f"Cooler_Door_Frame_Top_{i + 1}", (0.0, leaf_w, -0.022, 0.0, height - 0.26, height - 0.20),
             M["aluminium"]),
            (f"Cooler_Door_Frame_Bottom_{i + 1}", (0.0, leaf_w, -0.022, 0.0, 0.0, 0.06),
             M["aluminium"]),
            (f"Cooler_Door_Frame_Left_{i + 1}", (0.0, 0.05, -0.022, 0.0, 0.06, height - 0.26),
             M["aluminium"]),
            (f"Cooler_Door_Frame_Right_{i + 1}", (leaf_w - 0.05, leaf_w, -0.022, 0.0,
                                                  0.06, height - 0.26), M["aluminium"]),
            (f"Cooler_Door_Handle_{i + 1}", (leaf_w - 0.10, leaf_w - 0.045, -0.075, -0.028,
                                             0.65, 0.95), M["chrome"]),
        ]
        for name, (lx0, lx1, ly0, ly1, lz0, lz1), mat in parts:
            attach(box(name, (lx0, lx1, ly0, ly1, lz0, lz1), mat, cool, bevel=0.003), root)

    # Interior shelves and stock: every shelf is filled front to back.
    flavour_mats = {k: material(f"Cooler Label | {k}", v, 0.40) for k, v in goods.LABEL_COLORS.items()}
    wrap_mats = {k: material(f"Cooler Wrap | {k}", v, 0.36) for k, v in goods.WRAP_COLORS.items()}
    for level in range(5):
        sz = base_z + 0.34 + level * 0.34
        box(f"Cooler_Shelf_{level + 1}", (cx0 + 0.09, cx1 - 0.09, cy0 + 0.06, cy1 - 0.08,
                                           sz, sz + 0.018), M["shelf_deck"], cool, bevel=0.002)
        box(f"Cooler_Price_Strip_{level + 1}", (cx0 + 0.09, cx1 - 0.09, cy0 + 0.05, cy0 + 0.065,
                                                 sz - 0.030, sz), M["sign_white"], cool, bevel=0.002)
        slots = int((cx1 - cx0 - 0.36) / 0.135)
        for k in range(slots):
            px = cx0 + 0.18 + k * 0.135
            if random.random() < 0.08:
                continue
            flavour = random.choice(list(goods.LABEL_COLORS))
            lmat = flavour_mats[flavour]
            wmat = wrap_mats[flavour]
            for row, py in enumerate((cy0 + 0.18, cy0 + 0.40)):
                if row == 1 and random.random() < 0.35:
                    continue
                goods.pet_bottle(f"Cooler_Bottle_{level}_{k}_{row}", px, py, sz + 0.018,
                                 flavour, M["plastic_white"], wmat, goods_col,
                                 height=0.215, radius=0.033)

    # Interior cool strip light at the top of each door bay.
    box("Cooler_Interior_Light", (cx0 + 0.10, cx1 - 0.10, cy1 - 0.20, cy1 - 0.13,
                                   base_z + height - 0.20, base_z + height - 0.16),
        M["lamp_warm"], COL["Lighting"], bevel=0.003)


# ===========================================================================
# Street
# ===========================================================================
def build_street(M):
    """Road, kerb, walk, drainage, road markings and the roadside signs.

    The corner is built as a real street corner: a road along the front, a side
    street at the east end, a kerb line that turns the corner, and a walk that
    wraps the shop. Every slab butts against its neighbour instead of being
    pushed through it.
    """
    st = COL["Street"]

    walk_y0, walk_y1 = CURB_Y, STORE_Y0 - WALL_T
    road_y = CURB_Y - 0.30          # where the kerb gutter strip starts
    kerb_y = CURB_Y - 0.16          # the kerb itself

    # --- the ground the whole block stands on -------------------------------
    # One big slab carries the road, the walk and the shop so nothing floats
    # over a void and nothing is pushed into the ground.
    box("Ground_Base", (WEST_X, EAST_X, CURB_Y - 12.0, REAR_Y, ROAD_TOP - 0.60, ROAD_TOP - 0.14),
        M["dirt"], st)
    # --- the walk in front of the shop --------------------------------------
    # It stops at the side street, so the corner kerb has room to turn.
    box("Sidewalk_Slab", (WEST_X, SIDE_ROAD_X, walk_y0, walk_y1, ROAD_TOP - 0.14, SIDEWALK_TOP),
        M["concrete"], st, bevel=0.006)

    # --- kerb: a long run along the front road and one that turns the corner --
    box("Kerb_Long", (WEST_X, SIDE_ROAD_X, kerb_y, walk_y0, ROAD_TOP - 0.14, SIDEWALK_TOP),
        M["concrete_clean"], st, bevel=0.005)
    box("Kerb_Side", (SIDE_ROAD_X, SIDE_ROAD_X + 0.16, walk_y0, REAR_Y,
                     ROAD_TOP - 0.14, SIDEWALK_TOP), M["concrete_clean"], st, bevel=0.005)

    # --- roads ----------------------------------------------------------------
    box("Road_Asphalt_Front", (WEST_X, SIDE_ROAD_X + 0.16, CURB_Y - 12.0, road_y,
                               ROAD_TOP - 0.14, ROAD_TOP), M["asphalt"], st, bevel=0.005)
    box("Road_Asphalt_Side", (SIDE_ROAD_X + 0.16, EAST_X, CURB_Y - 12.0, REAR_Y,
                              ROAD_TOP - 0.14, ROAD_TOP), M["asphalt"], st, bevel=0.005)

    # --- kerb gutter: a concrete channel in the road with the drains set in it
    drain_x = [-6.0 + i * 2.0 for i in range(7)]
    gutter_top = ROAD_TOP - 0.03
    segments = []
    cursor = WEST_X
    for dx in drain_x:
        segments.append((cursor, dx - 0.30))
        cursor = dx + 0.30
    segments.append((cursor, SIDE_ROAD_X))
    for i, (x0, x1) in enumerate(segments, 1):
        if x1 - x0 > 0.01:
            box(f"Gutter_Strip_{i}", (x0, x1, road_y, kerb_y,
                                      ROAD_TOP - 0.14, gutter_top),
                M["concrete_clean"], st, bevel=0.004)
    for i, dx in enumerate(drain_x, 1):
        box(f"Drain_Grate_{i}", (dx - 0.30, dx + 0.30, road_y, kerb_y,
                                 ROAD_TOP - 0.14, gutter_top), M["steel_dark"], st)

    # --- repair patches, laid on top of the asphalt as tar does ---------------
    for i, (px0, px1, py0, py1) in enumerate([(-9.5, -5.5, -9.4, -6.4),
                                              (1.5, 5.0, -10.6, -7.8),
                                              (8.0, 12.0, -8.5, -5.0)], 1):
        box(f"Road_Patch_{i}", (px0, px1, py0, py1, ROAD_TOP + 0.002, ROAD_TOP + 0.010),
            M["asphalt_patch"], st, bevel=0.004)

    for i in range(8):
        mx = -10.5 + i * 2.6
        box(f"Road_Centre_Line_{i + 1}", (mx - 0.06, mx + 0.06, -10.6, -8.4,
                                          ROAD_TOP, ROAD_TOP + 0.004), M["sign_white"], st)
    box("Road_Stop_Line", (-13.6, -11.4, CURB_Y - 3.4, CURB_Y - 3.28,
                           ROAD_TOP, ROAD_TOP + 0.004), M["sign_white"], st)
    for i in range(9):
        cx = 8.6 + i * 0.62
        box(f"Crossing_Stripe_{i + 1}", (cx - 0.24, cx + 0.24, CURB_Y - 4.6, CURB_Y - 3.5,
                                        ROAD_TOP, ROAD_TOP + 0.004), M["sign_white"], st)

    box("Tactile_Paving", (WEST_X + 0.2, SIDE_ROAD_X - 0.4, CURB_Y + 0.10, CURB_Y + 0.70,
                           SIDEWALK_TOP, SIDEWALK_TOP + 0.010), M["tactile"], st, bevel=0.003)

    for i, (px, py, sx, sy) in enumerate([(-6.0, -8.2, 2.6, 1.1), (2.4, -9.6, 3.4, 1.3),
                                           (10.6, -7.4, 2.2, 0.9), (11.8, -3.0, 1.6, 2.4)], 1):
        puddle = cylinder(f"Puddle_{i}", 1.0, ROAD_TOP, ROAD_TOP + 0.003, px, py, M["water"],
                          st, vertices=28)
        puddle.scale = (sx / 2, sy / 2, 1.0)

    build_road_signs(M)
    build_utility_pole(M)
    build_street_props(M)


def build_road_signs(M):
    """Roadside signage.

    The reference shows a long white guide board with black Japanese text on
    galvanised posts, so the board uses the same proportions and mounting.
    """
    st = COL["Street"]
    sign_col = COL["Signage"]

    bx = -9.60
    board_z0, board_z1 = 2.05, 2.86
    board_w = 3.60
    for i, px in enumerate((bx - board_w / 2 + 0.12, bx + board_w / 2 - 0.12), 1):
        # The post stands *on* its base block, not through it.
        box(f"Sign_Board_Post_Base_{i}", (px - 0.11, px + 0.11, CURB_Y + 1.19, CURB_Y + 1.41,
                                          SIDEWALK_TOP, SIDEWALK_TOP + 0.05),
            M["concrete_clean"], st, bevel=0.004)
        cylinder(f"Sign_Board_Post_{i}", 0.055, SIDEWALK_TOP + 0.05, board_z1 + 0.10, px,
                 CURB_Y + 1.30, M["steel"], st, vertices=12)
    box("Guide_Board_Frame", (bx - board_w / 2, bx + board_w / 2, CURB_Y + 1.26, CURB_Y + 1.32,
                              board_z0, board_z1), M["steel"], sign_col, bevel=0.005)
    # The face is set into the frame from the front, so it stops at the posts.
    box("Guide_Board_Face", (bx - board_w / 2 + 0.05, bx + board_w / 2 - 0.05,
                             CURB_Y + 1.21, CURB_Y + 1.245, board_z0 + 0.05, board_z1 - 0.05),
        M["sign_white"], sign_col, bevel=0.003)
    text("Guide_Board_Text", "つじの Store 前", bx, CURB_Y + 1.205, (board_z0 + board_z1) / 2,
         0.28, M["sign_black"], sign_col, facing="-y")

    sx, sy = 6.40, CURB_Y + 1.10
    box("Sign_Square_Base", (sx - 0.10, sx + 0.10, sy - 0.10, sy + 0.10,
                             SIDEWALK_TOP, SIDEWALK_TOP + 0.04), M["concrete_clean"], st, bevel=0.004)
    cylinder("Sign_Square_Post", 0.048, SIDEWALK_TOP + 0.04, 2.55, sx, sy, M["steel"], st, vertices=12)
    box("Sign_Square_Plate", (sx - 0.38, sx + 0.38, sy - 0.028, sy + 0.028, 1.85, 2.55),
        M["sign_blue"], sign_col, bevel=0.006)
    text("Sign_Square_Text", "一方通行", sx, sy - 0.032, 2.20, 0.19, M["sign_white"],
         sign_col, facing="-y")

    nx, ny = 9.20, CURB_Y + 0.95
    cylinder("Sign_Round_Post", 0.038, SIDEWALK_TOP, 2.10, nx, ny, M["steel"], st, vertices=10)
    cylinder("Sign_Round_Plate", 0.24, 2.05, 2.09, nx, ny, M["sign_white"], sign_col, vertices=20)
    cylinder("Sign_Round_Rim", 0.26, 2.03, 2.05, nx, ny, M["steel"], st, vertices=20)

    tx, ty = SIDE_ROAD_X + 0.45, CURB_Y + 0.55
    cylinder("Name_Plate_Post", 0.05, SIDEWALK_TOP, 2.75, tx, ty, M["steel"], st, vertices=12)
    box("Name_Plate", (tx - 0.42, tx + 0.42, ty - 0.03, ty + 0.03, 2.28, 2.66),
        M["sign_blue"], sign_col, bevel=0.005)
    text("Name_Plate_Text", "三 丁目", tx, ty - 0.034, 2.47, 0.17, M["sign_white"],
         sign_col, facing="-y")


def build_utility_pole(M):
    """Concrete utility pole with a crossarm, insulators and sagging cables."""
    st = COL["Street"]
    px, py = 11.90, CURB_Y + 1.20
    top = 8.40
    # The pole starts at the top of its base block, so the two are stacked
    # rather than one being pushed into the other.
    box("Utility_Pole_Base", (px - 0.22, px + 0.22, py - 0.22, py + 0.22,
                              SIDEWALK_TOP, SIDEWALK_TOP + 0.11),
        M["concrete_clean"], st, bevel=0.006)
    cylinder("Utility_Pole", 0.115, SIDEWALK_TOP + 0.11, top, px, py, M["concrete"], st, vertices=12)
    cylinder_between("Pole_Crossarm", (px - 1.05, py, top - 0.35), (px + 1.05, py, top - 0.35),
                     0.055, M["wood"], st, vertices=10)
    for i, ox in enumerate((-0.85, -0.30, 0.30, 0.85), 1):
        cylinder(f"Pole_Insulator_{i}", 0.055, top - 0.35, top - 0.14, px + ox, py,
                 M["plastic_white"], st, vertices=10)
    cylinder("Pole_Transformer", 0.22, 5.55, 6.35, px + 0.38, py + 0.16, M["steel"], st, vertices=14)
    box("Pole_Junction_Box", (px - 0.34, px - 0.02, py + 0.10, py + 0.34, 4.20, 4.72),
        M["steel"], st, bevel=0.006)

    for i, ox in enumerate((-0.85, -0.30, 0.30), 1):
        start = (px + ox, py, top - 0.14)
        mid = (px + ox - 1.6, py - 0.4, top - 1.05)
        end = (px + ox - 3.4, py - 0.9, top - 0.55)
        pts = []
        for t in (0.0, 0.25, 0.5, 0.75, 1.0):
            x = start[0] + (end[0] - start[0]) * t
            y = start[1] + (end[1] - start[1]) * t
            z = (start[2] * (1 - t) ** 2 + 2 * mid[2] * (1 - t) * t + end[2] * t ** 2)
            pts.append((x, y, z))
        curve_line(f"Overhead_Cable_{i}", pts, 0.016, M["steel_dark"], st)


def build_street_props(M):
    """Vending machine, bicycle rack with bicycles, bin, guardrail, AC unit."""
    st = COL["Street"]
    props = COL["Props"]

    # --- vending machine beside the right pier ------------------------------
    vx0, vx1 = 5.05, 6.35
    vy0, vy1 = -6.05, -4.72
    box("Vending_Machine_Body", (vx0, vx1, vy0, vy1, SIDEWALK_TOP, SIDEWALK_TOP + 1.85),
        M["plastic_white"], props, bevel=0.014)
    box("Vending_Machine_Glass", (vx0 + 0.10, vx1 - 0.10, vy0 - 0.012, vy0 + 0.02,
                                  SIDEWALK_TOP + 0.42, SIDEWALK_TOP + 1.62),
        M["glass"], props, bevel=0.005)
    box("Vending_Machine_Face", (vx0 + 0.10, vx1 - 0.10, vy0 - 0.03, vy0 + 0.01,
                                 SIDEWALK_TOP + 1.62, SIDEWALK_TOP + 1.80),
        M["paint_blue"], props, bevel=0.005)
    box("Vending_Machine_Dispenser", (vx0 + 0.22, vx1 - 0.22, vy0 - 0.10, vy0 - 0.01,
                                      SIDEWALK_TOP + 0.14, SIDEWALK_TOP + 0.36),
        M["steel_dark"], props, bevel=0.005)
    for i in range(3):
        bx = vx0 + 0.24 + i * 0.36
        cylinder(f"Vending_Can_{i + 1}", 0.033, SIDEWALK_TOP + 0.60, SIDEWALK_TOP + 0.72,
                 bx, vy0 + 0.16, M["paper"], props, vertices=12)

    # --- bicycle rack: three inverted-U hoops ------------------------------
    rx = -3.60
    ry = -6.60
    for i in range(3):
        px = rx - 0.80 + i * 0.80
        cylinder_between(f"Bike_Rack_Post_{i + 1}_A", (px, ry - 0.28, SIDEWALK_TOP),
                         (px, ry - 0.28, SIDEWALK_TOP + 0.72), 0.030, M["steel"], st, vertices=10)
        cylinder_between(f"Bike_Rack_Post_{i + 1}_B", (px, ry - 0.28, SIDEWALK_TOP + 0.72),
                         (px, ry + 0.28, SIDEWALK_TOP + 0.72), 0.028, M["steel"], st, vertices=10)
        cylinder_between(f"Bike_Rack_Post_{i + 1}_C", (px, ry + 0.28, SIDEWALK_TOP + 0.72),
                         (px, ry + 0.28, SIDEWALK_TOP), 0.030, M["steel"], st, vertices=10)

    build_bicycle(M, -4.40, ry + 0.10, lean=0.0, index=1)
    build_bicycle(M, -2.80, ry + 0.10, lean=0.0, index=2)
    build_bicycle(M, 2.60, ry - 0.40, lean=math.radians(86), index=3)

    # --- litter bin ----------------------------------------------------------
    # The bin body stands on the pavement, the rim caps it and the post rises
    # through the middle; each part stops where the next one starts.
    bxx, byy = 4.35, -6.85
    cylinder("Litter_Bin_Body", 0.24, SIDEWALK_TOP, SIDEWALK_TOP + 0.72, bxx, byy, M["steel"], st, vertices=16)
    cylinder("Litter_Bin_Rim", 0.26, SIDEWALK_TOP + 0.72, SIDEWALK_TOP + 0.78, bxx, byy,
             M["steel_dark"], st, vertices=16)
    cylinder("Litter_Bin_Post", 0.045, SIDEWALK_TOP + 0.78, SIDEWALK_TOP + 0.98, bxx, byy,
             M["steel"], st, vertices=10)

    # --- corner guardrail ----------------------------------------------------
    gx = SIDE_ROAD_X + 0.30
    for i in range(5):
        gy = CURB_Y + 0.9 + i * 1.05
        cylinder(f"Guardrail_Post_{i + 1}", 0.05, SIDEWALK_TOP, SIDEWALK_TOP + 0.72, gx, gy,
                 M["steel"], st, vertices=10)
    cylinder_between("Guardrail_Rail", (gx, CURB_Y + 0.9, SIDEWALK_TOP + 0.66),
                     (gx, CURB_Y + 0.9 + 4 * 1.05, SIDEWALK_TOP + 0.66), 0.045, M["steel"], st, vertices=10)

    # --- AC unit bolted to the facade ---------------------------------------
    # The bracket stands the unit off the wall so nothing is buried in it.
    box("Wall_AC_Bracket", (STORE_X0 - 0.20, STORE_X0 - 0.06, -3.05, -2.85,
                             SIDEWALK_TOP + 1.95, SIDEWALK_TOP + 2.55), M["steel_dark"], props, bevel=0.005)
    box("Wall_AC_Unit", (STORE_X0 - 0.62, STORE_X0 - 0.20, -3.30, -2.60,
                         SIDEWALK_TOP + 1.95, SIDEWALK_TOP + 2.55), M["steel"], props, bevel=0.010)
    cylinder("Wall_AC_Fan", 0.22, SIDEWALK_TOP + 2.55, SIDEWALK_TOP + 2.58,
             STORE_X0 - 0.41, -2.95, M["steel_dark"], props, vertices=16)

    # --- notice board near the entrance ---------------------------------------
    nx = -2.20
    box("Notice_Board_Panel", (nx - 0.55, nx + 0.55, -7.35, -7.30,
                               SIDEWALK_TOP + 0.70, SIDEWALK_TOP + 1.85),
        M["steel"], props, bevel=0.005)
    for i in range(2):
        cylinder(f"Notice_Board_Post_{i + 1}", 0.04, SIDEWALK_TOP, SIDEWALK_TOP + 0.72,
                 nx - 0.44 + i * 0.88, -7.325, M["steel"], props, vertices=10)
    for i in range(3):
        box(f"Notice_Poster_{i + 1}", (nx - 0.44 + i * 0.36, nx - 0.16 + i * 0.36, -7.36, -7.352,
                                       SIDEWALK_TOP + 0.85 + (i % 2) * 0.05,
                                       SIDEWALK_TOP + 1.35 + (i % 2) * 0.05),
            M["paper"], props)


def build_bicycle(M, x: float, y: float, lean: float = 0.0, index: int = 1):
    """A bicycle whose tyres and stand actually touch the pavement.

    The whole assembly is authored in the local space of an empty placed on the
    ground contact point, so tipping the bike (the ``lean`` angle) keeps the
    contact point exactly on the pavement.
    """
    st = COL["Street"]
    name = f"Bicycle_{index}"
    wheel_r = 0.34
    tyre = 0.032
    z_center = wheel_r + tyre  # local height of the axle above the contact point

    root = empty(name, (x, y, SIDEWALK_TOP), st, size=0.25)
    root["state"] = "lying on the pavement" if lean > 0.5 else "parked at the rack"

    def add(obj):
        attach(obj, root)
        return obj

    for tag, off in (("Rear", 0.53), ("Front", -0.53)):
        wx = off
        add(torus(f"{name}_{tag}_Tyre", wheel_r, tyre, wx, 0, z_center, M["rubber"], st))
        add(torus(f"{name}_{tag}_Rim", wheel_r - 0.03, 0.014, wx, 0, z_center, M["aluminium"], st))
        add(cylinder_between(f"{name}_{tag}_Hub", (wx - 0.055, 0, z_center), (wx + 0.055, 0, z_center),
                             0.032, M["steel"], st, vertices=10))
        for i in range(10):
            a = math.tau * i / 10
            add(cylinder_between(f"{name}_{tag}_Spoke_{i + 1}", (wx, 0, z_center),
                                  (wx, (wheel_r - 0.035) * math.sin(a),
                                   z_center + (wheel_r - 0.035) * math.cos(a)),
                                  0.005, M["aluminium"], st, vertices=6))

    bb = (0.0, 0.0, z_center - 0.05)
    seat = (-0.18, 0.0, z_center + 0.52)
    head = (0.40, 0.0, z_center + 0.48)
    rear = (0.53, 0.0, z_center)
    front = (-0.53, 0.0, z_center)
    for tag, a, b in (("Seat_Tube", bb, seat), ("Top_Tube", seat, head), ("Down_Tube", head, bb),
                      ("Chainstay", bb, rear), ("Seatstay", seat, rear), ("Fork", head, front)):
        add(cylinder_between(f"{name}_Frame_{tag}", a, b, 0.023, M["steel_dark"], st, vertices=10))

    add(cylinder_between(f"{name}_Handle_Stem", head, (0.40, 0.0, z_center + 0.62),
                         0.017, M["steel"], st, vertices=8))
    add(cylinder_between(f"{name}_Handlebar", (0.40, -0.24, z_center + 0.62),
                         (0.40, 0.24, z_center + 0.62), 0.014, M["steel"], st, vertices=8))
    add(cylinder_between(f"{name}_Seat_Post", seat, (-0.20, 0.0, z_center + 0.60),
                         0.014, M["steel"], st, vertices=8))
    add(box(f"{name}_Saddle", (-0.32, -0.10, -0.075, 0.075, z_center + 0.58, z_center + 0.64),
            M["rubber"], st, bevel=0.018))
    add(cylinder_between(f"{name}_Crank_Axle", (0, -0.11, bb[2]), (0, 0.11, bb[2]),
                         0.016, M["steel"], st, vertices=8))
    add(cylinder(f"{name}_Chainring", 0.10, bb[2] - 0.008, bb[2] + 0.008, 0, 0,
                 M["steel"], st, vertices=16, axis="y"))
    add(box(f"{name}_Chain", (-0.02, 0.55, -0.012, 0.012, bb[2] - 0.03, bb[2] + 0.03),
            M["steel_dark"], st))

    add(box(f"{name}_Basket_Bottom", (0.26, 0.54, -0.15, 0.15, z_center + 0.36, z_center + 0.38),
            M["steel"], st))
    for i in range(4):
        by = -0.14 + i * 0.093
        add(cylinder_between(f"{name}_Basket_Rail_{i + 1}", (0.27, by, z_center + 0.38),
                             (0.53, by, z_center + 0.62), 0.010, M["steel"], st, vertices=6))

    # The kickstand foot sits on the pavement, so the bike has a support point.
    add(cylinder_between(f"{name}_Kickstand", (-0.05, 0.0, bb[2] - 0.03), (-0.16, 0.22, 0.0),
                         0.012, M["steel"], st, vertices=8))

    if lean:
        root.rotation_euler[0] = lean
        # After tipping the bike onto its side, lift it so the frame rests on the
        # pavement rather than sinking into it.
        root.location.z = SIDEWALK_TOP + 0.02
    return root


# ===========================================================================
# Debris
# ===========================================================================
def build_debris(M):
    """Abandoned props scattered on the walk and inside the shop."""
    props = COL["Props"]

    for i in range(9):
        px = random.uniform(-4.2, 3.6)
        py = random.uniform(-3.4, 3.0)
        pick = random.random()
        if pick < 0.4:
            goods.can(f"Floor_Can_{i + 1}", px, py, FLOOR_Z, "cola", M["paper"], COL["Goods"])
        elif pick < 0.7:
            goods.chip_bag(f"Floor_Bag_{i + 1}", px, py, FLOOR_Z, M["paper"], COL["Goods"],
                           lean=random.uniform(-1.4, 1.4))
        else:
            goods.pouch(f"Floor_Pouch_{i + 1}", px, py, FLOOR_Z, M["paper"], COL["Goods"])

    goods.basket("Basket_Outside", 3.05, -6.20, SIDEWALK_TOP, M["plastic_red"], props,
                 width=0.30, depth=0.22, height=0.20)

    for i in range(12):
        gx = random.uniform(-1.9, 1.9)
        gy = random.uniform(-6.2, -4.9)
        shard = box(f"Glass_Shard_{i + 1}", (gx, gx + random.uniform(0.03, 0.09),
                                             gy, gy + random.uniform(0.03, 0.08),
                                             SIDEWALK_TOP, SIDEWALK_TOP + 0.006),
                    M["glass_broken"], props)
        shard.rotation_euler[2] = random.uniform(0, math.tau)

    box("Fallen_Sign_Panel", (-5.95, -4.85, -7.60, -7.02, SIDEWALK_TOP, SIDEWALK_TOP + 0.06),
        M["paint_blue"], props, bevel=0.006)

    cylinder("Traffic_Cone_Base", 0.16, SIDEWALK_TOP, SIDEWALK_TOP + 0.02, 7.40, -7.60,
             M["plastic_red"], props, vertices=14)
    cylinder("Traffic_Cone_Body", 0.155, SIDEWALK_TOP + 0.02, SIDEWALK_TOP + 0.56, 7.40, -7.60,
             M["plastic_red"], props, vertices=14, taper=0.18)
    cylinder("Traffic_Cone_Band", 0.115, SIDEWALK_TOP + 0.26, SIDEWALK_TOP + 0.34, 7.40, -7.60,
             M["sign_white"], props, vertices=14, taper=0.86)

    for i in range(26):
        lx = random.uniform(WEST_X + 1.0, SIDE_ROAD_X - 1.0)
        ly = random.uniform(CURB_Y + 0.2, -4.8)
        leaf = box(f"Leaf_{i + 1}", (lx, lx + random.uniform(0.04, 0.09),
                                     ly, ly + random.uniform(0.03, 0.07),
                                     SIDEWALK_TOP, SIDEWALK_TOP + 0.002), M["leaf"], props)
        leaf.rotation_euler[2] = random.uniform(0, math.tau)

    for i, (px, py) in enumerate([(-1.2, -5.4), (2.6, -6.9), (-4.4, -6.2)], 1):
        decal(f"Wet_Patch_{i}", px, py, SIDEWALK_TOP + 0.0012, 1.6, 1.1, M["water"], COL["Decals"],
              normal="+z", seed=40 + i)


# ===========================================================================
# Lighting, camera and rendering
# ===========================================================================
def setup_world_and_lights(M):
    scene = bpy.context.scene
    world = bpy.data.worlds.new("Overcast night") if not bpy.data.worlds else bpy.data.worlds[0]
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.020, 0.032, 0.062, 1)
    bg.inputs["Strength"].default_value = 0.22

    # A deep blue night sky dome gives the upper half of the frame the cold
    # cast the reference render has; without it the background renders flat.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=90,
                                          location=(0, 0, 0))
    sky = bpy.context.object
    sky.name = "Night_Sky_Dome"
    sky.data.materials.append(M["sky"])
    for poly in sky.data.polygons:
        poly.use_smooth = True
    move_to(sky, COL["Lighting"])
    sky.visible_shadow = False

    def area(name, loc, power, color, size, target):
        bpy.ops.object.light_add(type="AREA", location=loc)
        obj = bpy.context.object
        obj.name = name
        obj.data.energy = power
        obj.data.color = color
        obj.data.shape = "DISK"
        obj.data.size = size
        obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
        return obj

    # Cold sky fill from above and a warm spill from the shop.
    area("Key_Sky", (2, 14, 18), 4200, (0.55, 0.70, 1.0), 18, (0, -2, 0))
    area("Warm_Shop_Spill", (0, -4.4, 2.6), 5200, (1.0, 0.66, 0.34), 7, (0, -9.5, 0.8))
    area("Shop_Front_Wash", (0, -6.2, 3.1), 2600, (1.0, 0.80, 0.58), 9, (0, -4.6, 2.0))
    area("Cool_Side_Fill", (-15, -8, 9), 1500, (0.50, 0.64, 0.95), 12, (0, -5, 1))
    area("Cool_Back_Fill", (14, 12, 12), 1400, (0.45, 0.58, 0.92), 14, (0, 0, 2))
    area("Street_Lamp_Pool", (11.90, CURB_Y + 1.2, 7.4), 1400, (1.0, 0.76, 0.45), 4,
          (11.90, CURB_Y + 1.2, 0))

    box("Pole_Lamp_Housing", (11.62, 12.18, CURB_Y + 1.0, CURB_Y + 1.4, 7.45, 7.72),
        M["steel"], COL["Lighting"], bevel=0.008)
    box("Pole_Lamp_Lens", (11.70, 12.10, CURB_Y + 1.06, CURB_Y + 1.34, 7.36, 7.45),
        M["lamp_warm"], COL["Lighting"], bevel=0.006)

    # Interior fill lights: the shop reads as the warm core of the frame.
    # Several point lights down each aisle give the shelves a lit gradient
    # instead of one flat wash.
    for i, (lx, ly) in enumerate([(-4.6, -2.6), (-4.6, 0.0), (-4.6, 2.6),
                                  (-0.9, -2.6), (-0.9, 0.0), (-0.9, 2.6),
                                  (2.6, -2.6), (2.6, 0.0), (2.6, 2.6)], 1):
        bpy.ops.object.light_add(type="POINT", location=(lx, ly, FLOOR_Z + 2.6))
        obj = bpy.context.object
        obj.name = f"Interior_Fill_{i}"
        obj.data.energy = 70
        obj.data.color = (1.0, 0.78, 0.52)
        obj.data.shadow_soft_size = 0.6
        # Nine extra shadow-casting lights overflow EEVEE's shadow pool, which
        # silently drops shadows. The aisle fill only needs to add light, so
        # these lights are shadowless and the area lights carry the shadows.
        obj.data.use_shadow = False


def setup_camera():
    scene = bpy.context.scene
    # The reference frame puts the warm shop front in the lower left and lets
    # the cold night sky and the utility pole fill the upper right.
    bpy.ops.object.camera_add(location=(8.8, -13.4, 3.6))
    cam = bpy.context.object
    cam.name = "Post_Outbreak_Exterior_Camera"
    cam.rotation_euler = (Vector((-2.4, -1.6, 1.45)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 30
    scene.camera = cam

    # Entrance view: the lit shop front seen from the pavement.
    bpy.ops.object.camera_add(location=(2.9, -8.4, 1.85))
    cam2 = bpy.context.object
    cam2.name = "Post_Outbreak_Entrance_Camera"
    cam2.rotation_euler = (Vector((-0.6, -3.2, 1.30)) - cam2.location).to_track_quat("-Z", "Y").to_euler()
    cam2.data.lens = 24

    # Interior aisle view: looks down the run between the left wall shelving
    # and the centre run, which is the shot that shows how full the shop is.
    bpy.ops.object.camera_add(location=(-4.42, -4.10, 1.58))
    cam3 = bpy.context.object
    cam3.name = "Post_Outbreak_Interior_Camera"
    cam3.rotation_euler = (Vector((-4.42, 3.80, 1.10)) - cam3.location).to_track_quat("-Z", "Y").to_euler()
    cam3.data.lens = 20

    # Top-down orthographic plan: used to check the fixture layout against the
    # blueprint, and to show that the aisles are actually filled.
    bpy.ops.object.camera_add(location=(0.0, 0.0, 24.0))
    cam4 = bpy.context.object
    cam4.name = "Post_Outbreak_Plan_Camera"
    cam4.rotation_euler = (0.0, 0.0, 0.0)
    cam4.data.type = "ORTHO"
    cam4.data.ortho_scale = 16.0

    engines = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if candidate in engines:
            scene.render.engine = candidate
            break
    try:
        scene.eevee.taa_render_samples = 64
    except Exception:
        pass
    # The scene lights the shop with a handful of area lights plus shadowless
    # fills; the default pool is too small for them and silently drops shadows.
    for attr, value in (("shadow_pool_size", "512"), ("shadow_ray_count", 2),
                         ("shadow_step_count", 6), ("use_shadows", True)):
        try:
            setattr(scene.eevee, attr, value)
        except Exception:
            pass
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False


def render_with_override(path: str, override=None, camera: str = "Post_Outbreak_Exterior_Camera"):
    scene = bpy.context.scene
    scene.camera = bpy.data.objects[camera]
    layer = scene.view_layers[0]
    previous = layer.material_override
    layer.material_override = override
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    layer.material_override = previous


# ===========================================================================
# Entry point
# ===========================================================================
def main():
    global COL
    clear_scene()
    for name in ("Architecture", "Glazing", "Doors", "Fixtures", "Cooler", "Goods",
                 "Props", "Signage", "Street", "Decals", "Lighting"):
        COL[name] = collection(name)

    M = build_materials()
    build_shell(M)
    build_interior(M)
    build_street(M)
    build_debris(M)
    setup_world_and_lights(M)
    setup_camera()

    ensure_dir(WHITE_OUT)
    ensure_dir(LIT_OUT)
    ensure_dir(GLB_OUT)
    ensure_dir(BLEND_OUT)

    # Report parts that interpenetrate instead of meeting face to face.
    from konbini_scene import audit
    audit.main()

    render_with_override(WHITE_OUT, M["white_clay"])
    render_with_override(LIT_OUT, None)
    render_with_override(os.path.join(ASSET_DIR, "konbini-post-outbreak-entrance.png"), None,
                         camera="Post_Outbreak_Entrance_Camera")
    render_with_override(os.path.join(ASSET_DIR, "konbini-post-outbreak-interior.png"), None,
                         camera="Post_Outbreak_Interior_Camera")
    render_with_override(os.path.join(ASSET_DIR, "konbini-post-outbreak-plan.png"), None,
                         camera="Post_Outbreak_Plan_Camera")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.context.scene.objects:
        if obj.type in {"MESH", "EMPTY", "CURVE", "FONT"}:
            obj.select_set(True)
    bpy.context.view_layer.objects.active = None
    bpy.ops.export_scene.gltf(filepath=GLB_OUT, export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True, export_materials="EXPORT",
                              export_cameras=False, export_lights=False, export_extras=True,
                              export_animations=False)
    print("POST_OUTBREAK_OUTPUTS", BLEND_OUT, GLB_OUT, WHITE_OUT, LIT_OUT)


if __name__ == "__main__":
    main()
