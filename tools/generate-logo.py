#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Générateur des icônes UGTM Souss-Massa, d'après le logo officiel fourni
(fond noir, engrenage doré, torche à flamme orange, poignée de main,
disque blanc, rameaux d'olivier, étoile verte entrelacée, lettres arabes,
UGTM).

Produit dans www/icons/ :
  - ugtm-logo.svg         logo vectoriel complet (fond noir)
  - ugtm-mark.svg         version réduite pour l'en-tête de l'app
  - icon-512.png          icône PWA 512 (fond noir)
  - icon-192.png          icône PWA 192 (fond noir)
  - icon-maskable-512.png variante « maskable » (logo réduit sur fond noir)
  - favicon-32.png        favicon 32
  - apple-touch-icon.png  180 (iOS, fond noir)

Et dans android-icons/ :
  - mipmap-{mdpi..xxxhdpi}/ic_launcher.png           fond noir, logo à 74 %
  - mipmap-{mdpi..xxxhdpi}/ic_launcher_round.png     idem (masque circulaire)
  - mipmap-{mdpi..xxxhdpi}/ic_launcher_foreground.png logo à 52 % sur fond
    TRANSPARENT (le fond noir est fourni par ic_launcher_background.xml)
  - ic_launcher_background.xml                       couleur #000000

Usage : python3 tools/generate-logo.py
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "www", "icons")
os.makedirs(ICONS, exist_ok=True)

# ------------------------------------------------------------------
# Palette du logo officiel (échantillonnée sur l'image fournie)
# ------------------------------------------------------------------
BLACK = (5, 5, 5, 255)
WHITE = (250, 250, 248, 255)
GOLD = (196, 158, 74, 255)
GOLD_LIGHT = (224, 190, 110, 255)
GOLD_DARK = (140, 106, 34, 255)
FLAME = (239, 108, 0, 255)
FLAME_MID = (247, 148, 29, 255)
FLAME_IN = (255, 196, 87, 255)
GREEN = (106, 133, 44, 255)
GREEN_DARK = (74, 100, 32, 255)
RED = (148, 34, 28, 255)
INK = (43, 41, 38, 255)
CLEAR = (0, 0, 0, 0)

# ------------------------------------------------------------------
# Géométrie (canvas maître 512, sur-échantillonnage ×2)
# ------------------------------------------------------------------
SS = 2
S = 512 * SS
CX = 256 * SS
CY = 276 * SS              # centre de l'engrenage
R_GEAR_IN = 172 * SS       # rayon interne de la couronne dentée
R_GEAR_OUT = 206 * SS      # pointe des dents
R_DISC = 150 * SS          # disque blanc
R_LEAF = 126 * SS          # rayon des rameaux
SX, SY = 256 * SS, 272 * SS
STAR_R = 96 * SS
STAR_r = 42 * SS

F_AR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
F_LAT = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"


def polar(cx, cy, r, deg):
    a = math.radians(deg)
    return (cx + r * math.cos(a), cy + r * math.sin(a))


def gear_pts(cx, cy, r_in, r_out, teeth=12, tooth_deg=15.0, base_deg=8.0):
    """Polygone de la couronne dentée (dents carrées, creux larges)."""
    step = 360.0 / teeth
    pts = []
    for i in range(teeth):
        a = i * step
        pts += [
            polar(cx, cy, r_in, a - base_deg),
            polar(cx, cy, r_out, a - tooth_deg),
            polar(cx, cy, r_out, a + tooth_deg),
            polar(cx, cy, r_in, a + base_deg),
        ]
    return pts


def star_pts(cx, cy, r_out, r_in, rot=-90):
    pts = []
    for i in range(10):
        r = r_out if i % 2 == 0 else r_in
        pts.append(polar(cx, cy, r, rot + i * 36))
    return pts


def flame_layer(d, cx, top, w, h, color, lean=0.0):
    """Une langue de flamme (goutte inversée, légèrement inclinée)."""
    n = 22
    left, right = [], []
    for i in range(n + 1):
        t = i / n
        y = top + h * t
        half = (w / 2) * math.sin(math.pi * min(1.0, t * 1.12)) ** 0.85
        dx = lean * h * t * t
        left.append((cx + dx - half, y))
        right.append((cx + dx + half, y))
    d.polygon(left + right[::-1], fill=color)


def leaf(d, cx, cy, r, deg, ln, wd, color):
    px, py = polar(cx, cy, r, deg)
    t = math.radians(deg + 90)
    tx, ty = math.cos(t), math.sin(t)
    nx, ny = -ty, tx
    d.polygon(
        [
            (px + tx * ln / 2, py + ty * ln / 2),
            (px + nx * wd / 2, py + ny * wd / 2),
            (px - tx * ln / 2, py - ty * ln / 2),
            (px - nx * wd / 2, py + ny * wd / 2),
        ],
        fill=color,
    )


