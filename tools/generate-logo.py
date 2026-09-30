#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Générateur du logo officiel UGTM pour l'application Souss-Massa.

Produit dans www/icons/ :
  - ugtm-logo.svg         logo vectoriel complet (fond transparent)
  - ugtm-mark.svg         version simplifiée pour l'en-tête de l'app
  - icon-512.png          icône PWA 512
  - icon-192.png          icône PWA 192
  - icon-maskable-512.png variante « maskable » (zone sûre)
  - favicon-32.png        favicon 32
  - apple-touch-icon.png  180 (fond blanc, iOS)

Usage : python3 tools/generate-logo.py
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "www", "icons")
os.makedirs(ICONS, exist_ok=True)

# ------------------------------------------------------------------
# Palette officielle
# ------------------------------------------------------------------
GOLD = (176, 138, 53, 255)
GOLD_DARK = (140, 106, 34, 255)
GOLD_LIGHT = (205, 168, 84, 255)
FLAME = (242, 128, 24, 255)
FLAME_IN = (255, 179, 71, 255)
GREEN = (74, 124, 47, 255)
GREEN_LEAF = (62, 107, 36, 255)
RED_DARK = (139, 26, 26, 255)
INK = (31, 58, 31, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)

# ------------------------------------------------------------------
# Géométrie (canvas 512×512, surn-échantillonnage ×2)
# ------------------------------------------------------------------
SS = 2
SIZE = 512 * SS
CX = 256 * SS
GY = 292 * SS          # centre de l'engrenage / du disque
R_BASE = 185 * SS      # rayon externe de la couronne
R_IN = 165 * SS        # rayon interne de la couronne
R_TOOTH = 208 * SS     # pointe des dents
R_DISC = 148 * SS      # disque blanc
R_LEAF = 124 * SS      # arc des rameaux
STAR_CX, STAR_CY = 256 * SS, 290 * SS
STAR_R = 92 * SS
STAR_r = 40 * SS

FONTS = {
    "ar": "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "latin": "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
}


def polar(cx, cy, r, deg):
    a = math.radians(deg)
    return (cx + r * math.cos(a), cy + r * math.sin(a))


def gear_path(cx, cy, r_base, r_tooth, teeth=10, half=11.0):
    """Polygone de l'engrenage (dents trapézoïdales)."""
    pts = []
    step = 360.0 / teeth
    for i in range(teeth):
        a0 = i * step
        pts.append(polar(cx, cy, r_base, a0 - half - 6))
        pts.append(polar(cx, cy, r_tooth, a0 - half))
        pts.append(polar(cx, cy, r_tooth, a0 + half))
        pts.append(polar(cx, cy, r_base, a0 + half + 6))
    return pts


def star_points(cx, cy, r_out, r_in, points=5, rot=-90):
    pts = []
    for i in range(points * 2):
        r = r_out if i % 2 == 0 else r_in
        pts.append(polar(cx, cy, r, rot + i * 180.0 / points))
    return pts


def leaf(img, cx, cy, r, deg, length, width, color):
    """Feuille d'olivier : losange effilé orienté tangentiellement."""
    px, py = polar(cx, cy, r, deg)
    t = deg + 90  # direction tangentielle
    tx, ty = math.cos(math.radians(t)), math.sin(math.radians(t))
    nx, ny = -ty, tx
    hl, hw = length / 2.0, width / 2.0
    pts = [
        (px + tx * hl, py + ty * hl),
        (px + nx * hw, py + ny * hw),
        (px - tx * hl, py - ty * hl),
        (px - nx * hw, py + ny * hw),
    ]
    img.polygon(pts, fill=color)


def draw_flame(img, cx, top, w, h, color):
    """Flamme goutte d'eau inversée."""
    pts = []
    n = 24
    for i in range(n + 1):
        t = i / n                       # 0 = pointe, 1 = base
        y = top + h * t
        half = (w / 2) * math.sin(math.pi * min(1, t * 1.15)) ** 0.8
        pts.append((cx - half, y))
    for i in range(n, -1, -1):
        t = i / n
        y = top + h * t
        half = (w / 2) * math.sin(math.pi * min(1, t * 1.15)) ** 0.8
        pts.append((cx + half, y))
    img.polygon(pts, fill=color)


