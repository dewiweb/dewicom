// ============================================================
// DewiCom Beltpack BP-1 — boîtier OpenSCAD  v4
//
// ORIENTATION BELTPACK PRO — posé à plat, porté à la ceinture
//
//   X = largeur   =  90mm
//   Y = épaisseur =  42mm  (avant → arrière)
//   Z = hauteur   = 155mm  (bas → haut)
//
//   Dessus  Z+ : Stream Deck Module 6 touches (84×55mm) dans plan XY
//   Dessous Z- : connecteurs XLR5 + RJ45 + USB-C
//   Dos     Y+ : couvercle + clip ceinture (vers la ceinture)
//   Avant   Y- : façade avant lisse
//
// Fichier STP officiel Stream Deck Module 6t :
//   https://res.cloudinary.com/elgato-pwa/raw/upload/v1747898289/
//   2025/Stream%20Deck%20Module/CAD%20Files/SD-Module6_construction_shape.stp
// ============================================================

$fn = 64;

// ── Boîtier ──────────────────────────────────────────────────
BOX_W  =  90;   // largeur  X mm
BOX_Y  =  42;   // épaisseur Y mm (avant-arrière)
BOX_H  = 155;   // hauteur  Z mm
WALL   =   2.5;
FILLET =   4;

// ── Stream Deck Module 6t — face dessus (Z+) ─────────────────
// Centré en X, centré en Y (épaisseur), encastré dans la face Z+
SDM_W     = 84.0;   // dimension X mm
SDM_Y_DIM = 55.5;   // dimension Y mm (profondeur dans le boîtier)
SDM_D     = 21.0;   // épaisseur module (axe Z, vers le bas) mm
SDM_KEY_W  = 25.0;
SDM_KEY_H  = 25.0;  // dimension Y d'une touche
SDM_KEY_G  =  3.0;
SDM_WIN_X  = (SDM_KEY_W * 3) + (SDM_KEY_G * 2); // 81mm
SDM_WIN_Y  = (SDM_KEY_H * 2) + (SDM_KEY_G * 1); // 53mm
SDM_OX     = (SDM_W - SDM_WIN_X) / 2;
SDM_OY     = (SDM_Y_DIM - SDM_WIN_Y) / 2;
SDM_PX     = (BOX_W - SDM_W)     / 2;  // centré X
SDM_PY     = (BOX_Y - SDM_Y_DIM) / 2;  // centré Y

// ── Composants internes — disposés sur axe Z, depuis le bas ──
// Tous à plat dans plan XY, empilés vers le haut

// RPi Zero 2W (65×30mm)  axe long sur X
RPI_W = 65; RPI_Y_D = 30; RPI_T = 5;
RPI_X = (BOX_W - RPI_W) / 2;
RPI_PY = (BOX_Y - RPI_Y_D) / 2;
RPI_Z = WALL + 12;   // depuis le bas (au-dessus des connecteurs)

// WM8960 Audio HAT (65×30×3mm) — juste au-dessus RPi via FFC
WM_W = 65; WM_Y_D = 30; WM_T = 3;
WM_X = (BOX_W - WM_W) / 2;
WM_PY = RPI_PY;
WM_Z = RPI_Z + RPI_T + 8;   // 8mm header

// PoE HAT (65×30×11mm)
POE_W = 65; POE_Y_D = 30; POE_T = 11;
POE_X = (BOX_W - POE_W) / 2;
POE_PY = RPI_PY;
POE_Z = WM_Z + WM_T + 8;

// LiPo 704050 (70×40×5mm) — à plat
LIPO_W = 70; LIPO_Y_D = 38; LIPO_T = 5;
LIPO_X = (BOX_W - LIPO_W) / 2;
LIPO_PY = (BOX_Y - LIPO_Y_D) / 2;
LIPO_Z = POE_Z + POE_T + 6;

// BMS TP5100 (40×20×6mm)
BMS_W = 40; BMS_Y_D = 20; BMS_T = 6;
BMS_X = (BOX_W - BMS_W) / 2;
BMS_PY = (BOX_Y - BMS_Y_D) / 2;
BMS_Z = LIPO_Z + LIPO_T + 4;

