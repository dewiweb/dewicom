// ============================================================
// DewiCom Beltpack — boîtier OpenSCAD
// Intègre : Stream Deck Module 6 touches (Elgato)
//           Raspberry Pi Zero 2W
//           WM8960 Audio HAT (I2S)
//           PoE HAT mini Waveshare
//           LiPo 704050 2000mAh
//           Connecteurs : XLR5 femelle, RJ45, USB-C
// Fichier STP officiel module : https://res.cloudinary.com/elgato-pwa/raw/upload/v1747898289/2025/Stream%20Deck%20Module/CAD%20Files/SD-Module6_construction_shape.stp
// ============================================================

// ── Paramètres globaux ───────────────────────────────────────
$fn = 48;  // résolution des cercles

// Boîtier externe
BOX_W  = 130;   // largeur  (axe X) mm
BOX_H  =  72;   // hauteur  (axe Y) mm
BOX_D  =  36;   // profondeur (axe Z) mm
WALL   =   2.5; // épaisseur paroi mm
FILLET =   3;   // rayon arrondi mm

// Stream Deck Module 6 touches (dimensions officielles Elgato)
// Source : fichier STP + documentation intégration
SDM_W    = 84.0;  // largeur façade mm
SDM_H    = 55.5;  // hauteur façade mm
SDM_D    = 21.0;  // profondeur totale module mm
SDM_KEY_W = 25.0; // largeur touche LCD mm
SDM_KEY_H = 25.0; // hauteur touche LCD mm
SDM_KEY_GAP = 3;  // espacement entre touches mm
// Fenêtre d'ouverture façade (zone LCD visible 3×2)
SDM_WIN_W = (SDM_KEY_W * 3) + (SDM_KEY_GAP * 2);  // 81mm
SDM_WIN_H = (SDM_KEY_H * 2) + (SDM_KEY_GAP * 1);  // 53mm
SDM_WIN_OFFSET_X = (SDM_W - SDM_WIN_W) / 2;
SDM_WIN_OFFSET_Y = (SDM_H - SDM_WIN_H) / 2;

// Raspberry Pi Zero 2W
RPI_W  = 65;
RPI_H  = 30;
RPI_D  =  5;

// XLR5 femelle Neutrik NC5FD-L — trou de montage
XLR5_D  = 24;   // diamètre du trou de montage mm
XLR5_X  = 20;   // position X depuis bord gauche bas
XLR5_Y  = BOX_H / 2; // centré en hauteur

// RJ45 — trou de montage
RJ45_W = 16.5;
RJ45_H = 14;
RJ45_X = 60;
RJ45_Y = (BOX_H - RJ45_H) / 2;

// USB-C — trou de montage
USBC_W =  9.5;
USBC_H =  3.5;
USBC_X = 98;
USBC_Y = (BOX_H - USBC_H) / 2;

// Clip ceinture
CLIP_W  = 35;
CLIP_H  = 60;
CLIP_D  =  4;
CLIP_SLOT_W = 45;  // largeur courroie max

// ── Modules utilitaires ──────────────────────────────────────

module rounded_box(w, h, d, r) {
    hull() {
        for (x = [r, w-r]) for (y = [r, h-r]) {
            translate([x, y, 0]) cylinder(r=r, h=d);
        }
    }
}

module rounded_box_hollow(w, h, d, r, wall) {
    difference() {
        rounded_box(w, h, d, r);
        translate([wall, wall, wall])
            rounded_box(w - wall*2, h - wall*2, d, r);
    }
}

// ── Corps principal du boîtier ───────────────────────────────

module corps() {
    color("DimGray", 0.85)
    difference() {
        // Coque externe
        rounded_box_hollow(BOX_W, BOX_H, BOX_D, FILLET, WALL);

        // ── Façade avant : ouverture Stream Deck Module ──
        translate([
            (BOX_W - SDM_W) / 2 + SDM_WIN_OFFSET_X,
            (BOX_H - SDM_WIN_H) / 2,
            BOX_D - WALL - 0.01
        ])
        cube([SDM_WIN_W, SDM_WIN_H, WALL + 0.02]);

        // Logement encastré Stream Deck Module (côté intérieur façade)
        translate([
            (BOX_W - SDM_W) / 2,
            (BOX_H - SDM_H) / 2,
            BOX_D - SDM_D
        ])
        cube([SDM_W, SDM_H, SDM_D + 0.1]);

        // ── Connecteurs bas ──

        // XLR5 femelle (cercle)
        translate([XLR5_X, XLR5_Y, -0.01])
            cylinder(d=XLR5_D, h=WALL + 0.02);

        // RJ45 (rectangle)
        translate([RJ45_X, RJ45_Y, -0.01])
            cube([RJ45_W, RJ45_H, WALL + 0.02]);

        // USB-C (rectangle arrondi)
        translate([USBC_X, USBC_Y + USBC_H/2, -0.01]) {
            cube([USBC_W, USBC_H, WALL + 0.02]);
        }

        // ── Ventilation / dissipation (grille de trous dos) ──
        for (ix = [0:4]) for (iy = [0:3]) {
            translate([BOX_W*0.55 + ix*6, BOX_H*0.25 + iy*8, -0.01])
                cylinder(d=2.5, h=WALL + 0.02);
        }

        // ── Trous de vis M3 pour fermeture couvercle (4 coins) ──
        for (x = [8, BOX_W-8]) for (y = [8, BOX_H-8]) {
            translate([x, y, -0.01]) cylinder(d=3.2, h=WALL + 0.02);
        }
    }
}

