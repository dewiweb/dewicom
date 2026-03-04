// ============================================================
// DewiCom Beltpack BP-1 — boîtier OpenSCAD  v3
//
// ORIENTATION PORTRAIT — format beltpack pro (Clear-Com, RTS)
//
//   Axes :
//     X = largeur  = 90mm  (petite dimension)
//     Y = longueur = 155mm (grande dimension = profondeur du corps)
//     Z = épaisseur= 42mm
//
//   Face avant  (Y = BOX_L) : Stream Deck Module 6 touches (84×55.5mm)
//   Face arrière (Y = 0)    : XLR5 + RJ45 + USB-C (connectique)
//   Face dos    (Z = 0)     : clip ceinture
//   Face avant  (Z = BOX_D) : façade lisse avec touches LCD
//
// Fichier STP officiel Stream Deck Module 6t :
//   https://res.cloudinary.com/elgato-pwa/raw/upload/v1747898289/
//   2025/Stream%20Deck%20Module/CAD%20Files/SD-Module6_construction_shape.stp
// ============================================================

// ── Paramètres globaux ───────────────────────────────────────
$fn = 64;

// Boîtier externe
BOX_W  =  90;   // largeur  (axe X) — petite face mm
BOX_L  = 155;   // longueur (axe Y) — grande dimension mm
BOX_D  =  42;   // épaisseur (axe Z) mm
WALL   =   2.5; // épaisseur paroi mm
FILLET =   4;   // rayon arrondi mm

// ── Stream Deck Module 6 touches ─────────────────────────────
// Monté sur la face avant (Y = BOX_L), centré en X et Z
// Le module est orienté 3 colonnes × 2 lignes (landscape)
SDM_W       = 84.0;  // dimension X (largeur) sur la face avant mm
SDM_H       = 55.5;  // dimension Z (hauteur) sur la face avant mm
SDM_D       = 21.0;  // profondeur du module (dans l'axe Y) mm
SDM_KEY_W   = 25.0;
SDM_KEY_H   = 25.0;
SDM_KEY_GAP =  3.0;
SDM_WIN_W   = (SDM_KEY_W * 3) + (SDM_KEY_GAP * 2); // 81mm
SDM_WIN_H   = (SDM_KEY_H * 2) + (SDM_KEY_GAP * 1); // 53mm
SDM_WIN_OX  = (SDM_W - SDM_WIN_W) / 2;
SDM_WIN_OZ  = (SDM_H - SDM_WIN_H) / 2;
// Position sur la face avant (Y+) — centré en X, centré en Z
SDM_X       = (BOX_W - SDM_W) / 2;
SDM_Z       = (BOX_D - SDM_H) / 2;

// ── Composants internes (disposés sur axe Y, côté connecteurs) ─
// Tous à plat dans XZ, empilés le long de Y depuis l'arrière

// RPi Zero 2W (65×30mm, plat dans XZ, axe long sur X)
RPI_W = 65; RPI_H = 30; RPI_D = 5; // W=X, H=Y(profondeur sur carte), D=Z
RPI_X = (BOX_W - RPI_W) / 2;       // centré en X
RPI_Y = WALL + 10;                  // depuis face arrière (connecteurs)
RPI_Z = WALL + 6;                   // surélevé entretoises

// WM8960 Audio HAT (65×30mm) — côte à côte avec RPi via FFC, même Z
WM_W = 65; WM_H = 8; WM_D = 30;    // W=X, H=Y(épaisseur), D=Z
WM_X = (BOX_W - WM_W) / 2;
WM_Y = RPI_Y + RPI_H + 8;          // derrière RPi sur axe Y
WM_Z = RPI_Z;

// PoE HAT Waveshare mini (65×30×11mm) — suite sur axe Y
POE_W = 65; POE_H = 11; POE_D = 30;
POE_X = (BOX_W - POE_W) / 2;
POE_Y = WM_Y + WM_H + 8;
POE_Z = RPI_Z;

// LiPo 704050 (70×40×5mm) — couché à plat, Z bas
LIPO_W = 70; LIPO_L = 40; LIPO_D = 5;
LIPO_X = (BOX_W - LIPO_W) / 2;
LIPO_Y = POE_Y + POE_H + 8;
LIPO_Z = WALL + 2;

