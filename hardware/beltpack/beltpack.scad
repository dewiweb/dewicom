// ============================================================
// DewiCom Beltpack BP-1 — boîtier OpenSCAD  v2
// Dimensions corrigées après audit volumétrique
//
// Option A : 155×90×42mm — format beltpack pro standard
//   → Stack RPi+HATs tient dans la profondeur
//   → XLR5 coudé (NC5MPR) : empiètement 12mm seulement
//   → LiPo 704050 côte à côte avec le stack RPi
//
// Fichier STP officiel Stream Deck Module 6t :
//   https://res.cloudinary.com/elgato-pwa/raw/upload/v1747898289/
//   2025/Stream%20Deck%20Module/CAD%20Files/SD-Module6_construction_shape.stp
// ============================================================

// ── Paramètres globaux ───────────────────────────────────────
$fn = 64;

// Boîtier externe — Option A réaliste
BOX_W  = 155;   // largeur  (axe X) mm
BOX_H  =  90;   // hauteur  (axe Y) mm
BOX_D  =  42;   // profondeur (axe Z) mm
WALL   =   2.5; // épaisseur paroi mm
FILLET =   4;   // rayon arrondi mm

// ── Stream Deck Module 6 touches ─────────────────────────────
// Source dimensions : STP officiel Elgato + doc intégration
SDM_W       = 84.0;  // largeur façade mm
SDM_H       = 55.5;  // hauteur façade mm
SDM_D       = 21.0;  // profondeur totale module mm
SDM_KEY_W   = 25.0;  // largeur touche LCD mm
SDM_KEY_H   = 25.0;  // hauteur touche LCD mm
SDM_KEY_GAP =  3.0;  // espacement entre touches mm
SDM_WIN_W   = (SDM_KEY_W * 3) + (SDM_KEY_GAP * 2); // 81mm zone visible
SDM_WIN_H   = (SDM_KEY_H * 2) + (SDM_KEY_GAP * 1); // 53mm
SDM_WIN_OX  = (SDM_W - SDM_WIN_W) / 2;
SDM_WIN_OY  = (SDM_H - SDM_WIN_H) / 2;
// Centré horizontalement, décalé en haut de la façade
SDM_X       = (BOX_W - SDM_W) / 2;
SDM_Y       = BOX_H - WALL - SDM_H - 4; // 4mm marge haut

// ── Raspberry Pi Zero 2W ─────────────────────────────────────
RPI_W = 65; RPI_H = 30; RPI_D = 5;
RPI_X = WALL + 6;
RPI_Y = WALL + 6;
RPI_Z = WALL + 3; // surélevé sur entretoises 3mm

// ── WM8960 Audio HAT (I2S) — empilé sur RPi ─────────────────
// Header GPIO 11mm + PCB 3mm
WM_W = 65; WM_H = 30; WM_D = 3;
WM_Z = RPI_Z + RPI_D + 11; // 11mm header GPIO

// ── PoE HAT Waveshare mini — empilé sur WM8960 ──────────────
// Header GPIO 11mm + PCB 3mm + régulateur ~8mm
POE_W = 65; POE_H = 30; POE_D = 11;
POE_Z = WM_Z + WM_D + 11;
// Total stack : RPI_Z(5.5) + 5 + 11 + 3 + 11 + 11 = ~46mm
// → rentre dans BOX_D=42mm uniquement si RPI_Z=3 et headers compacts 8mm
// → on adopte FFC flat cable entre RPi et HATs (voir README)

// ── LiPo 704050 2000mAh (70×40×5mm) ─────────────────────────
LIPO_W = 70; LIPO_H = 40; LIPO_D = 5;
LIPO_X = WALL + 6;
LIPO_Y = BOX_H - WALL - LIPO_H - 6;
LIPO_Z = WALL + 2;

// ── BMS TP5100 (40×20×6mm) ───────────────────────────────────
BMS_W = 40; BMS_H = 20; BMS_D = 6;
BMS_X = WALL + 80;
BMS_Y = WALL + 6;
BMS_Z = WALL + 2;

// ── Connecteurs face inférieure ───────────────────────────────
// XLR5 coudé Neutrik NC5MPR : empiètement 12mm (vs 35mm traversant)
XLR5_D_HOLE = 24;   // diamètre trou mm
XLR5_X = 22;
XLR5_Y = BOX_H / 2;

// RJ45 (16.5×14mm)
RJ45_W = 16.5; RJ45_H = 14;
RJ45_X = 62;
RJ45_Y = (BOX_H - RJ45_H) / 2;

// USB-C (9.5×3.5mm)
USBC_W = 9.5; USBC_H = 3.5;
USBC_X = 108;
USBC_Y = (BOX_H - USBC_H) / 2;

// ── Clip ceinture ─────────────────────────────────────────────
CLIP_H      = 70;
CLIP_D      =  5;
CLIP_SLOT_W = 50; // max 50mm courroie standard

