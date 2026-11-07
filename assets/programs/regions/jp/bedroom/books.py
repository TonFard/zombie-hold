"""Books and stationery, as separate atoms.

A book is three assets, not one: the cover (a shallow tray wrapping three
sides), the block of pages, and the spine. The pages can be torn out or
scattered on their own; the cover stays as the husk. That is the point of
building atoms instead of props.

    book_hardcover_cover      the case, open at the fore-edge
    book_hardcover_pages      the text block, slightly smaller than the case
    book_hardcover_spine      the rounded spine, along the hinge
    book_paperback_cover      a thin flexible cover
    book_paperback_pages
    book_magazine_cover
    book_magazine_pages
    book_manga_cover
    book_manga_pages
    notebook_cover
    notebook_pages
    pen_ballpoint_body
    pen_ballpoint_cap
    pen_ballpoint_tip
    pencil_body
    pencil_wood
    pencil_eraser
    marker_highlight_body
    marker_highlight_cap
    envelope
    stapler_body
    stapler_arm
    paper_shredder_bin
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))

import sand3d as s3d  # noqa: E402

from common import MODEL_OUT, dress, meta, run  # noqa: E402
from parts import book_block, cover, plank  # noqa: E402

# ---------------------------------------------------------------- dimensions
HARD_W, HARD_D, HARD_H = 148, 210, 32
HARD_COVER_T = 1.8
PAPER_W, PAPER_D, PAPER_H = 110, 175, 22
PAPER_COVER_T = 0.6
MAG_W, MAG_D, MAG_H = 185, 240, 8
MANGA_W, MANGA_D, MANGA_H = 142, 200, 18
NOTE_W, NOTE_D, NOTE_H = 100, 145, 12
PEN_L, PEN_D = 140, 9


def _pages(w, d, h, t=2.0):
    """The text block, its outer face a touch inside the cover."""
    block = book_block(w - 2 * t, d - 2 * t, h - 2 * t)
    return s3d.at(block, z=t, x=t, y=-t)


def book_hardcover_cover():
    """The hard case: a tray that wraps the back, the fore-edge and the spine."""
    case = cover(HARD_W, HARD_D, HARD_H, t=HARD_COVER_T)
    dress(case, "leather", color="#4a2f26")
    return case


def book_hardcover_pages():
    pages = _pages(HARD_W, HARD_D, HARD_H)
    dress(pages, "paper", color="#d8d2c2")
    return pages


def book_hardcover_spine():
    """The rounded spine, running along the hinge edge of the book.

    The book is 148 wide (X), 210 deep (Y), 32 tall (Z) in sand3d space, so
    the spine runs along Y. A strip is extruded along Z; ``rx=90`` turns it
    onto Y, and it is then moved to the hinge edge and centred.
    """
    spine = s3d.extrude("spine", s3d.rect(HARD_COVER_T * 2.4, HARD_H, r=1.6), HARD_D)
    s3d.at(spine, rx=90, x=-(HARD_W / 2 + HARD_COVER_T), y=-HARD_D / 2, z=-HARD_H / 2)
    dress(spine, "leather", color="#4a2f26")
    return spine


def book_paperback_cover():
    c = cover(PAPER_W, PAPER_D, PAPER_H, t=PAPER_COVER_T)
    dress(c, "paper", color="#b8a888")
    return c


def book_paperback_pages():
    p = _pages(PAPER_W, PAPER_D, PAPER_H, t=1.0)
    dress(p, "paper", color="#e0dcc8")
    return p


def book_magazine_cover():
    c = cover(MAG_W, MAG_D, MAG_H, t=0.8)
    dress(c, "paper", color="#c8b090")
    return c


def book_magazine_pages():
    p = _pages(MAG_W, MAG_D, MAG_H, t=1.0)
    dress(p, "paper", color="#e8e4d8")
    return p


def book_manga_cover():
    c = cover(MANGA_W, MANGA_D, MANGA_H, t=0.9)
    dress(c, "paper", color="#d0c8b8")
    return c


def book_manga_pages():
    p = _pages(MANGA_W, MANGA_D, MANGA_H, t=1.0)
    dress(p, "paper", color="#e4e0d4")
    return p


def notebook_cover():
    c = cover(NOTE_W, NOTE_D, NOTE_H, t=1.4)
    dress(c, "plastic", color="#384858")
    return c


def notebook_pages():
    p = _pages(NOTE_W, NOTE_D, NOTE_H, t=1.2)
    dress(p, "paper", color="#e8e8e4")
    return p


def pen_ballpoint_body():
    body = s3d.cylinder("pen_body", d=PEN_D, h=PEN_L * 0.62)
    dress(body, "glossy_plastic", color="#1c1e24")
    return body


def pen_ballpoint_cap():
    cap = s3d.cylinder("pen_cap", d=PEN_D * 1.05, h=PEN_L * 0.22)
    dress(cap, "glossy_plastic", color="#2a2e38")
    return cap


def pen_ballpoint_tip():
    tip = s3d.cone("pen_tip", d=PEN_D * 0.9, h=14, d2=PEN_D * 0.25)
    dress(tip, "brass", color="#b08d4a")
    return tip


def pencil_body():
    """The painted hexagonal barrel."""
    body = s3d.extrude("pencil_body", s3d.polygon(6, PEN_D * 0.85), PEN_L * 0.72)
    dress(body, "painted_metal", color="#c8a028")
    return body


def pencil_wood():
    """The sharpened cone of exposed wood."""
    wood = s3d.cone("pencil_wood", d=PEN_D * 0.85, h=16, d2=2.4)
    dress(wood, "pine", color="#d8b878")
    return wood


def pencil_eraser():
    eraser = s3d.cylinder("eraser", d=PEN_D * 0.8, h=8)
    dress(eraser, "rubber", color="#e0d0c8")
    return eraser


def marker_highlight_body():
    body = s3d.cylinder("marker_body", d=PEN_D * 1.25, h=PEN_L * 0.55)
    dress(body, "glossy_plastic", color="#d8d048")
    return body


def marker_highlight_cap():
    cap = s3d.cylinder("marker_cap", d=PEN_D * 1.35, h=PEN_L * 0.3)
    dress(cap, "plastic", color="#2a2a2a")
    return cap


def envelope():
    """A flat envelope, slightly proud of its paper."""
    e = plank(230, 162, 1.2, r=2)
    dress(e, "paper", color="#ddd6c4")
    return e


def stapler_body():
    body = plank(150, 38, 22, r=6)
    dress(body, "painted_metal", color="#30343a")
    return body


def stapler_arm():
    arm = plank(140, 26, 14, r=5)
    dress(arm, "painted_metal", color="#4a5058")
    return arm


def paper_shredder_bin():
    bin_ = s3d.cylinder("bin", d=300, h=380)
    dress(bin_, "plastic", color="#4c5058")
    return bin_


ATOMS = [
    ("jp_bedroom_book_hardcover_cover", book_hardcover_cover,
     meta("jp_bedroom_book_hardcover_cover", "jp", "bedroom", "rm_jp_06", "book", "cover",
          size_m=(HARD_W / 1000, HARD_D / 1000, HARD_H / 1000), materials=("leather",),
          tags=("interior", "prop", "small"))),
    ("jp_bedroom_book_hardcover_pages", book_hardcover_pages,
     meta("jp_bedroom_book_hardcover_pages", "jp", "bedroom", "rm_jp_06", "book", "pages",
          size_m=(HARD_W / 1000, HARD_D / 1000, HARD_H / 1000), materials=("paper",),
          tags=("interior", "prop", "small", "removable"))),
    ("jp_bedroom_book_hardcover_spine", book_hardcover_spine,
     meta("jp_bedroom_book_hardcover_spine", "jp", "bedroom", "rm_jp_06", "book", "spine",
          size_m=(0.01, HARD_D / 1000, 0.032), materials=("leather",),
          tags=("interior", "prop", "small"))),
    ("jp_bedroom_book_paperback_cover", book_paperback_cover,
     meta("jp_bedroom_book_paperback_cover", "jp", "bedroom", "rm_jp_06", "book", "cover",
          size_m=(PAPER_W / 1000, PAPER_D / 1000, PAPER_H / 1000), materials=("paper",),
          tags=("interior", "prop", "small"))),
    ("jp_bedroom_book_paperback_pages", book_paperback_pages,
     meta("jp_bedroom_book_paperback_pages", "jp", "bedroom", "rm_jp_06", "book", "pages",
          size_m=(PAPER_W / 1000, PAPER_D / 1000, PAPER_H / 1000), materials=("paper",),
          tags=("interior", "prop", "small", "removable"))),
    ("jp_bedroom_book_magazine_cover", book_magazine_cover,
     meta("jp_bedroom_book_magazine_cover", "jp", "bedroom", "rm_jp_06", "book", "cover",
          size_m=(MAG_W / 1000, MAG_D / 1000, MAG_H / 1000), materials=("paper",),
          tags=("interior", "prop", "small"))),
    ("jp_bedroom_book_magazine_pages", book_magazine_pages,
     meta("jp_bedroom_book_magazine_pages", "jp", "bedroom", "rm_jp_06", "book", "pages",
          size_m=(MAG_W / 1000, MAG_D / 1000, MAG_H / 1000), materials=("paper",),
          tags=("interior", "prop", "small", "removable"))),
    ("jp_bedroom_book_manga_cover", book_manga_cover,
     meta("jp_bedroom_book_manga_cover", "jp", "bedroom", "rm_jp_06", "book", "cover",
          size_m=(MANGA_W / 1000, MANGA_D / 1000, MANGA_H / 1000), materials=("paper",),
          tags=("interior", "prop", "small"))),
    ("jp_bedroom_book_manga_pages", book_manga_pages,
     meta("jp_bedroom_book_manga_pages", "jp", "bedroom", "rm_jp_06", "book", "pages",
          size_m=(MANGA_W / 1000, MANGA_D / 1000, MANGA_H / 1000), materials=("paper",),
          tags=("interior", "prop", "small", "removable"))),
    ("jp_bedroom_notebook_cover", notebook_cover,
     meta("jp_bedroom_notebook_cover", "jp", "bedroom", "rm_jp_06", "notebook", "cover",
          size_m=(NOTE_W / 1000, NOTE_D / 1000, NOTE_H / 1000), materials=("plastic",),
          tags=("interior", "prop", "small"))),
    ("jp_bedroom_notebook_pages", notebook_pages,
     meta("jp_bedroom_notebook_pages", "jp", "bedroom", "rm_jp_06", "notebook", "pages",
          size_m=(NOTE_W / 1000, NOTE_D / 1000, NOTE_H / 1000), materials=("paper",),
          tags=("interior", "prop", "small", "removable"))),
    ("jp_bedroom_pen_ballpoint_body", pen_ballpoint_body,
     meta("jp_bedroom_pen_ballpoint_body", "jp", "bedroom", "rm_jp_06", "pen", "body",
          size_m=(0.009, 0.009, PEN_L * 0.62 / 1000), materials=("glossy_plastic",),
          tags=("interior", "prop", "small"))),
    ("jp_bedroom_pen_ballpoint_cap", pen_ballpoint_cap,
     meta("jp_bedroom_pen_ballpoint_cap", "jp", "bedroom", "rm_jp_06", "pen", "cap",
          size_m=(0.0095, 0.0095, PEN_L * 0.22 / 1000), materials=("glossy_plastic",),
          tags=("interior", "prop", "small"))),
    ("jp_bedroom_pen_ballpoint_tip", pen_ballpoint_tip,
     meta("jp_bedroom_pen_ballpoint_tip", "jp", "bedroom", "rm_jp_06", "pen", "tip",
          size_m=(0.008, 0.008, 0.014), materials=("brass",),
          tags=("interior", "prop", "small"))),
    ("jp_bedroom_pencil_body", pencil_body,
     meta("jp_bedroom_pencil_body", "jp", "bedroom", "rm_jp_06", "pencil", "body",
          size_m=(0.0077, 0.0077, PEN_L * 0.72 / 1000), materials=("painted_metal",),
          tags=("interior", "prop", "small"))),
    ("jp_bedroom_pencil_wood", pencil_wood,
     meta("jp_bedroom_pencil_wood", "jp", "bedroom", "rm_jp_06", "pencil", "wood",
          size_m=(0.0077, 0.0077, 0.016), materials=("pine",),
          tags=("interior", "prop", "small"))),
    ("jp_bedroom_pencil_eraser", pencil_eraser,
     meta("jp_bedroom_pencil_eraser", "jp", "bedroom", "rm_jp_06", "pencil", "eraser",
          size_m=(0.0068, 0.0068, 0.008), materials=("rubber",),
          tags=("interior", "prop", "small"))),
    ("jp_bedroom_marker_highlight_body", marker_highlight_body,
     meta("jp_bedroom_marker_highlight_body", "jp", "bedroom", "rm_jp_06", "marker", "body",
          size_m=(0.011, 0.011, PEN_L * 0.55 / 1000), materials=("glossy_plastic",),
          tags=("interior", "prop", "small"))),
    ("jp_bedroom_marker_highlight_cap", marker_highlight_cap,
     meta("jp_bedroom_marker_highlight_cap", "jp", "bedroom", "rm_jp_06", "marker", "cap",
          size_m=(0.012, 0.012, PEN_L * 0.3 / 1000), materials=("plastic",),
          tags=("interior", "prop", "small"))),
    ("jp_bedroom_envelope", envelope,
     meta("jp_bedroom_envelope", "jp", "bedroom", "rm_jp_06", "envelope", None,
          size_m=(0.23, 0.162, 0.0012), materials=("paper",),
          tags=("interior", "prop", "small", "flat"))),
    ("jp_bedroom_stapler_body", stapler_body,
     meta("jp_bedroom_stapler_body", "jp", "bedroom", "rm_jp_06", "stapler", "body",
          size_m=(0.15, 0.038, 0.022), materials=("painted_metal",),
          tags=("interior", "prop", "small"))),
    ("jp_bedroom_stapler_arm", stapler_arm,
     meta("jp_bedroom_stapler_arm", "jp", "bedroom", "rm_jp_06", "stapler", "arm",
          size_m=(0.14, 0.026, 0.014), materials=("painted_metal",),
          tags=("interior", "prop", "small", "movable"))),
    ("jp_bedroom_paper_shredder_bin", paper_shredder_bin,
     meta("jp_bedroom_paper_shredder_bin", "jp", "bedroom", "rm_jp_06", "shredder", "bin",
          size_m=(0.3, 0.3, 0.38), materials=("plastic",),
          tags=("interior", "loot_container"))),
]


def build_all(out_dir=None):
    out_dir = out_dir or os.path.join(MODEL_OUT, "jp", "bedroom")
    return [run(builder, atom_id, info, out_dir) for atom_id, builder, info in ATOMS]


if __name__ == "__main__":
    for p in build_all():
        print("wrote", p)
