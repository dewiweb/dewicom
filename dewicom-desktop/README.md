# DewiCom Desktop

Application PTT cross-platform (Linux, macOS, Windows) basée sur Electron.

## Démarrage rapide

```bash
cd dewicom-desktop
npm install
npm start
```

## Découverte automatique du serveur

L'app utilise **deux mécanismes** pour trouver un serveur DewiCom :

1. **Multicast UDP** (instantané) — écoute le groupe `224.0.0.251:9999`
   - Le serveur Node.js (`dewicom/server/index.js`) s'annonce toutes les 2s
   - L'APK Android avec serveur local s'annonce aussi
   - Temps de découverte : **< 2s**

2. **Scan parallèle** (fallback) — si aucune annonce reçue en 3s
   - Scan du subnet en batches de 50 threads, timeout 400ms/IP
   - IPs proches du PC testées en priorité
   - Temps de découverte : **~2-3s**

## Build

```bash
npm run build:linux   # AppImage + .deb
npm run build:mac     # .dmg
npm run build:win     # .exe (NSIS)
npm run build:all     # Toutes les plateformes
```

## Architecture

```
main.js          — Process principal Electron
  ├── listenMulticast()   — Écoute UDP multicast
  ├── scanSubnet()        — Fallback scan HTTP parallèle
  └── discoverServer()    — Orchestration découverte

preload.js       — Pont sécurisé main ↔ renderer
loading.html     — Écran de chargement pendant la découverte
no-server.html   — Écran d'erreur si aucun serveur trouvé
```

## Protocole multicast

Le paquet UDP envoyé par le serveur :
```json
{
  "service": "DewiCom",
  "version": "1.0.0",
  "ip": "192.168.x.y",
  "port": 3001,
  "protocol": "http"
}
```

Groupe multicast : `224.0.0.251`, Port : `9999`
