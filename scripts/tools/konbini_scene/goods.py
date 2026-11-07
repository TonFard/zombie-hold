"""Reusable product meshes: drinks and convenience food.

Each builder returns a mesh object whose origin sits on the product's base so
it can be dropped onto a shelf or the floor and stay in contact. Labels are
material variants, never extra geometry stacked on the body.

The packaging palette is deliberately loud: a konbini aisle reads as a wall of
saturated colour, and that colour is what sells the "shop is full" feeling in
the render.
"""
from __future__ import annotations

import math
import random

from .common import box, cylinder, cylinder_between, torus

# Drink label colours: (body colour, label colour) per flavour.
LABEL_COLORS = {
    "cola": (0.115, 0.020, 0.018),
    "green_tea": (0.040, 0.115, 0.055),
    "coffee": (0.075, 0.045, 0.028),
    "water_blue": (0.055, 0.115, 0.175),
    "sports": (0.070, 0.130, 0.165),
    "juice": (0.210, 0.105, 0.022),
    "milk": (0.480, 0.470, 0.450),
    "tonic": (0.028, 0.070, 0.095),
}

# The bright wrap colour used for the label band on a bottle or can.
WRAP_COLORS = {
    "cola": (0.72, 0.09, 0.07),
    "green_tea": (0.16, 0.52, 0.20),
    "coffee": (0.34, 0.19, 0.10),
    "water_blue": (0.16, 0.48, 0.82),
    "sports": (0.10, 0.62, 0.78),
    "juice": (0.92, 0.44, 0.06),
    "milk": (0.24, 0.36, 0.66),
    "tonic": (0.10, 0.28, 0.52),
}

# Snack bag wrap palette.
SNACK_COLORS = (
    (0.86, 0.24, 0.12),
    (0.94, 0.62, 0.10),
    (0.22, 0.56, 0.30),
    (0.14, 0.40, 0.78),
    (0.72, 0.18, 0.56),
    (0.90, 0.86, 0.24),
    (0.80, 0.36, 0.12),
    (0.30, 0.72, 0.70),
)


def can(name: str, x: float, y: float, z_base: float, flavour: str, mat_body, col,
        radius: float = 0.033, height: float = 0.122, mat_wrap=None):
    """Slim drink can standing on ``z_base``."""
    body = cylinder(name, radius, z_base, z_base + height - 0.006, x, y, mat_body, col, vertices=16)
    body.rotation_euler[2] = random.uniform(0, math.pi)
    # The label band is a separate material, so the can reads as printed stock.
    if mat_wrap is not None:
        cylinder(name + " | wrap", radius * 1.008, z_base + 0.012, z_base + height - 0.014,
                 x, y, mat_wrap, col, vertices=16)
    # Lid slightly recessed so the top reads as metal, not a capped cylinder.
    cylinder(name + " | lid", radius * 0.92, z_base + height - 0.008, z_base + height - 0.004,
             x, y, mat_body, col, vertices=16)
    return body


def pet_bottle(name: str, x: float, y: float, z_base: float, flavour: str, mat_body,
               mat_label, col, height: float = 0.205, radius: float = 0.031):
    """PET bottle with a waisted body, shoulder and cap."""
    body = cylinder(name + " | body", radius, z_base + 0.012, z_base + height * 0.66, x, y,
                    mat_body, col, vertices=14)
    cylinder(name + " | label", radius * 1.02, z_base + 0.035, z_base + height * 0.60, x, y,
             mat_label, col, vertices=14)
    cylinder(name + " | shoulder", radius, z_base + height * 0.66, z_base + height * 0.84, x, y,
             mat_body, col, vertices=14, taper=0.45)
    cylinder(name + " | neck", radius * 0.45, z_base + height * 0.84, z_base + height * 0.93, x, y,
             mat_body, col, vertices=12)
    cylinder(name + " | cap", radius * 0.52, z_base + height * 0.93, z_base + height, x, y,
             mat_label, col, vertices=12)
    return body


def glass_bottle(name: str, x: float, y: float, z_base: float, mat_body, mat_label, col,
                 height: float = 0.235, radius: float = 0.027):
    cylinder(name + " | body", radius, z_base, z_base + height * 0.70, x, y, mat_body, col,
             vertices=14)
    cylinder(name + " | label", radius * 1.03, z_base + 0.028, z_base + height * 0.62, x, y,
             mat_label, col, vertices=14)
    cylinder(name + " | shoulder", radius, z_base + height * 0.70, z_base + height * 0.86, x, y,
             mat_body, col, vertices=14, taper=0.42)
    cylinder(name + " | cap", radius * 0.46, z_base + height * 0.86, z_base + height, x, y,
             mat_label, col, vertices=10)
    return None


