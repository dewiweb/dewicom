# DewiCom

**Intercom WiFi local pour techniciens scène — zéro installation, zéro cloud, zéro abonnement.**

Application PTT (Push-To-Talk) multi-canal fonctionnant en réseau local (LAN) avec élection automatique du leader.

---

## Architecture

```
.
├── shared/               ← UI partagée (source unique desktop + server)
│   └── public/           ← index.html + modules JS (config, audio, ptt, ui, socket, app)
├── dewicom/              ← Serveur Node.js + HTTPS standalone (optionnel)
│   └── server/
├── dewicom-desktop/      ← Application Electron (Linux AppImage / Windows EXE)
├── dewicom-mobile/       ← Application Android (APK)
└── assets/               ← Sources d'icônes (SVG)
```

### Principe de fonctionnement

- Chaque nœud (desktop ou APK) démarre son propre serveur Socket.io/WebSocket local
- Un algorithme d'**élection Bully** via UDP multicast désigne automatiquement un **leader**
- Le desktop est toujours prioritaire sur les APK
- Si le leader disparaît → failover automatique en ~6 secondes, reconnexion transparente
- Bouton **Reconnecter** disponible pour forcer une relance complète depuis l'UI

```
  Desktop (leader prioritaire)
       ↑↓ Socket.io :3001
  APK-A  ←→  APK-B
  (devient leader si le desktop est absent)
```

### Découverte réseau

| Canal | Usage |
|-------|-------|
| UDP Multicast `224.0.0.251:9999` | Annonce de présence (serveurs) |
| UDP Multicast `224.0.0.251:9998` | Élection de leader (Bully) |

---

## Fonctionnalités

- **5 canaux** : Général, FOH Son, Plateau, Lumière, Régie
- **PTT multi-canal** : bouton, touche clavier (`Espace`, `Z`, `X`, `Enter`), kit filaire (MediaPlayPause…)
- **Mode Toggle** : cliquer pour parler / re-cliquer pour arrêter
- **Mode Director** : écoute et parle sur plusieurs canaux simultanément
- **Call ring** : sonnerie d'appel sur le canal actif
- **QR Code** : rejoindre depuis n'importe quel appareil du réseau
- **Failover automatique + bouton Reconnecter**
- **Audio WebAudio 16kHz** : PCM16 → Socket.io / WebSocket natif
- **PWA** : installable sur mobile depuis le navigateur

---

## Installation

### Desktop Electron (développement)

```bash
cd dewicom-desktop
npm install
npm start        # lance Electron en mode dev (utilise shared/public/)
```

### Desktop Electron (build)

```bash
npm run build:linux   # → dist/DewiCom-*.AppImage
npm run build:win     # → dist/DewiCom-Setup-*.exe
```

> Le build embarque automatiquement `shared/public/` via `extraFiles`.

### Serveur Node.js standalone (optionnel)

Utile pour héberger l'intercom depuis une machine sans Electron (ex. Raspberry Pi) :

```bash
cd dewicom
npm install
# Générer les certificats SSL locaux (une seule fois) :
mkcert localhost [IP-locale]
mv localhost+2.pem localhost+2-key.pem .
# Démarrer :
node server/index.js
```

Accès : `https://[IP-locale]:3001` — QR code : `https://[IP-locale]:3001/qr`

### Android APK

Ouvrir `dewicom-mobile/` dans Android Studio.

**Build debug :**
```
Build → Build Bundle(s) / APK(s) → Build APK(s)
```

**Build release (signé) :**
```bash
cp dewicom-mobile/keystore.example.properties dewicom-mobile/keystore.properties
# Renseigner KEYSTORE_FILE, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD
cd dewicom-mobile && ./gradlew assembleRelease
```

---

## CI/CD

Le workflow `.github/workflows/release.yml` se déclenche sur tout tag `v*` et produit :
- `DewiCom-*.AppImage` (Linux)
- `DewiCom-Setup-*.exe` (Windows)
- `app-release.apk` (Android)

---

## Ports utilisés

| Port | Protocole | Usage |
|------|-----------|-------|
| 3001 | HTTP(S) / Socket.io | Serveur principal |
| 3002 | WebSocket natif | Serveur Java-WebSocket (APK) |
| 9998 | UDP Multicast | Élection de leader |
| 9999 | UDP Multicast | Découverte de serveurs |

---

## Structure des fichiers clés

```
shared/public/
  index.html        # UI principale (HTML + CSS)
  config.js         # Constantes et état global
  audio.js          # Capture micro, lecture PCM, sonnerie
  ptt.js            # Bouton PTT, clavier, kit filaire
  ui.js             # Rendu canaux, activity log, panels
  socket.js         # Connexion socket, startSession, reconnexion
  app.js            # Init, localStorage, event listeners

dewicom-desktop/
  main.js           # Process principal Electron
  local-server.js   # Serveur Socket.io embarqué
  leader-election.js# Algorithme Bully (Node.js)
  preload.js        # Bridge IPC → window.DewiComDesktop

dewicom-mobile/app/src/main/
  java/com/dewicom/
    MainActivity.java     # WebView + JavascriptInterface + élection
    LocalWebServer.java   # NanoHTTPD + Java-WebSocket (port 3002)
    LeaderElection.java   # Algorithme Bully (Java/UDP)
    NetworkDiscovery.java # Scan LAN + multicast

dewicom/server/
  index.js          # Serveur Express + Socket.io + HTTPS + multicast
```

---

## Sécurité

- Ne jamais committer `keystore.properties`, `*.keystore`, `*.jks`, `*.pem`, `*-key.pem`
- Les certificats TLS locaux (`mkcert`) sont exclus du dépôt via `.gitignore`
- Les secrets CI (keystore Android) sont gérés via GitHub Secrets
