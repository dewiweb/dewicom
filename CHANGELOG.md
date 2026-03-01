# Changelog

Tous les changements notables sont documentés ici.  
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/).

---

## [1.1.0] — 2026-03-01

### Ajouté
- Bouton **Reconnecter** dans la topbar (desktop + mobile) pour relancer la connexion sans recharger la page
- Relance complète de l'élection leader au clic : IPC `rediscover()` sur desktop, `requestRediscovery()` (JavascriptInterface Android) sur mobile
- Icônes DewiCom pour l'application Electron et l'APK Android
- Règle Windsurf workspace : modularisation obligatoire des fichiers > 1000 lignes

### Modifié
- **Modularisation JS** : le code inline des `index.html` (1500+ lignes) est extrait en 6 modules distincts (`config.js`, `audio.js`, `ptt.js`, `ui.js`, `socket.js`, `app.js`)
- **`shared/public/`** : source unique pour desktop et server (suppression des copies dupliquées dans `dewicom/public/` et `dewicom-desktop/public/`)
- Version lue dynamiquement depuis `package.json` dans `main.js` et `server/index.js` (plus de hardcode)
- `assets/` à la racine pour les fichiers sources d'icônes

### Corrigé
- Crash AppImage sur `EPIPE` (stdout/stderr sans terminal)
- Serveur local Java (Android) correctement arrêté avant relance de l'élection leader
- `versionCode` Android bumped à 2, `versionName` → `"1.1.0"`

---

## [1.0.0] — 2026-02-28

### Ajouté
- Application PTT LAN initiale : serveur Node.js + Socket.io, PWA, Electron desktop, APK Android
- Élection de leader via UDP multicast (algorithme Bully)
- Serveur WebSocket Java natif (NanoHTTPD + java-websocket) pour le mode APK local
- Mode Director : écoute et parle sur plusieurs canaux simultanément
- QR Code pour rejoindre depuis n'importe quel appareil du réseau
- CI/CD GitHub Actions : build AppImage (Linux), EXE (Windows), APK (Android)
- Sonnerie d'appel, mode PTT et Toggle, support kit filaire (MediaPlayPause, etc.)
- SSL auto-signé (mkcert) pour le contexte sécurisé WebRTC sur desktop