def draw_torch(d):
    """Torche : manche doré sous la poignée de main."""
    d.polygon(
        [
            (CX - 12 * SS, 108 * SS), (CX + 12 * SS, 108 * SS),
            (CX + 16 * SS, 132 * SS), (CX - 16 * SS, 132 * SS),
        ],
        fill=GOLD,
    )
    d.polygon(
        [
            (CX - 20 * SS, 132 * SS), (CX + 20 * SS, 132 * SS),
            (CX + 14 * SS, 146 * SS), (CX - 14 * SS, 146 * SS),
        ],
        fill=GOLD_LIGHT,
    )


def draw_hands(d):
    """Poignée de main stylisée au-dessus de l'engrenage."""
    # bras gauche (venant de la gauche)
    d.polygon(
        [
            (CX - 58 * SS, 168 * SS), (CX - 6 * SS, 156 * SS),
            (CX - 2 * SS, 174 * SS), (CX - 54 * SS, 184 * SS),
        ],
        fill=GOLD,
    )
    # bras droit (venant de la droite)
    d.polygon(
        [
            (CX + 58 * SS, 168 * SS), (CX + 6 * SS, 156 * SS),
            (CX + 2 * SS, 174 * SS), (CX + 54 * SS, 184 * SS),
        ],
        fill=GOLD_LIGHT,
    )
    # mains serrées
    d.ellipse(
        [CX - 16 * SS, 154 * SS, CX + 16 * SS, 184 * SS],
        fill=GOLD_LIGHT, outline=GOLD_DARK, width=2 * SS,
    )
    # doigts
    for k in range(3):
        x = CX - 8 * SS + k * 8 * SS
        d.line(
            [(x, 158 * SS), (x, 180 * SS)],
            fill=GOLD_DARK, width=2 * SS,
        )


def draw_logo(d):
    # ---- Fond noir -------------------------------------------------------
    d.rectangle([0, 0, S, S], fill=BLACK)

    # ---- Flamme à trois langues ------------------------------------------
    flame_layer(d, CX, 22 * SS, 34 * SS, 74 * SS, FLAME, lean=0.42)
    flame_layer(d, CX - 16 * SS, 46 * SS, 26 * SS, 52 * SS, FLAME_MID, lean=-0.30)
    flame_layer(d, CX + 14 * SS, 44 * SS, 26 * SS, 54 * SS, FLAME_IN, lean=0.30)

    # ---- Torche -----------------------------------------------------------
    draw_torch(d)

    # ---- Poignée de main ---------------------------------------------------
    draw_hands(d)

    # ---- Couronne dentée (anneau creux) ------------------------------------
    ring = Image.new("L", (S, S), 0)
    rd = ImageDraw.Draw(ring)
    rd.polygon(gear_pts(CX, CY, R_GEAR_IN, R_GEAR_OUT), fill=255)
    rd.ellipse([CX - R_GEAR_IN, CY - R_GEAR_IN, CX + R_GEAR_IN, CY + R_GEAR_IN], fill=0)
    gold = Image.new("RGBA", (S, S), GOLD)
    gold.putalpha(ring)
    d._image.alpha_composite(gold)

    # ---- Disque blanc -------------------------------------------------------
    d.ellipse(
        [CX - R_DISC, CY - R_DISC, CX + R_DISC, CY + R_DISC],
        fill=WHITE, outline=GOLD_DARK, width=2 * SS,
    )

    # ---- Rameaux d'olivier ----------------------------------------------------
    for side in (-1, 1):
        for k in range(8):
            deg = 96 + side * (24 + k * 24)
            leaf(d, CX, CY, R_LEAF, deg, 30 * SS, 13 * SS, GREEN_DARK)
        d.arc(
            [CX - R_LEAF, CY - R_LEAF, CX + R_LEAF, CY + R_LEAF],
            start=(96 if side < 0 else 264),
            end=(264 if side < 0 else 456),
            fill=GREEN_DARK, width=3 * SS,
        )

    # ---- Étoile verte entrelacée -----------------------------------------------
    outer = star_pts(SX, SY, STAR_R, STAR_r)
    d.line(outer + [outer[0]], fill=GREEN, width=12 * SS, joint="curve")
    # entrelacs : second tracé légèrement tourné, sous l'étoile
    weave = star_pts(SX, SY, STAR_R * 0.96, STAR_r * 1.15, rot=-90 + 36)
    d.line(weave + [weave[0]], fill=GREEN_DARK, width=5 * SS, joint="curve")

    # ---- Lettres arabes aux quatre points -----------------------------------------
    try:
        far = ImageFont.truetype(F_AR, 40 * SS)
    except OSError:
        far = None
    if far:
        for ch, (x, y) in {
            "ع": (200, 250), "أ": (296, 236),
            "م": (208, 322), "ت": (300, 328),
        }.items():
            if far.getmask(ch).getbbox():
                d.text((x * SS, y * SS), ch, font=far, fill=RED)

    # ---- UGTM ------------------------------------------------------------------------
    try:
        lat = ImageFont.truetype(F_LAT, 34 * SS)
    except OSError:
        lat = None
    if lat:
        txt = "UGTM"
        box = d.textbbox((0, 0), txt, font=lat)
        d.text(
            (CX - (box[2] - box[0]) / 2 - box[0], 348 * SS),
            txt, font=lat, fill=INK,
        )