def draw_logo(draw):
    # ---- Engrenage doré -------------------------------------------------
    draw.polygon(gear_path(CX, GY, R_BASE, R_TOOTH), fill=GOLD)
    # couronne creuse : on perce le centre avec un anneau transparent
    hole = Image.new("RGBA", (SIZE, SIZE), CLEAR)
    hd = ImageDraw.Draw(hole)
    hd.ellipse(
        [CX - R_IN, GY - R_IN, CX + R_IN, GY + R_IN], fill=(0, 0, 0, 255)
    )
    base = Image.new("RGBA", (SIZE, SIZE), CLEAR)
    bd = ImageDraw.Draw(base)
    bd.polygon(gear_path(CX, GY, R_BASE, R_TOOTH), fill=GOLD)
    base.putalpha(
        Image.composite(
            Image.new("L", (SIZE, SIZE), 0),
            base.split()[3],
            hole.split()[3],
        )
    )
    # (rebuilt below to keep alpha math simple)
    ring = Image.new("L", (SIZE, SIZE), 0)
    rd = ImageDraw.Draw(ring)
    rd.polygon(gear_path(CX, GY, R_BASE, R_TOOTH), fill=255)
    rd.ellipse(
        [CX - R_IN, GY - R_IN, CX + R_IN, GY + R_IN], fill=0
    )
    gold_layer = Image.new("RGBA", (SIZE, SIZE), GOLD)
    gold_layer.putalpha(ring)
    draw._image.alpha_composite(gold_layer)

    # contour interne discret
    draw.arc(
        [CX - R_IN, GY - R_IN, CX + R_IN, GY + R_IN],
        0, 360, fill=GOLD_DARK, width=2 * SS,
    )

    # ---- Disque blanc ---------------------------------------------------
    draw.ellipse(
        [CX - R_DISC, GY - R_DISC, CX + R_DISC, GY + R_DISC],
        fill=WHITE, outline=GOLD_DARK, width=3 * SS,
    )

    # ---- Rameaux d'olivier ----------------------------------------------
    for side in (-1, 1):
        for k in range(9):
            deg = 90 + side * (26 + k * 27)
            leaf(
                draw, CX, GY, R_LEAF, deg,
                length=34 * SS, width=15 * SS, color=GREEN_LEAF,
            )
        # tige
        draw.arc(
            [CX - R_LEAF, GY - R_LEAF, CX + R_LEAF, GY + R_LEAF],
            start=90 if side < 0 else 270 - 154,
            end=(90 + 154) if side < 0 else 270,
            fill=GREEN_LEAF, width=3 * SS,
        )

    # ---- Étoile entrelacée verte ----------------------------------------
    pts = star_points(STAR_CX, STAR_CY, STAR_R, STAR_r)
    closed = pts + [pts[0]]
    draw.line(closed, fill=GREEN, width=13 * SS, joint="curve")
    inner = star_points(STAR_CX, STAR_CY, STAR_r * 1.35, STAR_r * 0.55)
    draw.line(inner + [inner[0]], fill=GREEN, width=4 * SS, joint="curve")

    # ---- Lettres arabes (formes isolées, comme sur le logo) --------------
    try:
        far = ImageFont.truetype(FONTS["ar"], 46 * SS)
    except OSError:
        far = None
    if far is not None:
        for ch, (x, y) in {
            "ع": (196, 262),
            "أ": (288, 240),
            "م": (204, 336),
            "ت": (292, 342),
        }.items():
            if far.getmask(ch).getbbox():
                draw.text((x * SS, y * SS), ch, font=far, fill=RED_DARK)

    # ---- UGTM -------------------------------------------------------------
    try:
        lat = ImageFont.truetype(FONTS["latin"], 42 * SS)
    except OSError:
        lat = None
    if lat is not None:
        txt = "UGTM"
        box = draw.textbbox((0, 0), txt, font=lat)
        tw = box[2] - box[0]
        draw.text(
            (CX - tw / 2 - box[0], 352 * SS),
            txt, font=lat, fill=INK,
        )

    # ---- Poignée de main dorée -------------------------------------------
    draw.polygon(
        [
            (CX - 22 * SS, 128 * SS), (CX + 22 * SS, 128 * SS),
            (CX + 30 * SS, 150 * SS), (CX, 162 * SS),
            (CX - 30 * SS, 150 * SS),
        ],
        fill=GOLD_LIGHT, outline=GOLD_DARK,
    )
    draw.ellipse(
        [CX - 13 * SS, 112 * SS, CX + 13 * SS, 140 * SS],
        fill=GOLD_LIGHT, outline=GOLD_DARK, width=2 * SS,
    )

    # ---- Flamme ------------------------------------------------------------
    draw_flame(draw, CX, 30 * SS, 46 * SS, 66 * SS, FLAME)
    draw_flame(draw, CX, 52 * SS, 22 * SS, 36 * SS, FLAME_IN)


def render_master():
    img = Image.new("RGBA", (SIZE, SIZE), CLEAR)
    d = ImageDraw.Draw(img)
    draw_logo(d)
    return img.resize((512, 512), Image.LANCZOS)