// ── Connecteurs face dessous (Z = 0) ─────────────────────────
// Face 90mm (X) × 42mm (Y) — layout beltpack pro
XLR5_HOLE = 24;
XLR5_X    = BOX_W * 0.22;
XLR5_Y    = BOX_Y / 2;

RJ45_W_C = 16.5; RJ45_Y_C = 14;
RJ45_X   = (BOX_W - RJ45_W_C) / 2;
RJ45_Y   = (BOX_Y - RJ45_Y_C) / 2;

USBC_W_C = 9.5; USBC_Y_C = 3.5;
USBC_X   = BOX_W * 0.74;
USBC_Y   = (BOX_Y - USBC_Y_C) / 2;

// ── Clip ceinture — face dos (Y+) ────────────────────────────
CLIP_H_C    = 90;  // hauteur clip (axe Z)
CLIP_T      =  5;  // épaisseur lame
CLIP_SLOT   = 50;  // largeur ceinture max (axe Z)

// ── Modules utilitaires ──────────────────────────────────────

// Boîte arrondie XY extrudée en Z
module rbox(w, d, h, r) {
    hull()
        for (x=[r, w-r]) for (y=[r, d-r])
            translate([x, y, 0]) cylinder(r=r, h=h);
}

// Slot arrondi dans plan XY, percé en Z (USB-C)
module rslot_z(w, d, h) {
    r = d / 2;
    hull() {
        translate([r,   r, 0]) cylinder(r=r, h=h);
        translate([w-r, r, 0]) cylinder(r=r, h=h);
    }
}

// Corps creux, ouvert en Z+
module rbox_hollow(w, d, h, r, wall) {
    difference() {
        rbox(w, d, h, r);
        translate([wall, wall, wall])
            rbox(w-wall*2, d-wall*2, h, r);
    }
}

// ── Corps principal ───────────────────────────────────────────
// X=90mm  Y=42mm(épaisseur)  Z=155mm(hauteur)
// Z+ (dessus)  : Stream Deck Module
// Z- (dessous) : connecteurs XLR5 / RJ45 / USB-C
// Y+ (dos)     : couvercle + clip ceinture

module corps() {
    color("DimGray", 0.85)
    difference() {
        rbox_hollow(BOX_W, BOX_Y, BOX_H, FILLET, WALL);

        // ── DESSUS (Z+) : poche + fenêtre Stream Deck ────────
        // Poche intérieure pour loger le module (descend de SDM_D depuis Z+)
        translate([SDM_PX, SDM_PY, BOX_H - SDM_D])
            cube([SDM_W, SDM_Y_DIM, SDM_D + 0.1]);
        // Fenêtre LCD percée (paroi du dessus)
        translate([SDM_PX + SDM_OX, SDM_PY + SDM_OY, BOX_H - WALL - 0.01])
            cube([SDM_WIN_X, SDM_WIN_Y, WALL + 0.02]);

        // ── DESSOUS (Z=0) : connecteurs ──────────────────────
        // XLR5 coudé NC5MPR — Ø24, centré en Y
        translate([XLR5_X, XLR5_Y, -0.01])
            cylinder(d=XLR5_HOLE, h=WALL + 0.02);
        // RJ45 — rectangle 16.5×14
        translate([RJ45_X, RJ45_Y, -0.01])
            cube([RJ45_W_C, RJ45_Y_C, WALL + 0.02]);
        // USB-C — slot arrondi 9.5×3.5
        translate([USBC_X, USBC_Y, -0.01])
            rslot_z(USBC_W_C, USBC_Y_C, WALL + 0.02);
        // Étiquettes gravées dessous (vers l'extérieur)
        translate([XLR5_X - 8, XLR5_Y + XLR5_HOLE/2 + 1, -1.2])
            linear_extrude(1.2)
            text("XLR5", size=3.5, font="Liberation Mono:style=Bold");
        translate([RJ45_X, RJ45_Y + RJ45_Y_C + 1, -1.2])
            linear_extrude(1.2)
            text("PoE", size=3.5, font="Liberation Mono:style=Bold");
        translate([USBC_X - 3, USBC_Y + USBC_Y_C + 1, -1.2])
            linear_extrude(1.2)
            text("USB", size=3.5, font="Liberation Mono:style=Bold");

        // ── DOS (Y+) : trous vis couvercle + clip ─────────────
        for (x=[9, BOX_W-9]) for (z=[12, BOX_H-12])
            translate([x, BOX_Y - WALL - 0.01, z])
                rotate([-90,0,0]) cylinder(d=3.4, h=WALL + 0.02);
        // Trous clip ceinture (centre hauteur)
        for (z=[BOX_H*0.35, BOX_H*0.65])
            translate([BOX_W/2, BOX_Y - WALL - 0.01, z])
                rotate([-90,0,0]) cylinder(d=3.4, h=WALL + 0.02);

        // ── Grille ventilation AVANT (Y=0) ────────────────────
        for (ix=[0:3]) for (iz=[0:6])
            translate([BOX_W*0.2 + ix*17, -0.01, BOX_H*0.1 + iz*18])
                rotate([-90,0,0]) cylinder(d=3, h=WALL + 0.02);
    }
}