// ── Modules utilitaires ──────────────────────────────────────

module rounded_box(w, h, d, r) {
    hull() {
        for (x = [r, w-r]) for (y = [r, h-r])
            translate([x, y, 0]) cylinder(r=r, h=d);
    }
}

module rounded_slot(w, h, d) {
    // Rectangle aux extrémités arrondies (pour USB-C, jack)
    r = h / 2;
    hull() {
        translate([r, r, 0])       cylinder(r=r, h=d);
        translate([w-r, r, 0])     cylinder(r=r, h=d);
    }
}

module rounded_box_hollow(w, h, d, r, wall) {
    difference() {
        rounded_box(w, h, d, r);
        translate([wall, wall, wall])
            rounded_box(w-wall*2, h-wall*2, d, r);
    }
}

// ── Corps principal ───────────────────────────────────────────

module corps() {
    color("DimGray", 0.85)
    difference() {
        rounded_box_hollow(BOX_W, BOX_H, BOX_D, FILLET, WALL);

        // ── Façade (Z+) : ouverture LCD Stream Deck ──────────
        // Logement encastré pour le module (poche intérieure)
        translate([SDM_X, SDM_Y, BOX_D - SDM_D])
            cube([SDM_W, SDM_H, SDM_D + 0.1]);
        // Fenêtre visible (façade percée)
        translate([SDM_X + SDM_WIN_OX, SDM_Y + SDM_WIN_OY, BOX_D - WALL - 0.01])
            cube([SDM_WIN_W, SDM_WIN_H, WALL + 0.02]);

        // ── Face inférieure (Z-) : connecteurs ───────────────
        // XLR5 coudé NC5MPR — cercle Ø24
        translate([XLR5_X, XLR5_Y, -0.01])
            cylinder(d=XLR5_D_HOLE, h=WALL + 0.02);
        // RJ45 — rectangle 16.5×14
        translate([RJ45_X, RJ45_Y, -0.01])
            cube([RJ45_W, RJ45_H, WALL + 0.02]);
        // USB-C — slot arrondi 9.5×3.5
        translate([USBC_X, USBC_Y, -0.01])
            rounded_slot(USBC_W, USBC_H, WALL + 0.02);

        // ── Grille de ventilation (face dos Z-) ──────────────
        for (ix = [0:5]) for (iy = [0:4])
            translate([BOX_W*0.58 + ix*7, BOX_H*0.15 + iy*13, -0.01])
                cylinder(d=2.8, h=WALL + 0.02);

        // ── Trous de vis M3 fermeture couvercle (4 coins) ────
        for (x = [9, BOX_W-9]) for (y = [9, BOX_H-9])
            translate([x, y, -0.01]) cylinder(d=3.4, h=WALL + 0.02);

        // ── Trous de vis M3 clip ceinture (côté droit) ───────
        for (y = [BOX_H*0.3, BOX_H*0.7])
            translate([BOX_W - WALL - 0.01, y, BOX_D/2])
                rotate([0, 90, 0]) cylinder(d=3.4, h=WALL + 0.02);

        // ── Étiquettes gravées face inférieure ────────────────
        translate([XLR5_X - 7, 0.5, 0.8])
            linear_extrude(height=0.8)
            text("XLR5", size=3, font="Liberation Mono:style=Bold");
        translate([RJ45_X + 1, 0.5, 0.8])
            linear_extrude(height=0.8)
            text("PoE", size=3, font="Liberation Mono:style=Bold");
        translate([USBC_X, 0.5, 0.8])
            linear_extrude(height=0.8)
            text("USB-C", size=3, font="Liberation Mono:style=Bold");
    }
}

// ── Couvercle (face Z-) ──────────────────────────────────────

module couvercle() {
    color("SlateGray", 0.92)
    translate([0, 0, -WALL])
    difference() {
        rounded_box(BOX_W, BOX_H, WALL, FILLET);
        // Trous de vis M3
        for (x = [9, BOX_W-9]) for (y = [9, BOX_H-9])
            translate([x, y, -0.01]) cylinder(d=3.0, h=WALL + 0.02);
        // Gravure logo
        translate([12, BOX_H*0.38, WALL - 0.6])
            linear_extrude(height=0.7)
            text("DewiCom  BP-1", size=5.5,
                 font="Liberation Sans:style=Bold", halign="left");
        // Gravure dimensions (info intégrateur)
        translate([12, BOX_H*0.22, WALL - 0.6])
            linear_extrude(height=0.7)
            text("155 x 90 x 42 mm", size=3.5,
                 font="Liberation Mono", halign="left");
    }
}

// ── Clip ceinture (côté droit du boîtier) ────────────────────