def render_master():
    img = Image.new("RGBA", (S, S), CLEAR)
    d = ImageDraw.Draw(img)
    draw_logo(d)
    return img.resize((512, 512), Image.LANCZOS)


# ------------------------------------------------------------------
# SVG vectoriel (fond noir, mêmes formes que le PNG)
# ------------------------------------------------------------------
def svg_logo():
    def path(pts, fill, extra=""):
        return (
            '<path d="M'
            + " L".join(f"{p[0]/SS:.1f},{p[1]/SS:.1f}" for p in pts)
            + ' Z" fill="' + fill + '"' + extra + "/>"
        )

    teeth = gear_pts(256, 276, R_GEAR_IN / SS, R_GEAR_OUT / SS)
    star = star_pts(256, 272, STAR_R / SS, STAR_r / SS)
    weave = star_pts(256, 272, STAR_R * 0.96 / SS, STAR_r * 1.15 / SS, rot=-54)

    leaves = []
    for side in (-1, 1):
        for k in range(8):
            deg = 96 + side * (24 + k * 24)
            px, py = polar(256, 276, R_LEAF / SS, deg)
            leaves.append(
                f'<ellipse cx="{px:.1f}" cy="{py:.1f}" rx="15" ry="6.5" '
                f'fill="#4A6420" transform="rotate({deg + 90:.1f} {px:.1f} {py:.1f})"/>'
            )

    arabic = [("ع", 200, 250), ("أ", 296, 236), ("م", 208, 322), ("ت", 300, 328)]
    letters = "".join(
        f'<text x="{x}" y="{y}" font-size="40" font-weight="bold" fill="#94221C" '
        f'text-anchor="middle" font-family="\'DejaVu Sans\',\'Noto Sans Arabic\',sans-serif">{c}</text>'
        for c, x, y in arabic
    )

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="t d">
<title id="t">UGTM</title>
<desc id="d">Logo officiel de l'UGTM sur fond noir : torche à flamme, poignée de main, couronne dentée, rameaux d'olivier, étoile verte entrelacée</desc>
<rect width="512" height="512" fill="#050505"/>
<path d="M256 22 C 272 44 280 62 276 84 L 262 96 L 244 92 C 236 66 242 44 256 22 Z" fill="#EF6C00"/>
<path d="M240 46 C 232 62 230 76 240 92 L 252 96 C 244 78 244 62 240 46 Z" fill="#F7941D"/>
<path d="M272 44 C 282 60 284 76 274 94 L 262 96 C 272 78 274 60 272 44 Z" fill="#FFC457"/>
<path d="M244 108 L268 108 L272 132 L240 132 Z" fill="#C49E4A"/>
<path d="M236 132 L276 132 L270 146 L242 146 Z" fill="#E0BE6E"/>
{path([(198,168),(250,156),(254,174),(202,184)], "#C49E4A")}
{path([(314,168),(262,156),(258,174),(310,184)], "#E0BE6E")}
<ellipse cx="256" cy="169" rx="16" ry="15" fill="#E0BE6E" stroke="#8C6A22" stroke-width="2"/>
{path(teeth, "#C49E4A")}
<circle cx="256" cy="276" r="172" fill="#050505"/>
<circle cx="256" cy="276" r="150" fill="#FAFAF8" stroke="#8C6A22" stroke-width="2"/>
<path d="M136 330 A 126 126 0 0 1 148 208" fill="none" stroke="#4A6420" stroke-width="3"/>
<path d="M376 330 A 126 126 0 0 0 364 208" fill="none" stroke="#4A6420" stroke-width="3"/>
{''.join(leaves)}
<polygon points="{' '.join(f'{p[0]/SS:.1f},{p[1]/SS:.1f}' for p in star)}" fill="none" stroke="#6A852C" stroke-width="12" stroke-linejoin="round"/>
<polygon points="{' '.join(f'{p[0]/SS:.1f},{p[1]/SS:.1f}' for p in weave)}" fill="none" stroke="#4A6420" stroke-width="5" stroke-linejoin="round"/>
{letters}
<text x="256" y="382" font-size="34" font-weight="bold" fill="#2B2926" text-anchor="middle" letter-spacing="5" font-family="'DejaVu Serif',Georgia,serif">UGTM</text>
</svg>
"""


def svg_mark():
    star = star_pts(32, 38, 15, 6.5)
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="t">
<title id="t">UGTM</title>
<rect width="64" height="64" rx="12" fill="#050505"/>
<path d="M32 6 C 34.5 10 35.5 13 34.5 16.5 L 29.5 16.5 C 28.5 13 29.5 10 32 6 Z" fill="#EF6C00"/>
<circle cx="32" cy="38" r="20" fill="none" stroke="#C49E4A" stroke-width="5"/>
<circle cx="32" cy="38" r="16" fill="#FAFAF8"/>
<polygon points="%(star)s" fill="none" stroke="#6A852C" stroke-width="3.4" stroke-linejoin="round"/>
<text x="32" y="59" font-size="9" font-weight="bold" fill="#C49E4A" text-anchor="middle" font-family="'DejaVu Serif',Georgia,serif">UGTM</text>
</svg>
""" % {"star": " ".join(f"{p[0]/SS:.1f},{p[1]/SS:.1f}" for p in star)}