// ── Couvercle ────────────────────────────────────────────────

module couvercle() {
    color("SlateGray", 0.9)
    translate([0, 0, -WALL])
    difference() {
        rounded_box(BOX_W, BOX_H, WALL, FILLET);
        // Trous de vis
        for (x = [8, BOX_W-8]) for (y = [8, BOX_H-8]) {
            translate([x, y, -0.01]) cylinder(d=2.8, h=WALL + 0.02);
        }
        // Étiquette gravée
        translate([BOX_W*0.1, BOX_H*0.35, WALL*0.5])
            linear_extrude(height=WALL)
            text("DewiCom BP-1", size=5, font="Liberation Sans:style=Bold", halign="left");
    }
}

// ── Clip ceinture ────────────────────────────────────────────

module clip_ceinture() {
    color("Black", 0.9)
    translate([BOX_W + 2, (BOX_H - CLIP_H) / 2, WALL]) {
        difference() {
            // Corps du clip
            union() {
                cube([CLIP_D, CLIP_H, 10]);
                // Patte de fixation sur boîtier
                translate([-8, (CLIP_H - 20) / 2, 0])
                    cube([8 + CLIP_D, 20, 10]);
            }
            // Fente pour courroie / ceinture
            translate([-0.01, (CLIP_H - CLIP_SLOT_W) / 2, 2])
                cube([CLIP_D + 0.02, CLIP_SLOT_W, 6]);
            // Trous de vis fixation sur boîtier M3
            for (y = [(CLIP_H - 20)/2 + 4, (CLIP_H - 20)/2 + 16]) {
                translate([-4, y, 5]) rotate([0, 90, 0])
                    cylinder(d=3.2, h=12);
            }
        }
    }
}

// ── Contenu interne (visualisation transparente) ─────────────

module internals() {
    // Raspberry Pi Zero 2W
    color("Green", 0.7)
    translate([WALL + 4, WALL + 4, WALL + 2])
        cube([RPI_W, RPI_H, RPI_D]);

    // WM8960 Audio HAT (empilé sur RPi)
    color("DarkGreen", 0.6)
    translate([WALL + 4, WALL + 4, WALL + 2 + RPI_D + 3])
        cube([35, 25, 3]);

    // LiPo 704050 (70×40×5mm)
    color("SteelBlue", 0.7)
    translate([WALL + 4, BOX_H - WALL - 44, WALL + 2])
        cube([70, 40, 5]);

    // PoE HAT mini Waveshare (~65×30×12mm)
    color("DarkOrange", 0.6)
    translate([BOX_W - WALL - 70, WALL + 4, WALL + 2])
        cube([65, 30, 12]);

    // Stream Deck Module 6t (positionné en façade)
    color("Gainsboro", 0.8)
    translate([
        (BOX_W - SDM_W) / 2,
        (BOX_H - SDM_H) / 2,
        BOX_D - SDM_D
    ])
    cube([SDM_W, SDM_H, SDM_D]);

    // Touches LCD (3×2 grille)
    for (col = [0:2]) for (row = [0:1]) {
        color("LightCyan", 0.9)
        translate([
            (BOX_W - SDM_W)/2 + SDM_WIN_OFFSET_X + col*(SDM_KEY_W + SDM_KEY_GAP),
            (BOX_H - SDM_H)/2 + SDM_WIN_OFFSET_Y + row*(SDM_KEY_H + SDM_KEY_GAP),
            BOX_D - 0.5
        ])
        cube([SDM_KEY_W, SDM_KEY_H, 1]);
    }
}

// ── Étiquettes connecteurs (gravées) ─────────────────────────

module labels() {
    color("White")
    translate([0, 0, -0.5]) {
        // XLR5
        translate([XLR5_X - 6, -7, 0])
            linear_extrude(height=1)
            text("XLR5", size=3.5, font="Liberation Mono:style=Bold");
        // RJ45
        translate([RJ45_X + 1, -7, 0])
            linear_extrude(height=1)
            text("PoE", size=3.5, font="Liberation Mono:style=Bold");
        // USB-C
        translate([USBC_X, -7, 0])
            linear_extrude(height=1)
            text("USB-C", size=3.5, font="Liberation Mono:style=Bold");
    }
}

// ── Assemblage ───────────────────────────────────────────────

corps();
couvercle();
clip_ceinture();
internals();
labels();

// ── Vue éclatée (décommenter pour export séparé) ─────────────
// translate([0, 0, 50]) couvercle();
// translate([0, 0, 0])  corps();
// translate([BOX_W + 20, 0, 0]) clip_ceinture();