// BMS TP5100 (40×20×6mm)
BMS_W = 40; BMS_L = 20; BMS_D = 6;
BMS_X = (BOX_W - BMS_W) / 2;
BMS_Y = LIPO_Y + LIPO_L + 6;
BMS_Z = WALL + 2;

// ── Connecteurs face arrière (Y = 0) ─────────────────────────
// Face 90mm (X) × 42mm (Z) — même layout que beltpack pro
// XLR5 coudé NC5MPR — à gauche, centré en Z
XLR5_D_HOLE = 24;
XLR5_X      = BOX_W * 0.25;        // 1/4 de la largeur
XLR5_Z      = BOX_D / 2;           // centré en Z

// RJ45 (16.5×14mm) — milieu
RJ45_W = 16.5; RJ45_D = 14;
RJ45_X = (BOX_W - RJ45_W) / 2;     // centré en X
RJ45_Z = (BOX_D - RJ45_D) / 2;     // centré en Z

// USB-C (9.5×3.5mm) — à droite
USBC_W = 9.5; USBC_D = 3.5;
USBC_X = BOX_W * 0.72;
USBC_Z = (BOX_D - USBC_D) / 2;

// ── Clip ceinture (sur le dos, face Z = 0) ───────────────────
CLIP_L      = 80;   // longueur clip (axe Y)
CLIP_D_T    =  5;   // épaisseur lame
CLIP_SLOT_W = 50;   // max ceinture 50mm (axe Y)

// ── Modules utilitaires ──────────────────────────────────────

// Boîte arrondie dans le plan XY, extrudée en Z
module rbox(w, l, d, r) {
    hull()
        for (x=[r, w-r]) for (y=[r, l-r])
            translate([x, y, 0]) cylinder(r=r, h=d);
}

// Slot arrondi sur les petits côtés (USB-C, jack)
module rslot(w, d_z, len) {
    r = d_z / 2;
    hull() {
        translate([r,   0, r]) rotate([-90,0,0]) cylinder(r=r, h=len);
        translate([w-r, 0, r]) rotate([-90,0,0]) cylinder(r=r, h=len);
    }
}

// Corps creux avec parois uniformes
module rbox_hollow(w, l, d, r, wall) {
    difference() {
        rbox(w, l, d, r);
        translate([wall, wall, wall])
            rbox(w-wall*2, l-wall*2, d, r);
    }
}

// ── Corps principal ───────────────────────────────────────────
// X = largeur 90mm  |  Y = longueur 155mm  |  Z = épaisseur 42mm
// Face avant  Y = BOX_L : Stream Deck Module
// Face arrière Y = 0    : connecteurs XLR5 / RJ45 / USB-C
// Face dos Z = 0 (dessous) : clip ceinture

