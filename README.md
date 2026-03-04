# DewiCom

**Intercom WiFi local pour techniciens scène — zéro installation, zéro cloud, zéro abonnement.**

Application PTT (Push-To-Talk) multi-canal fonctionnant en réseau local (LAN) avec hiérarchie de déploiement à 3 niveaux et failover automatique. Toutes les communications serveur/client utilisent **HTTPS/WSS** (certificat auto-signé généré au démarrage) pour garantir l'accès au microphone sur tous les appareils.

[![Release](https://img.shields.io/github/v/release/dewiweb/dewicom)](https://github.com/dewiweb/dewicom/releases/latest)

---

## Architecture

```
.
├── shared/               ← UI partagée (source unique pour tous les composants)
│   └── public/           ← index.html + modules JS (config, audio, ptt, ui, socket, app)
│                           monitor.html + monitor.css + monitor.js
├── dewicom-server/       ← Serveur Node.js standalone (Docker / dédié — Niveau 1)
├── dewicom-desktop/      ← Application Electron (Linux AppImage / Windows EXE)
├── dewicom-mobile/       ← Application Android (APK)
└── assets/               ← Sources d'icônes (SVG)
```

### Hiérarchie de déploiement (3 niveaux)

| Niveau | Infrastructure | Robustesse | Déploiement |
|--------|---------------|------------|-------------|
| 1 | Docker / serveur dédié | ★★★★★ | `docker compose up -d` |
| 2 | Desktop `--server` | ★★★★☆ | `DewiCom --server [--headless]` |
| 3 | Desktop / APK (Bully) | ★★★☆☆ | Lancement normal — élection automatique |

Les niveaux supérieurs ont toujours la priorité. Si un serveur Docker est présent sur le LAN, tous les clients s'y connectent automatiquement, sans élection.

### Principe de fonctionnement

- Chaque payload multicast contient un champ `mode` (`docker` / `dedicated` / `desktop-local` / `apk`) et `protocol` (`https`)
- Les nœuds de niveau supérieur sont détectés immédiatement → bypass de l'élection Bully
- Si le leader disparaît → failover automatique en ~4-6 s, reconnexion transparente (sans rechargement de page)
- Chaîne de dégradation gracieuse : `Docker → Desktop dédié → Desktop normal → APK`

```
  [Docker / serveur dédié]  ← niveau 1, priorité absolue
           ↕ HTTPS + WSS :3001
  [Desktop --server]         ← niveau 2, prend le relais si niveau 1 absent
           ↕
  [Desktop / APK — Bully]    ← niveau 3, élection entre pairs
```

### Découverte réseau

| Canal | Usage |
|-------|-------|
| UDP Multicast `224.0.0.251:9999` | Annonce de présence (serveurs) |
| UDP Multicast `224.0.0.251:9998` | Élection de leader (Bully) |

---

## Fonctionnalités

- **5 canaux** : Général, FOH Son, Plateau, Lumière, Régie
- **PTT** (maintenir) ou **Toggle** (cliquer) — switchable depuis l'UI
- **Mode Director** : écoute et parle sur plusieurs canaux simultanément
- **Reconnexion transparente** : basculement leader sans retour au formulaire (Electron, APK, navigateur LAN)
- **Auto-rejoin** : `name` + `channel` mémorisés en `localStorage`, plus de formulaire après la première connexion
- **Call ring** : sonnerie d'appel sur le canal actif
- **QR Code** : rejoindre depuis n'importe quel appareil du réseau en scannant le QR (`https://`)
- **Footer leader** : type de serveur actif (Desktop / Android / Node.js) + nombre de connectés en temps réel
- **Page monitoring** `/monitor` : canaux temps réel, stats audio (chunks/2s, KB/2s), console logs (INFO/WARN/ERROR/AUDIO), journal horodaté — disponible sur Docker **et** Desktop server/headless
- **Inhibition veille** en mode `--server` (`powerSaveBlocker`)
- **Audio WebAudio 16kHz** : PCM16 → Socket.io / WSS
- **HTTPS partout** : certificat TLS auto-signé (`selfsigned`) généré au démarrage — `getUserMedia` fonctionne sur tous les clients LAN

---

## HTTPS et certificats

Depuis la v1.4.0, tous les serveurs DewiCom démarrent en **HTTPS + WSS** avec un certificat auto-signé généré à chaque démarrage (valide 10 ans, `selfsigned` npm).

| Client | Comportement |
|--------|-------------|
| **Navigateur** | Avertissement "connexion non sécurisée" au premier accès — accepter manuellement une fois |
| **Electron** (Desktop) | Certificat accepté automatiquement (`setCertificateVerifyProc`) |
| **APK Android** | Certificat accepté automatiquement (`onReceivedSslError → handler.proceed()`) |

> Le certificat est auto-signé et n'est **pas** dans une CA connue — c'est intentionnel pour un usage LAN privé. Il garantit uniquement le *secure context* requis par `getUserMedia`.

---

## Installation

### Niveau 1 — Serveur Docker (recommandé pour une régie fixe)

```bash
git clone https://github.com/dewiweb/dewicom
cd dewicom/dewicom-server
docker compose up -d
```

Accès : `https://<ip-serveur>:3001` — Monitoring : `https://<ip-serveur>:3001/monitor`

> L'image Docker est aussi publiée automatiquement sur `ghcr.io/dewiweb/dewicom/dewicom-server:latest` à chaque release.

### Niveau 2 — Desktop en mode serveur dédié

```bash
DewiCom --server            # serveur avec fenêtre
DewiCom --server --headless # daemon sans fenêtre
```

Disponible depuis les raccourcis **Menu Démarrer** (Windows) et **Applications** (Linux .deb) après installation.  
Monitoring accessible sur `https://<ip-machine>:3001/monitor`.

### Niveau 3 — Desktop Electron (lancement normal)

**Développement :**
```bash
cd dewicom-desktop
npm install
npm start
```

**Build :**
```bash
npm run build:linux   # → dist/DewiCom-*.AppImage
npm run build:win     # → dist/DewiCom-Setup-*.exe
```

> Le build embarque automatiquement `shared/public/` via `extraFiles`. L'installeur Windows configure les règles pare-feu UDP/TCP automatiquement via NSIS.

### Android APK

**Depuis une release GitHub :** télécharger `DewiCom-v*.apk` directement.

**Build depuis les sources :**
```bash
# Build debug (Android Studio ou ligne de commande)
cd dewicom-mobile && ./gradlew assembleDebug

# Build release signé
cp keystore.example.properties keystore.properties
# Renseigner KEYSTORE_FILE, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD
./gradlew assembleRelease
```

---

## Page de monitoring

Disponible sur **tous les serveurs** (Docker, Desktop `--server`, Desktop `--server --headless`) à l'adresse `https://<ip>:3001/monitor`.

| Panneau | Contenu |
|---------|---------|
| **Canaux** | Utilisateurs connectés par canal, indicateur PTT animé, glow coloré |
| **Stats** | Connectés, canaux actifs, en parole, PTT total, chunks audio/2s, événements |
| **Console** | Logs serveur temps réel (INFO / WARN / ERROR / AUDIO), filtres, auto-scroll |
| **Journal** | Événements horodatés (connexions, départs, PTT) |

---

## CI/CD

Le workflow `.github/workflows/release.yml` se déclenche sur tout tag `v*` et produit :

| Artefact | Format | Notes |
|---|---|---|
| Linux | `DewiCom-vX.X.X.AppImage` | `chmod +x` puis lancer |
| Windows | `DewiCom-Setup-X.X.X.exe` | Installeur NSIS + règles pare-feu |
| Android | `DewiCom-vX.X.X.apk` | Activer "sources inconnues" |
| Docker | `ghcr.io/dewiweb/dewicom/dewicom-server:X.X.X` | Image publiée sur GHCR |

---

## Ports utilisés

| Port | Protocole | Usage |
|------|-----------|-------|
| 3001 | **HTTPS** / WSS / Socket.io | Serveur principal (Desktop, Docker, APK) |
| 3002 | WebSocket natif | Serveur Java-WebSocket (APK uniquement) |
| 9998 | UDP Multicast | Élection de leader (Bully) |
| 9999 | UDP Multicast | Annonces de présence |

> **Windows** : les règles pare-feu pour UDP 9998/9999 et TCP 3001 sont créées automatiquement par l'installeur NSIS.

---

## Structure des fichiers clés

```
shared/public/
  index.html        # UI principale (HTML + CSS)
  config.js         # Constantes et état global
  audio.js          # Capture micro, lecture PCM, sonnerie
  ptt.js            # Bouton PTT, clavier, kit filaire
  ui.js             # Rendu canaux, activity log, panels
  socket.js         # Connexion socket, startSession, reconnexion transparente
  app.js            # Init, localStorage, auto-rejoin
  monitor.html      # Page monitoring (template HTML)
  monitor.css       # Styles monitoring
  monitor.js        # Logique monitoring (canaux, logs, stats audio)

dewicom-server/
  server.js         # Serveur Express + HTTPS + Socket.io standalone (Niveau 1)
  Dockerfile        # Image Docker (context = racine du repo)
  docker-compose.yml

dewicom-desktop/
  main.js           # Process principal Electron + watchdog + gestion veille
  local-server.js   # Serveur HTTPS + Socket.io embarqué (Niveau 2/3)
  leader-election.js# Algorithme Bully (Node.js)
  preload.js        # Bridge IPC → window.DewiComDesktop
  build/
    installer.nsh   # Script NSIS : règles pare-feu Windows + raccourcis Menu Démarrer
    linux/          # Scripts postinst/prerm (raccourcis .desktop)

dewicom-mobile/app/src/main/java/com/dewicom/
  MainActivity.java     # WebView + élection + reconnexion transparente
  SSLWebViewClient.java # Acceptation certs auto-signés (onReceivedSslError)
  LocalWebServer.java   # NanoHTTPD + Java-WebSocket (port 3002)
  LeaderElection.java   # Algorithme Bully (Java/UDP)
  NetworkDiscovery.java # Scan LAN + multicast + hiérarchie modes
```

---

## Sécurité

- Ne jamais committer `keystore.properties`, `*.keystore`, `*.jks`, `*.pem`, `*-key.pem`
- Les secrets CI (keystore Android) sont gérés via GitHub Secrets
- Application conçue pour LAN privé — pas d'authentification réseau (confiance implicite au réseau local)
- Les certificats TLS sont auto-signés et régénérés à chaque démarrage du serveur
