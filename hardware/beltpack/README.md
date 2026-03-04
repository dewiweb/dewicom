# DewiCom Beltpack BP-1

Boîtier beltpack pour intercom WiFi DewiCom.

## Composants intégrés

| Composant | Référence | Rôle |
|---|---|---|
| SBC | Raspberry Pi Zero 2W | Calcul / WiFi / Ethernet |
| HMI | Elgato Stream Deck Module 6 touches | 6 boutons LCD couleur = 6 canaux PTT |
| Audio | Waveshare WM8960 Audio HAT | Capture micro XLR + écoute casque (I2S) |
| Réseau | Waveshare PoE HAT mini | Alimentation PoE 802.3af + Ethernet |
| Batterie | LiPo 704050 2000mAh + BMS TP5100 | Autonomie ~8h, recharge PoE ou USB-C |
| Connecteur audio | Neutrik NC5FD-L (XLR5 femelle) | Micro-casque intercom standard |
| Réseau | RJ45 + PoE | Ethernet filaire + alimentation |
| Charge | USB-C | Alimentation / recharge de secours |

## Dimensions boîtier

```
130 × 72 × 36 mm  (avec clip ceinture : +6mm côté droit)
```

## Fichiers CAO

- `beltpack.scad` — modèle OpenSCAD complet (boîtier + couvercle + clip + intégrations)
- STP officiel Stream Deck Module 6t : https://res.cloudinary.com/elgato-pwa/raw/upload/v1747898289/2025/Stream%20Deck%20Module/CAD%20Files/SD-Module6_construction_shape.stp

## Utilisation OpenSCAD

```bash
# Ouvrir et visualiser
openscad beltpack.scad

# Exporter en STL pour impression 3D
openscad -o beltpack.stl beltpack.scad

# Exporter en STEP (nécessite openscad 2024+)
openscad -o beltpack.step beltpack.scad
```

## Import dans Blender

1. Exporter en `.stl` depuis OpenSCAD
2. Blender → File → Import → STL
3. Pour le fichier STP Elgato : utiliser FreeCAD pour convertir en `.obj` puis importer dans Blender

## Import dans Fusion 360

1. Télécharger le STP Elgato (lien ci-dessus)
2. Fusion 360 → Insert → Import → STEP
3. Importer `beltpack.stl` comme référence dimensionnelle

## Brochage XLR5 (standard A-type intercom)

```
Pin 1 — GND
Pin 2 — Audio send (micro vers réseau)   → WM8960 MIC IN
Pin 3 — Audio return (réseau → oreille)  ← WM8960 HP OUT
Pin 4 — Audio return L (ou retour 2)     ← WM8960 HP OUT L
Pin 5 — Audio return R                   ← WM8960 HP OUT R
```

## Software associé

Module Node.js `dewicom-beltpack` (à venir dans `/hardware/beltpack/software/`) :
- Client Socket.IO → serveur DewiCom local
- Contrôle Stream Deck via HID direct (sans app Elgato)
- Affichage LCD : nom canal + nb utilisateurs + indicateur ON AIR