module corps() {
    color("DimGray", 0.85)
    difference() {
        rbox_hollow(BOX_W, BOX_L, BOX_D, FILLET, WALL);

        // ── FACE AVANT (Y = BOX_L) : Stream Deck Module ──────
        // Poche intérieure pour loger le module (profondeur SDM_D)
        translate([SDM_X, BOX_L - SDM_D, SDM_Z])
            cube([SDM_W, SDM_D + 0.1, SDM_H]);
        // Ouverture LCD (fenêtre percée dans la paroi)
        translate([SDM_X + SDM_WIN_OX, BOX_L - WALL - 0.01, SDM_Z + SDM_WIN_OZ])
            cube([SDM_WIN_W, WALL + 0.02, SDM_WIN_H]);

        // ── FACE ARRIÈRE (Y = 0) : connecteurs ───────────────
        // XLR5 coudé NC5MPR — cercle Ø24
        translate([XLR5_X, -0.01, XLR5_Z])
            rotate([-90, 0, 0]) cylinder(d=XLR5_D_HOLE, h=WALL + 0.02);
        // RJ45 — rectangle 16.5 (X) × 14 (Z)
        translate([RJ45_X, -0.01, RJ45_Z])
            cube([RJ45_W, WALL + 0.02, RJ45_D]);
        // USB-C — slot arrondi 9.5×3.5
        translate([USBC_X, -0.01, USBC_Z])
            rslot(USBC_W, USBC_D, WALL + 0.02);
        // Étiquettes gravées (face arrière extérieure)
        translate([XLR5_X - 7, -1.2, 2])
            rotate([90, 0, 0]) linear_extrude(1.2)
            text("XLR5", size=3, font="Liberation Mono:style=Bold");
        translate([RJ45_X, -1.2, 2])
            rotate([90, 0, 0]) linear_extrude(1.2)
            text("PoE", size=3, font="Liberation Mono:style=Bold");
        translate([USBC_X - 2, -1.2, 2])
            rotate([90, 0, 0]) linear_extrude(1.2)
            text("USB-C", size=3, font="Liberation Mono:style=Bold");

        // ── Grille ventilation face dos (Z = 0) ──────────────
        for (ix=[0:4]) for (iy=[0:6])
            translate([BOX_W*0.15 + ix*13, BOX_L*0.15 + iy*18, -0.01])
                cylinder(d=3, h=WALL + 0.02);

        // ── Trous vis M3 couvercle (face dos) — 4 coins ──────
        for (x=[9, BOX_W-9]) for (y=[10, BOX_L-10])
            translate([x, y, -0.01]) cylinder(d=3.4, h=WALL + 0.02);

        // ── Trous vis M3 clip ceinture (face dos, centre long) ─
        for (y=[BOX_L*0.35, BOX_L*0.65])
            translate([BOX_W/2, y, -0.01]) cylinder(d=3.4, h=WALL + 0.02);
    }
}

// ── Couvercle (face dos Z = 0) ───────────────────────────────

module couvercle() {
    color("SlateGray", 0.92)
    translate([0, 0, -WALL])
    difference() {
        rbox(BOX_W, BOX_L, WALL, FILLET);
        // Trous vis M3
        for (x=[9, BOX_W-9]) for (y=[10, BOX_L-10])
            translate([x, y, -0.01]) cylinder(d=3.0, h=WALL + 0.02);
        // Trous clip ceinture
        for (y=[BOX_L*0.35, BOX_L*0.65])
            translate([BOX_W/2, y, -0.01]) cylinder(d=3.0, h=WALL + 0.02);
        // Gravure "DewiCom BP-1"
        translate([BOX_W*0.1, BOX_L*0.42, WALL - 0.6])
            linear_extrude(0.7)
            text("DewiCom BP-1", size=5.5,
                 font="Liberation Sans:style=Bold", halign="left");
        translate([BOX_W*0.1, BOX_L*0.35, WALL - 0.6])
            linear_extrude(0.7)
            text("90x155x42 mm", size=3.5,
                 font="Liberation Mono", halign="left");
    }
}

// ── Clip ceinture (collé sur le dos Z=0, centré) ─────────────

module clip_ceinture() {
    PATTE_L = 40;  // longueur patte vissée (axe Y)
    PATTE_W = 10;  // profondeur patte (axe X recouvert)
    PATTE_D = 10;  // épaisseur totale clip (axe Z)
    color("Black", 0.92)
    translate([(BOX_W - PATTE_L) / 2, (BOX_L - PATTE_L) / 2, -WALL - PATTE_D]) {
        difference() {
            union() {
                // Patte vissée sur le boîtier
                cube([PATTE_L, PATTE_L, PATTE_D]);
                // Lame du clip qui dépasse sous le boîtier
                translate([(PATTE_L - CLIP_SLOT_W) / 2, -CLIP_D_T, 0])
                    cube([CLIP_SLOT_W, CLIP_D_T, PATTE_D]);
            }
            // Fente pour la ceinture / courroie
            translate([(PATTE_L - CLIP_SLOT_W) / 2 - 0.01,
                        -CLIP_D_T - 0.01, PATTE_D * 0.2])
                cube([CLIP_SLOT_W + 0.02, CLIP_D_T + 0.02, PATTE_D * 0.6]);
            // Trous de vis M3
            for (x=[PATTE_L/2 - 10, PATTE_L/2 + 10])
                for (y=[PATTE_L/2 - 10, PATTE_L/2 + 10])
                    translate([x, y, -0.01]) cylinder(d=3.2, h=PATTE_D + 0.02);
        }
    }
}