// ── Couvercle (face dos Y+) ──────────────────────────────────

module couvercle() {
    color("SlateGray", 0.92)
    translate([0, BOX_Y, 0])
    difference() {
        rbox(BOX_W, WALL, BOX_H, FILLET);
        // Trous vis M3 (4 coins)
        for (x=[9, BOX_W-9]) for (z=[12, BOX_H-12])
            translate([x, -0.01, z])
                rotate([-90,0,0]) cylinder(d=3.0, h=WALL + 0.02);
        // Trous clip
        for (z=[BOX_H*0.35, BOX_H*0.65])
            translate([BOX_W/2, -0.01, z])
                rotate([-90,0,0]) cylinder(d=3.0, h=WALL + 0.02);
        // Gravure logo
        translate([8, WALL - 0.6, BOX_H*0.45])
            rotate([90,0,0]) linear_extrude(0.7)
            text("DewiCom BP-1", size=5.5,
                 font="Liberation Sans:style=Bold", halign="left");
        translate([8, WALL - 0.6, BOX_H*0.38])
            rotate([90,0,0]) linear_extrude(0.7)
            text("90 x 42 x 155 mm", size=3.5,
                 font="Liberation Mono", halign="left");
    }
}

// ── Clip ceinture (sur le dos Y+, centré en X et Z) ──────────

module clip_ceinture() {
    PATTE_W2 = 50;  // largeur patte X
    PATTE_H2 = 40;  // hauteur patte Z
    PATTE_D2 = 10;  // épaisseur totale (axe Y, en saillie)
    color("Black", 0.92)
    translate([(BOX_W - PATTE_W2)/2, BOX_Y, (BOX_H - PATTE_H2)/2]) {
        difference() {
            union() {
                // Patte vissée
                cube([PATTE_W2, PATTE_D2, PATTE_H2]);
                // Lame du clip (vers l'extérieur en Y+)
                translate([(PATTE_W2 - CLIP_SLOT)/2,
                            PATTE_D2 - 0.01, 0])
                    cube([CLIP_SLOT, CLIP_T, PATTE_H2]);
            }
            // Fente ceinture (axe Z, au milieu de la lame)
            translate([(PATTE_W2 - CLIP_SLOT)/2 - 0.01,
                        PATTE_D2 - 0.01,
                        PATTE_H2 * 0.2])
                cube([CLIP_SLOT + 0.02, CLIP_T + 0.02,
                      PATTE_H2 * 0.6]);
            // Trous de vis M3
            for (x=[PATTE_W2*0.2, PATTE_W2*0.8])
                for (z=[PATTE_H2*0.2, PATTE_H2*0.8])
                    translate([x, -0.01, z])
                        rotate([-90,0,0])
                        cylinder(d=3.2, h=PATTE_D2 + 0.02);
        }
    }
}

