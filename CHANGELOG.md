# Changelog

Tous les changements notables sont documentés ici.  
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/).

---

## [1.1.12] — 2026-03-02

### Corrigé
- **APK socket.js** : navigateur externe (LAN) connecté à l'APK utilisait WS natif vers `127.0.0.1:3002` au lieu de Socket.io vers l'IP LAN — détection corrigée via `window.location.hostname`
- **WS natif** : limité strictement à la WebView interne (`127.0.0.1`), Socket.io utilisé pour tout accès distant

---

## [1.1.11] — 2026-03-02

### Corrigé
- **crypto.randomUUID** : fallback UUID v4 manuel pour contextes HTTP non-sécurisés (navigateur LAN)
- **Reconnexion desktop** : ré-élection leader après passage follower recharge la WebView sur `127.0.0.1`
- **Reconnexion APK** : basculement follower→leader recharge la WebView sur `http://127.0.0.1:3001`
- **Navigateur pur** : auto-redécouverte subnet sur disconnect (scan HTTP `/api/dewicom-discovery`)

### Amélioré
- **APK UI** : footer leader avec indicateur coloré, icône PTT image, `reconnectToServer` porté depuis desktop
- **CI** : APK de release renommé `DewiCom-vX.X.X.apk`

---

## [1.1.10] — 2026-03-02

### Corrigé
- **Toggle PTT/Toggle** : bug logique inversée corrigé (`checked=true` = PTT, un seul switch suffit maintenant)
- **Bouton PTT** : texte "Maintenir pour parler" supprimé, icône agrandie à 100px pour occuper tout le bouton
- **Barre raccourcis** : lignes "Mobile / Clavier / Kit filaire" supprimées de l'UI

---

## [1.1.9] — 2026-03-02

### Ajouté
- **Reconnexion transparente pour les clients navigateur LAN** : quand le leader change, le serveur local émet `server-redirect` aux clients connectés (délai 300ms avant shutdown) → `reconnectToServer(newUrl)` côté client sans rechargement de page

---

## [1.1.8] — 2026-03-02

### Amélioré
- **Footer leader enrichi** : affiche maintenant le type de serveur (Desktop local 🟢 / Android 🟠 / Serveur Node.js 🔵) + le nombre de personnes connectées en temps réel, mis à jour à chaque `channel-state`

---

## [1.1.7] — 2026-03-02

### Modifié
- **Bouton PTT** : l'emoji 🎙️ remplacé par l'icône de l'app (`icon.png`) — effet glow vert au press

---

## [1.1.6] — 2026-03-02

### Ajouté
- **Footer leader** : indicateur en bas du `mainScreen` affichant l'IP et le rôle du serveur actif (vert = local, bleu = leader distant), mis à jour automatiquement lors des basculements

---

## [1.1.5] — 2026-03-02

### Ajouté
- **Basculement leader transparent** : quand le leader change en cours de session, l'app se reconnecte automatiquement sans retourner au formulaire de départ
  - Desktop Electron : `server-changed` IPC → `reconnectToServer(url)` dans `socket.js`
  - APK Android : `evaluateJavascript` → `window.reconnectSocket(ip)` dans `socket.js`
  - Le nom, le canal et les paramètres director sont conservés après basculement

---

## [1.1.4] — 2026-03-02

### Corrigé
- Synchronisation des versions desktop/APK (1.1.3 avait des commits décalés)

---

## [1.1.3] — 2026-03-02

### Ajouté
- **QR Code fonctionnel sur toutes les plateformes** :
  - Desktop : endpoint `/qr` dans `local-server.js`, retourne `{ qr, url }` avec l'IP LAN réelle
  - APK Android : endpoint `/qr` dans `LocalWebServer.java` via ZXing Core → génère le QR en PNG base64
  - Dépendance `qrcode` (desktop) et `com.google.zxing:core:3.5.3` (Android) ajoutées

### Corrigé
- `getLocalIP()` dans `server/index.js` (serveur Node.js LAN) utilise désormais le même scoring que le desktop (exclut APIPA, déprioritise interfaces virtuelles)
- `versionCode` Android bumped à 3, `versionName` → `"1.1.3"`

---

## [1.1.2] — 2026-03-02

### Corrigé
- **Menu natif supprimé** : `Menu.setApplicationMenu(null)` — plus d'accès au menu Electron en production
- **DevTools bloqués en production** : `F12`, `Ctrl+Shift+I`, `Ctrl+Shift+J`, `Ctrl+R`, `F5` désactivés quand l'app est packagée (`app.isPackaged`), actifs en développement

---

## [1.1.1] — 2026-03-02

### Ajouté
- **Paramètres réseau** : fenêtre de sélection manuelle de l'interface réseau (`settings.html`), accessible depuis le formulaire de départ (bouton ⚙️ visible uniquement sous Electron)
- Règles pare-feu Windows créées automatiquement à l'installation (NSIS) : UDP 9998, UDP 9999, TCP 3001
- Script PowerShell `scripts/open-firewall-windows.ps1` pour ouvrir les ports manuellement sans réinstaller

### Corrigé
- **Windows multi-interfaces** : `getLocalIP()` exclut désormais les adresses APIPA (`169.254.x.x`) et déprioritise les interfaces virtuelles (VirtualBox, VMware, Hyper-V, Docker, TAP/TUN) — résolvait le problème de découverte réseau sur machines avec de nombreuses interfaces
- **Multicast UDP** : bind explicite sur `0.0.0.0` et `addMembership` avec l'IP locale pour cibler la bonne interface sur Windows
- **Linux** : scoring des interfaces virtuelles étendu à `virbr`, `veth`, `br-`, `lxc`, `lxd`

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