// ── Internals (visualisation composants en transparence) ──────

module internals() {
    // RPi Zero 2W — PCB vert, plat dans plan XY
    color("Green", 0.75)
    translate([RPI_X, RPI_Y, RPI_Z]) cube([RPI_W, RPI_H, RPI_D]);

    // Entretoises M2.5 aux 4 coins du RPi
    color("Silver", 0.9)
    for (ex=[RPI_X+3.5, RPI_X+RPI_W-3.5])
        for (ey=[RPI_Y+3.5, RPI_Y+RPI_H-3.5])
            translate([ex, ey, WALL]) cylinder(d=2.5, h=RPI_Z - WALL);

    // WM8960 Audio HAT — derrière le RPi sur Y
    color("DarkGreen", 0.7)
    translate([WM_X, WM_Y, WM_Z]) cube([WM_W, WM_H, WM_D]);

    // PoE HAT Waveshare mini
    color("DarkOrange", 0.7)
    translate([POE_X, POE_Y, POE_Z]) cube([POE_W, POE_H, POE_D]);

    // LiPo 704050
    color("SteelBlue", 0.75)
    translate([LIPO_X, LIPO_Y, LIPO_Z]) cube([LIPO_W, LIPO_L, LIPO_D]);

    // BMS TP5100
    color("Chocolate", 0.8)
    translate([BMS_X, BMS_Y, BMS_Z]) cube([BMS_W, BMS_L, BMS_D]);

    // Câble FFC entre RPi et WM8960 (ruban doré)
    color("Gold", 0.6)
    translate([RPI_X + RPI_W/2 - 2, RPI_Y + RPI_H, RPI_Z + 1])
        cube([4, WM_Y - RPI_Y - RPI_H, 0.5]);

    // Stream Deck Module 6t — encastré en face avant
    color("Gainsboro", 0.85)
    translate([SDM_X, BOX_L - SDM_D, SDM_Z]) cube([SDM_W, SDM_D, SDM_H]);

    // Touches LCD (3 col × 2 lignes) — surface avant
    for (col=[0:2]) for (row=[0:1])
        color("LightCyan", 0.95)
        translate([
            SDM_X + SDM_WIN_OX + col*(SDM_KEY_W + SDM_KEY_GAP),
            BOX_L - 0.5,
            SDM_Z + SDM_WIN_OZ + row*(SDM_KEY_H + SDM_KEY_GAP)
        ])
        cube([SDM_KEY_W, 0.8, SDM_KEY_H]);

    // XLR5 coudé NC5MPR — corps visible depuis l'extérieur
    color("Silver", 0.85)
    translate([XLR5_X - XLR5_D_HOLE/2, -15, XLR5_Z - XLR5_D_HOLE/2])
        cube([XLR5_D_HOLE, 15, XLR5_D_HOLE]);

    // RJ45 — corps
    color("Ivory", 0.85)
    translate([RJ45_X, -16, RJ45_Z]) cube([RJ45_W, 16, RJ45_D]);
}

// ── Annotations ───────────────────────────────────────────────

module annotations() {
    color("White", 0.9) {
        // Cote X (90mm)
        translate([0, -14, 0]) {
            cube([BOX_W, 0.3, 0.3]);
            translate([BOX_W/2 - 7, -5, 0])
                linear_extrude(1) text("90mm", size=4);
        }
        // Cote Y (155mm)
        translate([-14, 0, 0]) {
            cube([0.3, BOX_L, 0.3]);
            translate([-2, BOX_L/2 - 8, 0]) rotate([0,0,90])
                linear_extrude(1) text("155mm", size=4);
        }
        // Cote Z (42mm)
        translate([BOX_W + 2, 0, 0]) {
            cube([0.3, 0.3, BOX_D]);
            translate([2, 0, BOX_D/2])
                linear_extrude(1) text("42mm", size=4);
        }
    }
}

// ── Assemblage ────────────────────────────────────────────────

corps();
couvercle();
clip_ceinture();
internals();
annotations();

// ── Vue éclatée (décommenter pour export pièces séparées) ─────
// translate([0, 0, -50]) couvercle();
// translate([0, 0,   0]) corps();
// translate([0, 0, -80]) clip_ceinture();
