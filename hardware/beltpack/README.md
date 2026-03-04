# DewiCom Beltpack BP-1

Boîtier beltpack pour intercom WiFi DewiCom. Concept de preuve — modèle OpenSCAD v5.

## Composants intégrés

| Composant | Référence | Rôle |
|---|---|---|
| SBC | Raspberry Pi Zero 2W | Calcul / WiFi / Ethernet |
| HMI | Elgato Stream Deck Module 6 touches | 6 boutons LCD couleur = 6 canaux PTT |
| Audio | Waveshare WM8960 Audio HAT | Capture micro XLR + écoute casque (I2S) |
| Réseau | Waveshare PoE HAT mini | Alimentation PoE 802.3af + Ethernet |
| Batterie | LiPo 704050 2000mAh + BMS TP5100 | Autonomie ~8h, recharge PoE ou USB-C |
| Connecteur audio | Neutrik NC5MPR (XLR5 coudé) | Micro-casque intercom standard |
| Réseau | RJ45 + PoE | Ethernet filaire + alimentation |
| Charge | USB-C | Alimentation / recharge de secours |

## Dimensions boîtier (v5)

```
90 × 62 × 80 mm
```

| Axe | Dimension | Contrainte |
|-----|-----------|-----------|
| X (largeur) | 90 mm | Stream Deck 84mm + 2×WALL |
| Y (épaisseur) | 62 mm | Stream Deck 55.5mm + 2×WALL — contrainte dure |
| Z (hauteur) | 80 mm | Budget Z calculé avec HATs superposés via FFC |

### Historique des dimensions

| Version | Dimensions | Raison |
|---------|-----------|--------|
| v1 | 130×72×36mm | Initial — trop petit |
| v2 | 155×90×42mm | Audit volumétrique |
| v3-v4 | 90×62×155mm | Réorientation portrait |
| **v5** | **90×62×80mm** | HATs superposés via FFC (−48% hauteur) |

### Budget Z (coupe transversale)

```
Z+  [Stream Deck Module 6t]   21mm  ← dessus
     gap                        5mm
     LiPo 704050                5mm
     gap                        3mm
     PoE HAT Waveshare         11mm  ┐
     FFC GPIO ribbon            2mm  │ stack
     WM8960 Audio HAT           3mm  │ superposé
     FFC I2S                    2mm  │
     RPi Zero 2W                5mm  ┘
     entretoises + clearance   10mm
Z-  [XLR5 / RJ45 / USB-C]          ← dessous
```
Total : ~72mm → BOX_H = 80mm (8mm de marge)

### Pourquoi on ne peut pas réduire davantage

L'inclinaison du module Stream Deck **n'aide pas** — aucun axe de rotation ne réduit la boîte englobante :
- Rotation XY (plan horizontal) : diagonale = √(84²+55.5²) = 100.7mm → pire
- Rotation YZ (tilt avant/arrière) : minimum Y atteint à ~69° mais Z explose à 49mm
- Rotation XZ (tilt latéral) : boîte englobante augmente dans les deux sens

Le module 55.5×21mm a son **minimum de projection sur Y à 0°** — c'est la position optimale.

### Pistes de réduction futures (si nécessaire)

| Levier | Gain | Impact |
|--------|------|--------|
| Module en saillie de 5mm au-dessus Z+ | −5mm Z | Design différent |
| Stream Deck Mini 4 touches (~65×45mm) | −17mm Y | Perd 2 canaux PTT |
| PCB custom (RPi CM4 + audio + PoE) | −20mm Z | Coût/délai élevé |

## Orientation et faces

```
Dessus  Z+ : Stream Deck Module 6 touches (touches accessibles)
Dessous Z- : XLR5 coudé + RJ45 PoE + USB-C
Dos     Y+ : couvercle vissé + clip ceinture
Avant   Y- : façade lisse
```

## Interconnexions internes

| De | Vers | Câble |
|----|------|-------|
| RPi GPIO | PoE HAT | FFC ribbon 40 broches, ~20mm |
| RPi I2S/I2C | WM8960 | FFC 6 broches, ~15mm |
| RPi USB-C | Stream Deck | USB-C coudé interne, ~30mm |
| LiPo | BMS TP5100 | 2 fils 20AWG |
| BMS | RPi / PoE HAT | Fil d'alimentation 5V |

## Fichiers CAO

- `beltpack.scad` — modèle OpenSCAD complet
- STP officiel Stream Deck Module 6t : https://res.cloudinary.com/elgato-pwa/raw/upload/v1747898289/2025/Stream%20Deck%20Module/CAD%20Files/SD-Module6_construction_shape.stp

## Utilisation OpenSCAD

```bash
openscad beltpack.scad          # ouvrir
# F5 = prévisualisation rapide
# F6 = rendu complet couleur
openscad -o beltpack.stl beltpack.scad  # export STL
```

### Paramètres de visualisation

Modifier en tête de la section assemblage dans `beltpack.scad` :

| Paramètre | Valeur | Effet |
|-----------|--------|-------|
| `EXPLODE` | `0` | Assemblage normal |
| `EXPLODE` | `100` | Vue éclatée |
| `XRAY` | `0` | Corps opaque |
| `XRAY` | `1` | Corps transparent (voir internals) |

## Brochage XLR5 (standard A-type intercom)

```
Pin 1 — GND
Pin 2 — Audio send (micro → réseau)    → WM8960 MIC IN
Pin 3 — Audio return (réseau → oreille) ← WM8960 HP OUT
Pin 4 — Audio return L                  ← WM8960 HP OUT L
Pin 5 — Audio return R                  ← WM8960 HP OUT R
```

## Software associé

Module Node.js `dewicom-beltpack` (à venir dans `/hardware/beltpack/software/`) :
- Client Socket.IO → serveur DewiCom local
- Contrôle Stream Deck via HID direct (sans app Elgato)
- Affichage LCD : nom canal + nb utilisateurs + indicateur ON AIR
