"""Reusable profiles and shapes for the atom library.

Everything here is a *shape*, not an object: no materials, no placement. The
atom programs compose these into parts and dress them at the end.

Millimetres, Z up. Every shape is built at its own origin.
"""
from __future__ import annotations

import sand3d as s3d

# --------------------------------------------------------------------- profiles

def plank(w: float, d: float, t: float, r: float = 2.0):
    """A board: a rounded rectangle extruded to thickness ``t``, lying flat."""
    return s3d.extrude("plank", s3d.rect(w, d, r=r), t)


def post(w: float, d: float, h: float, r: float = 1.5):
    """A square post standing on z = 0."""
    return s3d.extrude("post", s3d.rect(w, d, r=r), h)


def slab(w: float, d: float, t: float):
    """A plain slab with no rounding: concrete, plaster, board."""
    return s3d.extrude("slab", s3d.rect(w, d), t)


def tube_round(d: float, h: float):
    return s3d.cylinder("tube", d=d, h=h)


def panel(w: float, h: float, t: float, r: float = 1.0):
    """A vertical panel: wide in X, tall in Z, thin in Y, standing on z = 0.

    ``extrude`` gives a profile in XY with its thickness along Z, so the panel
    is tipped forward with a quarter turn about X: the profile's Y becomes the
    panel's height and the thickness ends up along Y.
    """
    p = s3d.extrude("panel", s3d.rect(w, h, r=r), t)
    return s3d.at(p, rx=90, y=-t / 2)


def taper_post(h: float, bottom: float, top: float, r: float = 1.5):
    """A post that narrows towards its top (table legs, chair legs)."""
    p = s3d.extrude("taper_post", s3d.rect(bottom, bottom, r=r), h, taper=top / bottom)
    return p


def rounded_slab(w: float, d: float, t: float, r: float = 3.0):
    """A slab with generously rounded corners: a table top, a seat pad."""
    return s3d.extrude("rounded_slab", s3d.rect(w, d, r=r), t)


def tapered_box(w: float, d: float, h: float, top_w: float, top_d: float):
    """A box that narrows on top, built as a loft of two rectangles."""
    return s3d.loft(
        "tapered_box",
        s3d.at(s3d.rect(w, d, r=1.5), z=0),
        s3d.at(s3d.rect(top_w, top_d, r=1.5), z=h),
    )


def book_block(w: float, d: float, h: float):
    """The text block of a book: the paper mass, slightly inset."""
    return s3d.extrude("book_block", s3d.rect(w, d, r=0.6), h)


def cover(w: float, d: float, h: float, t: float = 1.2):
    """A book cover: a shallow tray that wraps the block on three sides."""
    shell = s3d.shell(s3d.box("cover", w, d, h), t, open="+Z")
    return s3d.at(shell, z=h / 2)


def spine_curve(w: float, h: float, bulge: float = 2.0):
    """The rounded spine of a book, as a half cylinder along Y."""
    return s3d.revolve(
        "spine",
        s3d.poly([(0, -h / 2), (bulge, -h / 2), (bulge, h / 2), (0, h / 2)]),
    )


def canister(d: float, h: float, rim: float = 0.8):
    """A tin can: a cylinder with a rolled rim at the top."""
    body = s3d.cylinder("can_body", d=d, h=h - rim)
    rim_ring = s3d.cylinder("can_rim", d=d + rim, h=rim)
    return s3d.join(body, s3d.at(rim_ring, z=h - rim))


def bottle(d: float, h: float, neck: float = 0.45, shoulder: float = 0.72):
    """A bottle: body, shoulder, neck, cap."""
    body_h = h * 0.62
    shoulder_h = h * 0.20
    neck_h = h * (1 - 0.62 - 0.20)
    body = s3d.cylinder("bottle_body", d=d, h=body_h)
    sh = s3d.cylinder("bottle_shoulder", d=d, h=shoulder_h, taper=neck)
    nk = s3d.cylinder("bottle_neck", d=d * neck, h=neck_h)
    cap = s3d.cylinder("bottle_cap", d=d * neck * 1.12, h=neck_h * 0.35)
    return s3d.join(
        body,
        s3d.at(sh, z=body_h),
        s3d.at(nk, z=body_h + shoulder_h),
        s3d.at(cap, z=body_h + shoulder_h + neck_h * 0.65),
    )


def sheet(w: float, d: float, t: float, r: float = 4.0):
    """A soft sheet: a slab with rounded corners and a gentle sag."""
    s = s3d.extrude("sheet", s3d.rect(w, d, r=r), t)
    return s


def cushion(w: float, d: float, h: float, crown: float = 0.22):
    """A stuffed cushion: domed on top, flat underneath."""
    sections = [
        s3d.at(s3d.superellipse(w, d, 3), z=0),
        s3d.at(s3d.superellipse(w * (1 - crown * 0.3), d * (1 - crown * 0.3), 3), z=h * 0.45),
        s3d.at(s3d.superellipse(w * (1 - crown), d * (1 - crown), 3), z=h),
    ]
    return s3d.loft("cushion", *sections)


def knob(d: float = 22, h: float = 16):
    """A drawer knob."""
    return s3d.revolve("knob", s3d.poly([(0, 0), (d * 0.42, 0), (d / 2, h * 0.5), (d * 0.30, h), (0, h)]))


def handle_bar(length: float, d: float = 12, stand: float = 22):
    """A straight bar handle on two stand-offs, lying along X.

    ``join`` fuses solids and keeps the first one's placement, so the bar is
    built from ``box`` (already centred on X, so no rotation needed) and
    joined after the posts.
    """
    post = s3d.cylinder("handle_post", d=d * 0.7, h=stand)
    posts = s3d.at(post, on=s3d.grid(2, 1, length - d))
    bar = s3d.box("handle_bar", length, d, d)
    s3d.at(bar, z=stand)
    return s3d.join(posts[0], posts[1], bar)


def frame_rect(w: float, h: float, bar: float, d: float = 24):
    """A rectangular frame standing in the XZ plane: four bars round an opening."""
    top = s3d.at(s3d.box("bar_top", w, d, bar), z=h - bar)
    bottom = s3d.at(s3d.box("bar_bottom", w, d, bar))
    left = s3d.at(s3d.box("bar_left", bar, d, h - 2 * bar), x=-(w - bar) / 2, z=bar)
    right = s3d.transform(s3d.copy(left), mirror="x")
    return s3d.join(top, bottom, left, right)


def slats(count: int, pitch: float, w: float, d: float, t: float):
    """A row of slats: the seat of a chair, the bed base, a vent grille."""
    one = s3d.extrude("slat", s3d.rect(w, d, r=1.0), t)
    return s3d.at(one, on=s3d.grid(count, 1, pitch), z=0)


def rail_between(a, b, d: float):
    """A round rail between two points in 3D."""
    return s3d.wire("rail", path=[a, b], d=d)