# ------------------------------------------------------------------
# SVG vectoriel (même géométrie que le PNG)
# ------------------------------------------------------------------
def svg_logo():
    def pt(p):
        return f"{p[0]:.1f},{p[1]:.1f}"

    gear = " ".join(
        pt(polar(256, 292, R_BASE / SS, a)) for a in []
    )
    # dents
    teeth = []
    step = 36.0
    for i in range(10):
        a0 = i * step
        seq = [
            polar(256, 292, R_BASE / SS, a0 - 17),
            polar(256, 292, R_TOOTH / SS, a0 - 11),
            polar(256, 292, R_TOOTH / SS, a0 + 11),
            polar(256, 292, R_BASE / SS, a0 + 17),
        ]
        teeth.append("M" + " L".join(pt(p) for p in seq) + " Z")
    star = " ".join(
        pt(p) for p in star_points(256, 290, STAR_R / SS, STAR_r / SS)
    )
    leaves = []
    for side in (-1, 1):
        for k in range(9):
            deg = 90 + side * (26 + k * 27)
            px, py = polar(256, 292, R_LEAF / SS, deg)
            leaves.append(
                f'<ellipse cx="{px:.1f}" cy="{py:.1f}" rx="17" ry="7.5" '
                f'fill="#3E6B24" transform="rotate({deg + 90:.1f} '
                f'{px:.1f} {py:.1f})"/>'
            )
    arabic = [
        ("ع", 196, 262),
        ("أ", 288, 240),
        ("م", 204, 336),
        ("ت", 292, 342),
    ]
    letters = "".join(
        f'<text x="{x}" y="{y}" font-family="\'DejaVu Sans\','
        f"'Noto Sans Arabic',sans-serif\" font-size=\"46\" "
        f'font-weight="bold" fill="#8B1A1A" text-anchor="middle">{c}</text>'
        for c, x, y in arabic
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="t d">
<title id="t">UGTM</title>
<desc id="d">Logo officiel de l'UGTM : engrenage doré, flamme, étoile verte entrelacée et rameaux d'olivier</desc>
{''.join(f'<path d="{p}" fill="#B08A35"/>' for p in teeth)}
<circle cx="256" cy="292" r="175" fill="none" stroke="#B08A35" stroke-width="20"/>
<circle cx="256" cy="292" r="165" fill="none" stroke="#8C6A22" stroke-width="2"/>
<circle cx="256" cy="292" r="148" fill="#FFFFFF" stroke="#8C6A22" stroke-width="3"/>
<path d="M 136 350 A 124 124 0 0 1 150 216" fill="none" stroke="#3E6B24" stroke-width="3"/>
<path d="M 376 350 A 124 124 0 0 0 362 216" fill="none" stroke="#3E6B24" stroke-width="3"/>
{''.join(leaves)}
<polygon points="{star}" fill="none" stroke="#4A7C2F" stroke-width="13" stroke-linejoin="round"/>
{letters}
<text x="256" y="384" font-family="'DejaVu Serif',Georgia,serif" font-size="42" font-weight="bold" fill="#1F3A1F" text-anchor="middle" letter-spacing="4">UGTM</text>
<path d="M234 128 L278 128 L286 150 L256 162 L226 150 Z" fill="#CDA854" stroke="#8C6A22" stroke-width="2"/>
<circle cx="256" cy="126" r="14" fill="#CDA854" stroke="#8C6A22" stroke-width="2"/>
<path d="M256 30 C 270 48 279 62 279 78 C 279 94 269 104 256 108 C 243 104 233 94 233 78 C 233 62 242 48 256 30 Z" fill="#F28018"/>
<path d="M256 52 C 263 62 267 70 267 80 C 267 90 262 96 256 98 C 250 96 245 90 245 80 C 245 70 249 62 256 52 Z" fill="#FFB347"/>
</svg>
"""


# ------------------------------------------------------------------
# Marque réduite pour l'en-tête (64×64)
# ------------------------------------------------------------------
def svg_mark():
    teeth = []
    step = 45.0
    for i in range(8):
        a0 = i * step
        seq = [
            polar(32, 36, 24, a0 - 10),
            polar(32, 36, 29, a0 - 6),
            polar(32, 36, 29, a0 + 6),
            polar(32, 36, 24, a0 + 10),
        ]
        teeth.append(
            "M" + " L".join(f"{p[0]:.1f},{p[1]:.1f}" for p in seq) + " Z"
        )
    star = " ".join(
        f"{p[0]:.1f},{p[1]:.1f}"
        for p in star_points(32, 36, 14, 6)
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="t">
<title id="t">UGTM</title>
{''.join(f'<path d="{p}" fill="#B08A35"/>' for p in teeth)}
<circle cx="32" cy="36" r="24" fill="none" stroke="#B08A35" stroke-width="6"/>
<circle cx="32" cy="36" r="20" fill="#FFFFFF"/>
<polygon points="{star}" fill="none" stroke="#4A7C2F" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M32 4 C 36 9 38 13 38 17 C 38 21 35 24 32 25 C 29 24 26 21 26 17 C 26 13 28 9 32 4 Z" fill="#F28018"/>
</svg>
"""


def save_png(master, path, size, scale=1.0, background=None):
    if scale != 1.0:
        s = int(512 * scale)
        im = master.resize((s, s), Image.LANCZOS)
        canvas = Image.new("RGBA", (size, size), background or CLEAR)
        canvas.alpha_composite(im, ((size - s) // 2, (size - s) // 2))
        im = canvas
    else:
        im = master if size == 512 else master.resize((size, size), Image.LANCZOS)
        if background is not None:
            bg = Image.new("RGBA", im.size, background)
            bg.alpha_composite(im)
            im = bg
    if background is not None:
        im = im.convert("RGB")
    im.save(path)
    print("écrit", os.path.relpath(path, ROOT), im.size)


# ------------------------------------------------------------------
# Icônes lanceur Android (densités mdpi→xxxhdpi)
# ------------------------------------------------------------------
DENSITIES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}
# Contenu au centre, marges de sécurité adaptatif (cercle central ~66 %)
ANDROID_BG = (255, 255, 255, 255)
ANDROID_SCALE_SQUARE = 0.74   # fond / launcher (zone visible ~72 dp)
ANDROID_SCALE_FORE = 0.52     # foreground (safe zone circulaire)
ANDROID_DIR = os.path.join(ROOT, "android-icons")


def android_master(scale):
    s = int(432 * scale)
    im = master_logo.resize((s, s), Image.LANCZOS)
    canvas = Image.new("RGBA", (432, 432), ANDROID_BG)
    canvas.alpha_composite(im, ((432 - s) // 2, (432 - s) // 2))
    return canvas


def write_android_icons():
    os.makedirs(ANDROID_DIR, exist_ok=True)
    square = android_master(ANDROID_SCALE_SQUARE)
    fore = android_master(ANDROID_SCALE_FORE)

    for dens, px in DENSITIES.items():
        d = os.path.join(ANDROID_DIR, f"mipmap-{dens}")
        os.makedirs(d, exist_ok=True)
        for name, src in (
            ("ic_launcher.png", square),
            ("ic_launcher_round.png", square),
            ("ic_launcher_foreground.png", fore),

        ):
            src.resize((px, px), Image.LANCZOS).save(os.path.join(d, name))
        print(f"écrit android-icons/mipmap-{dens}/ (3 icônes {px}×{px})")

    with open(os.path.join(ANDROID_DIR, "ic_launcher_background.xml"), "w") as f:
        f.write(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<resources>\n'
            '  <color name="ic_launcher_background">#FFFFFF</color>\n'
            '</resources>\n'
        )
    print("écrit android-icons/ic_launcher_background.xml")


def main():
    global master_logo
    master_logo = render_master()
    master = master_logo

    save_png(master, os.path.join(ICONS, "icon-512.png"), 512)
    save_png(master, os.path.join(ICONS, "icon-192.png"), 192)
    save_png(master, os.path.join(ICONS, "icon-maskable-512.png"),
             512, scale=0.78, background=(255, 255, 255, 255))
    save_png(master, os.path.join(ICONS, "favicon-32.png"), 32)
    save_png(master, os.path.join(ICONS, "apple-touch-icon.png"),
             180, scale=0.92, background=(255, 255, 255, 255))

    with open(os.path.join(ICONS, "ugtm-logo.svg"), "w", encoding="utf-8") as f:
        f.write(svg_logo())
    print("écrit www/icons/ugtm-logo.svg")

    with open(os.path.join(ICONS, "ugtm-mark.svg"), "w", encoding="utf-8") as f:
        f.write(svg_mark())
    print("écrit www/icons/ugtm-mark.svg")

    write_android_icons()

    # Validation pixel : disque blanc, couronne dorée, flamme orange
    px = master.load()
    checks = {
        "disque blanc (256,292)": px[256, 292][:3] == (255, 255, 255),
        "couronne dorée (81,292)": px[81, 292][0] > 140 and px[81, 292][2] < 120,
        "flamme orange (256,70)": px[256, 70][0] > 200 and px[256, 70][1] < 190,
        "étoile verte (~256,198)": px[256, 198][1] > px[256, 198][0],
    }
    for name, ok in checks.items():
        print(("OK  " if ok else "ECHEC "), name)
    if not all(checks.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