// ── Internals ─────────────────────────────────────────────────

module internals() {
    // RPi Zero 2W — plat XY, Z bas
    color("Green", 0.75)
    translate([RPI_X, RPI_PY, RPI_Z]) cube([RPI_W, RPI_Y_D, RPI_T]);

    // Entretoises M2.5
    color("Silver", 0.9)
    for (ex=[RPI_X+3.5, RPI_X+RPI_W-3.5])
        for (ey=[RPI_PY+3.5, RPI_PY+RPI_Y_D-3.5])
            translate([ex, ey, WALL]) cylinder(d=2.5, h=RPI_Z - WALL);

    // WM8960 Audio HAT
    color("DarkGreen", 0.7)
    translate([WM_X, WM_PY, WM_Z]) cube([WM_W, WM_Y_D, WM_T]);

    // PoE HAT
    color("DarkOrange", 0.7)
    translate([POE_X, POE_PY, POE_Z]) cube([POE_W, POE_Y_D, POE_T]);

    // LiPo 704050
    color("SteelBlue", 0.75)
    translate([LIPO_X, LIPO_PY, LIPO_Z]) cube([LIPO_W, LIPO_Y_D, LIPO_T]);

    // BMS TP5100
    color("Chocolate", 0.8)
    translate([BMS_X, BMS_PY, BMS_Z]) cube([BMS_W, BMS_Y_D, BMS_T]);

    // Câble FFC RPi ↔ WM8960 (ruban doré vertical)
    color("Gold", 0.6)
    translate([RPI_X + RPI_W/2 - 2, RPI_PY + RPI_Y_D/2, RPI_Z + RPI_T])
        cube([4, 2, WM_Z - RPI_Z - RPI_T]);

    // Stream Deck Module 6t (encastré face dessus)
    color("Gainsboro", 0.85)
    translate([SDM_PX, SDM_PY, BOX_H - SDM_D]) cube([SDM_W, SDM_Y_DIM, SDM_D]);

    // Touches LCD 3×2 (surface Z+)
    for (col=[0:2]) for (row=[0:1])
        color("LightCyan", 0.95)
        translate([
            SDM_PX + SDM_OX + col*(SDM_KEY_W + SDM_KEY_G),
            SDM_PY + SDM_OY + row*(SDM_KEY_H + SDM_KEY_G),
            BOX_H - 0.5
        ])
        cube([SDM_KEY_W, SDM_KEY_H, 0.8]);

    // XLR5 NC5MPR (corps sous la boîte)
    color("Silver", 0.85)
    translate([XLR5_X - XLR5_HOLE/2, XLR5_Y - XLR5_HOLE/2, -14])
        cube([XLR5_HOLE, XLR5_HOLE, 14]);

    // RJ45
    color("Ivory", 0.85)
    translate([RJ45_X, RJ45_Y, -16]) cube([RJ45_W_C, RJ45_Y_C, 16]);
}

// ── Annotations ───────────────────────────────────────────────

module annotations() {
    color("White", 0.85) {
        // X = 90mm
        translate([0, -10, 0]) {
            cube([BOX_W, 0.3, 0.3]);
            translate([BOX_W/2-8, -5, 0]) linear_extrude(1) text("90mm", size=4);
        }
        // Y = 42mm
        translate([-12, 0, 0]) {
            cube([0.3, BOX_Y, 0.3]);
            translate([-2, BOX_Y/2, 0]) rotate([0,0,90])
                linear_extrude(1) text("42mm", size=4);
        }
        // Z = 155mm
        translate([BOX_W+3, 0, 0]) {
            cube([0.3, 0.3, BOX_H]);
            translate([2, 0, BOX_H/2]) rotate([0,0,0])
                linear_extrude(1) text("155mm", size=4);
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
// translate([0, BOX_Y + 20, 0]) couvercle();
// translate([0, 0, 0])          corps();
// translate([0, BOX_Y + 30, 0]) clip_ceinture();
