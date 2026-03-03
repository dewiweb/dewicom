# dewicom-server

Serveur intercom DewiCom standalone — Niveau 1 de déploiement (le plus robuste).

Tourne en Node.js pur, packagé en Docker, déployable sur :
- NUC / PC dédié (avec Docker)
- Raspberry Pi (avec Docker ou `node server.js`)
- VM / VPS cloud

## Démarrage rapide

### Docker Compose (recommandé)

```bash
cd dewicom-server
docker compose up -d
```

### Node.js direct (RPi sans Docker)

```bash
cd dewicom-server
npm install
node server.js
```

### Variables d'environnement

| Variable      | Défaut       | Description                                      |
|---------------|--------------|--------------------------------------------------|
| `PORT`        | `3001`       | Port HTTP + WebSocket                            |
| `BIND_IP`     | `0.0.0.0`   | IP d'écoute                                      |
| `SERVER_MODE` | `dedicated`  | Mode annoncé : `docker` ou `dedicated`           |
| `SERVER_NAME` | hostname     | Nom affiché dans les clients                     |

## Architecture

```
dewicom-server (ce service)
├── HTTP  :3001  → UI web + API discovery
├── WS    :3001  → Socket.io (audio PTT, canaux)
└── UDP   :9999  → Annonces multicast (découverte LAN)
```

Le serveur annonce sa présence en multicast UDP toutes les 2s.
Les clients (APK, Desktop, Browser) le détectent automatiquement.

## Niveaux de déploiement

| Niveau | Infrastructure        | Robustesse | Note                              |
|--------|-----------------------|------------|-----------------------------------|
| 1      | Docker / serveur dédié | ★★★★★      | Ce service — recommandé prod      |
| 2      | Desktop en mode serveur| ★★★★☆      | Desktop lancé avec `--server`     |
| 3      | APK only (Bully)       | ★★★☆☆      | Fallback nomade sans infrastructure|

## Healthcheck

```bash
curl http://localhost:3001/api/dewicom-discovery
curl http://localhost:3001/api/status
```