def chip_bag(name: str, x: float, y: float, z_base: float, mat_body, col,
             width: float = 0.145, depth: float = 0.055, height: float = 0.235,
             lean: float = 0.0):
    """Crinkled snack bag: a slightly tapered slab with a pinched top."""
    obj = box(name, (x - width / 2, x + width / 2, y - depth / 2, y + depth / 2,
                     z_base, z_base + height), mat_body, col, bevel=0.012)
    if lean:
        obj.rotation_euler[1] = lean
    box(name + " | crimp", (x - width * 0.44, x + width * 0.44, y - depth * 0.36, y + depth * 0.36,
                            z_base + height, z_base + height + 0.012), mat_body, col, bevel=0.004)
    return obj


def pouch(name: str, x: float, y: float, z_base: float, mat_body, col,
          width: float = 0.115, depth: float = 0.035, height: float = 0.155):
    return box(name, (x - width / 2, x + width / 2, y - depth / 2, y + depth / 2,
                      z_base, z_base + height), mat_body, col, bevel=0.010)


def cup_noodle(name: str, x: float, y: float, z_base: float, mat_body, mat_lid, col,
               radius: float = 0.052, height: float = 0.115):
    cylinder(name + " | cup", radius, z_base, z_base + height, x, y, mat_body, col, vertices=16,
             taper=1.12)
    cylinder(name + " | lid", radius * 1.14, z_base + height, z_base + height + 0.008, x, y,
             mat_lid, col, vertices=16)
    return None


def carton(name: str, x: float, y: float, z_base: float, mat_body, col,
           width: float = 0.135, depth: float = 0.085, height: float = 0.185):
    """Shelf-ready cardboard case: a plain box with a folded top flap."""
    body = box(name, (x - width / 2, x + width / 2, y - depth / 2, y + depth / 2,
                      z_base, z_base + height), mat_body, col, bevel=0.004)
    box(name + " | flap", (x - width / 2, x + width / 2, y - depth / 2, y + depth / 2,
                           z_base + height, z_base + height + 0.006), mat_body, col, bevel=0.002)
    return body


def bento_tray(name: str, x: float, y: float, z_base: float, mat_tray, mat_lid, col,
               width: float = 0.175, depth: float = 0.115, height: float = 0.045):
    box(name + " | tray", (x - width / 2, x + width / 2, y - depth / 2, y + depth / 2,
                           z_base, z_base + height), mat_tray, col, bevel=0.004)
    box(name + " | lid", (x - width / 2 - 0.002, x + width / 2 + 0.002, y - depth / 2 - 0.002,
                          y + depth / 2 + 0.002, z_base + height, z_base + height + 0.010),
        mat_lid, col, bevel=0.003)
    return None


def onigiri(name: str, x: float, y: float, z_base: float, mat_body, mat_wrap, col,
            width: float = 0.085, depth: float = 0.045, height: float = 0.075):
    """Rice ball: a rounded triangle approximation with a wrapper band."""
    body = box(name + " | body", (x - width / 2, x + width / 2, y - depth / 2, y + depth / 2,
                                  z_base, z_base + height), mat_body, col, bevel=0.022)
    box(name + " | wrap", (x - width * 0.30, x + width * 0.30, y - depth / 2 - 0.002,
                           y + depth / 2 + 0.002, z_base, z_base + height * 0.52),
        mat_wrap, col, bevel=0.006)
    return body


def magazine(name: str, x: float, y: float, z_base: float, mat_body, col,
             width: float = 0.165, depth: float = 0.008, height: float = 0.235,
             tilt: float = 0.0):
    obj = box(name, (x - width / 2, x + width / 2, y - depth / 2, y + depth / 2,
                     z_base, z_base + height), mat_body, col, bevel=0.002)
    if tilt:
        obj.rotation_euler[1] = tilt
    return obj


def basket(name: str, x: float, y: float, z_base: float, mat_body, col,
           width: float = 0.30, depth: float = 0.22, height: float = 0.20):
    """Shopping basket built from a base and four slatted walls.

    The walls stand *on* the base panel rather than overlapping it, which is
    how the real moulding works.
    """
    base_t = 0.012
    box(name + " | base", (x - width / 2, x + width / 2, y - depth / 2, y + depth / 2,
                           z_base, z_base + base_t), mat_body, col, bevel=0.004)
    t = 0.010
    for suffix, bx in (("L", (x - width / 2, x - width / 2 + t)),
                       ("R", (x + width / 2 - t, x + width / 2))):
        box(name + " | wall " + suffix, (bx[0], bx[1], y - depth / 2, y + depth / 2,
                                         z_base + base_t, z_base + height), mat_body, col, bevel=0.003)
    for suffix, by in (("F", (y - depth / 2, y - depth / 2 + t)),
                       ("B", (y + depth / 2 - t, y + depth / 2))):
        box(name + " | wall " + suffix, (x - width / 2 + t, x + width / 2 - t, by[0], by[1],
                                         z_base + base_t, z_base + height), mat_body, col, bevel=0.003)
    box(name + " | handle", (x - width * 0.22, x + width * 0.22, y - 0.006, y + 0.006,
                             z_base + height, z_base + height + 0.075), mat_body, col, bevel=0.004)
    return None
