# DewiCom

Application PTT (Push-To-Talk) sans serveur central — fonctionne en réseau local (LAN) avec élection automatique du leader.

## Architecture

```
dewicom/          → Serveur Node.js standalone (optionnel)
dewicom-desktop/  → Application Electron (Linux AppImage / Windows EXE)
dewicom-mobile/   → Application Android (APK)
```

### Principe de fonctionnement

- Chaque nœud (desktop ou APK) démarre son propre serveur Socket.io/WebSocket
- Un algorithme d'élection (Bully) désigne automatiquement un **leader** sur le LAN
- Le desktop a toujours la priorité sur les APK
- Si le leader disparaît, un autre nœud prend le relais en ~6 secondes (**failover automatique**)
- Les clients se reconnectent dynamiquement sans recharger la page

```
  Desktop (leader prioritaire)
       ↑↓ Socket.io :3001
  APK-A  ←→  APK-B
  (fallback leader si desktop absent)
```

### Découverte réseau

- Multicast UDP `224.0.0.251:9999` — annonce de présence (serveurs)
- Multicast UDP `224.0.0.251:9998` — élection de leader (Bully algorithm)

---

## Fonctionnalités

- **PTT multi-canal** : général, FOH Son, Plateau, Lumière, Régie
- **Mode Director** : écoute plusieurs canaux simultanément, parle sur plusieurs
- **Call ring** : bip d'appel vers tous les membres du canal (+ directors qui écoutent)
- **Failover automatique** : le leader réélu héberge le serveur, badge connexion mis à jour
- **Audio 16kHz** : micro WebAudio → PCM16 → Socket.io/WebSocket

---

## Installation

### Desktop (Electron)

```bash
cd dewicom-desktop
npm install
npm start          # développement
npm run build:linux   # → dist/DewiCom-*.AppImage
npm run build:win     # → dist/DewiCom-Setup-*.exe
```

### Serveur Node.js standalone (optionnel)

```bash
cd dewicom
npm install
node server/index.js
```

### Android APK

Ouvrir `dewicom-mobile/` dans Android Studio.

**Build debug :**
```
Build → Build Bundle(s) / APK(s) → Build APK(s)
```

**Build release :**
1. Copier `dewicom-mobile/keystore.example.properties` → `dewicom-mobile/keystore.properties`
2. Renseigner les chemins et mots de passe du keystore
3. `Build → Generate Signed Bundle / APK → APK → Release`

---

## Ports utilisés

| Port | Protocole | Usage |
|------|-----------|-------|
| 3001 | HTTP / Socket.io | Serveur principal (Node.js / NanoHTTPD) |
| 3002 | WebSocket natif | Serveur Java-WebSocket APK |
| 9998 | UDP Multicast | Élection de leader |
| 9999 | UDP Multicast | Découverte de serveurs |

---

## Structure des fichiers

```
dewicom-desktop/
  main.js              # Process principal Electron
  local-server.js      # Serveur Socket.io embarqué
  leader-election.js   # Algorithme Bully (Node.js)
  preload.js           # Bridge IPC Electron

dewicom-mobile/app/src/main/
  java/com/dewicom/
    MainActivity.java       # WebView + injection JS + élection
    LocalWebServer.java     # NanoHTTPD + Java-WebSocket
    LeaderElection.java     # Algorithme Bully (Java)
    NetworkDiscovery.java   # Scan LAN + multicast
  assets/public/
    index.html              # UI WebView (PTT, canaux, director mode)
```

---

## Sécurité

- Ne jamais committer `keystore.properties`, `*.keystore`, `*.jks`, `*.pem`
- Les certificats TLS locaux (`mkcert`) sont exclus du dépôt
- Voir `.gitignore` pour la liste complète des fichiers exclus