# ------------------------------------------------------------------
# Export
# ------------------------------------------------------------------
def save(master, path, size, scale=1.0, background=None):
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


DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ANDROID_DIR = os.path.join(ROOT, "android-icons")


def write_android(master):
    os.makedirs(ANDROID_DIR, exist_ok=True)

    # launcher (fond noir visible) : logo à 74 % du canevas
    sq_src = master.resize((int(512 * 0.74), int(512 * 0.74)), Image.LANCZOS)
    square = Image.new("RGBA", (432, 432), BLACK)
    square.alpha_composite(sq_src, ((432 - sq_src.width) // 2,) * 2)

    # foreground adaptatif : logo à 52 % sur fond TRANSPARENT
    fg_src = master.resize((int(512 * 0.52), int(512 * 0.52)), Image.LANCZOS)
    fore = Image.new("RGBA", (432, 432), CLEAR)
    fore.alpha_composite(fg_src, ((432 - fg_src.width) // 2,) * 2)

    for dens, px in DENSITIES.items():
        d = os.path.join(ANDROID_DIR, f"mipmap-{dens}")
        os.makedirs(d, exist_ok=True)
        square.resize((px, px), Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"))
        square.resize((px, px), Image.LANCZOS).save(os.path.join(d, "ic_launcher_round.png"))
        fore.resize((px, px), Image.LANCZOS).save(os.path.join(d, "ic_launcher_foreground.png"))
        print(f"écrit android-icons/mipmap-{dens}/ (3 icônes {px}×{px})")

    with open(os.path.join(ANDROID_DIR, "ic_launcher_background.xml"), "w") as f:
        f.write(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            "<resources>\n"
            '  <color name="ic_launcher_background">#000000</color>\n'
            "</resources>\n"
        )
    print("écrit android-icons/ic_launcher_background.xml (#000000)")


def main():
    master = render_master()

    save(master, os.path.join(ICONS, "icon-512.png"), 512)
    save(master, os.path.join(ICONS, "icon-192.png"), 192)
    save(master, os.path.join(ICONS, "icon-maskable-512.png"),
         512, scale=0.78, background=BLACK)
    save(master, os.path.join(ICONS, "favicon-32.png"), 32)
    save(master, os.path.join(ICONS, "apple-touch-icon.png"),
         180, scale=0.92, background=BLACK)

    with open(os.path.join(ICONS, "ugtm-logo.svg"), "w", encoding="utf-8") as f:
        f.write(svg_logo())
    print("écrit www/icons/ugtm-logo.svg")

    with open(os.path.join(ICONS, "ugtm-mark.svg"), "w", encoding="utf-8") as f:
        f.write(svg_mark())
    print("écrit www/icons/ugtm-mark.svg")

    write_android(master)

    # ---- Validation pixel ------------------------------------------------
    px = master.load()
    checks = {
        "fond noir (10,10)": px[10, 10][:3] == (5, 5, 5),
        "flamme orange (256,60)": px[256, 60][0] > 180 and px[256, 60][1] < 160,
        "disque blanc (256,276)": px[256, 276][:3] == (250, 250, 248),
        "couronne dorée (57,276)": px[57, 276][0] > 150 and px[57, 276][2] < 120,
        "étoile verte (~256,176)": px[256, 176][1] >= px[256, 176][0],
    }
    for name, ok in checks.items():
        print(("OK  " if ok else "ECHEC "), name)
    if not all(checks.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