module clip_ceinture() {
    PATTE_H = 28; // hauteur zone fixation sur boîtier
    PATTE_W = 10;
    color("Black", 0.92)
    translate([BOX_W + 1, (BOX_H - CLIP_H) / 2, (BOX_D - 12) / 2]) {
        difference() {
            union() {
                // Lame du clip
                cube([CLIP_D, CLIP_H, 12]);
                // Patte vissée sur le boîtier
                translate([-PATTE_W, (CLIP_H - PATTE_H) / 2, 0])
                    cube([PATTE_W + CLIP_D, PATTE_H, 12]);
            }
            // Fente passage ceinture / courroie 50mm
            translate([-0.01, (CLIP_H - CLIP_SLOT_W) / 2, 2.5])
                cube([CLIP_D + 0.02, CLIP_SLOT_W, 7]);
            // Trous de vis M3 dans la patte
            for (y = [CLIP_H*0.25, CLIP_H*0.75])
                translate([-PATTE_W - 0.01, y, 6])
                    rotate([0, 90, 0]) cylinder(d=3.2, h=PATTE_W + 0.02);
        }
    }
}

// ── Internals (visualisation composants) ─────────────────────

module internals() {
    // ── RPi Zero 2W (vert) ───────────────────────────────────
    color("Green", 0.75)
    translate([RPI_X, RPI_Y, RPI_Z]) cube([RPI_W, RPI_H, RPI_D]);

    // Entretoises RPi (4 coins)
    color("Silver") for (ex=[RPI_X+3, RPI_X+RPI_W-3]) for (ey=[RPI_Y+3, RPI_Y+RPI_H-3])
        translate([ex, ey, WALL]) cylinder(d=2.5, h=3);

    // ── WM8960 Audio HAT — côté RPi, relié par FFC ───────────
    // Positionné côte à côte (pas empilé) pour économiser la hauteur
    color("DarkGreen", 0.7)
    translate([RPI_X + RPI_W + 5, RPI_Y, WALL + 2]) cube([WM_W, WM_H, WM_D]);

    // ── PoE HAT — côté opposé, bas du boîtier ────────────────
    color("DarkOrange", 0.7)
    translate([BMS_X, BMS_Y, BMS_Z]) cube([POE_W, POE_H, POE_D]);

    // ── BMS TP5100 ────────────────────────────────────────────
    color("Chocolate", 0.8)
    translate([BMS_X + POE_W + 4, BMS_Y, BMS_Z]) cube([BMS_W, BMS_H, BMS_D]);

    // ── LiPo 704050 (bleu) ────────────────────────────────────
    color("SteelBlue", 0.75)
    translate([LIPO_X, LIPO_Y, LIPO_Z]) cube([LIPO_W, LIPO_H, LIPO_D]);

    // ── Stream Deck Module 6t (gris clair) ───────────────────
    color("Gainsboro", 0.85)
    translate([SDM_X, SDM_Y, BOX_D - SDM_D])
        cube([SDM_W, SDM_H, SDM_D]);

    // Touches LCD allumées (cyan)
    for (col = [0:2]) for (row = [0:1])
        color("LightCyan", 0.95)
        translate([
            SDM_X + SDM_WIN_OX + col*(SDM_KEY_W + SDM_KEY_GAP),
            SDM_Y + SDM_WIN_OY + row*(SDM_KEY_H + SDM_KEY_GAP),
            BOX_D - 0.4
        ])
        cube([SDM_KEY_W, SDM_KEY_H, 0.8]);

    // ── XLR5 coudé NC5MPR (empiètement 12mm) ─────────────────
    color("Silver", 0.9)
    translate([XLR5_X - XLR5_D_HOLE/2, XLR5_Y - XLR5_D_HOLE/2, -12])
        cube([XLR5_D_HOLE, XLR5_D_HOLE, 12]);

    // ── Câblage FFC RPi ↔ HATs (représenté en ruban plat) ────
    color("Gold", 0.6)
    translate([RPI_X + RPI_W, RPI_Y + RPI_H/2 - 2, WALL + 4])
        cube([5, 4, 0.3]);
}

// ── Annotations (plans 2D projetés) ──────────────────────────

module annotations() {
    color("White", 0.9) {
        // Cote largeur
        translate([0, -12, 0]) {
            cube([BOX_W, 0.3, 0.3]);
            translate([BOX_W/2 - 8, -5, 0])
                linear_extrude(1) text("155mm", size=4);
        }
        // Cote hauteur
        translate([-14, 0, 0]) {
            cube([0.3, BOX_H, 0.3]);
            translate([-2, BOX_H/2, 0]) rotate([0,0,90])
                linear_extrude(1) text("90mm", size=4);
        }
    }
}

// ── Assemblage principal ──────────────────────────────────────

corps();
couvercle();
clip_ceinture();
internals();
annotations();

// ── Vue éclatée (décommenter pour impression / export pièces) ─
// translate([0, 0,  60]) couvercle();
// translate([0, 0,   0]) corps();
// translate([BOX_W + 30, 0, 0]) clip_ceinture();
