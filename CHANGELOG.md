# Changelog

Tous les changements notables sont documentés ici.  
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/).

---

## [1.4.2] — 2026-03-04

### Corrigé
- **HTTPS — `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` (cause racine)** : `selfsigned` v5 retourne une **Promise** — le `generate()` synchrone retournait un objet vide, le serveur HTTPS démarrait avec `key: undefined` et `cert: undefined`. Fix : `await selfsigned.generate()` dans une `async` IIFE (`server.js`) et dans `async function start()` (`local-server.js`) — `dewicom-server/server.js`, `dewicom-desktop/local-server.js`

---

## [1.4.1] — 2026-03-04

### Corrigé
- **HTTPS — `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` dans les navigateurs** : le certificat auto-signé était généré avec `keySize: 2048` (option invalide en `selfsigned` v5, ignorée → clé trop courte) et sans `subjectAltName` (requis par tous les navigateurs modernes). Fix : retrait de `keySize`, ajout des extensions `subjectAltName`, `basicConstraints`, `keyUsage`, `extKeyUsage` — `dewicom-server/server.js`, `dewicom-desktop/local-server.js`

---

## [1.4.0] — 2026-03-04

### Ajouté
- **HTTPS auto-signé — serveur Docker** : `server.js` génère un certificat TLS self-signed au démarrage (`selfsigned` npm, valide 10 ans). Le serveur écoute désormais en HTTPS+WSS. Les annonces multicast indiquent `protocol: "https"`. QR code pointe vers `https://` — `dewicom-server/server.js`
- **HTTPS conditionnel — serveur Desktop** : `local-server.js` démarre en HTTPS pour les modes `dedicated`/`desktop-server` (clients LAN ont besoin d'un secure context pour `getUserMedia`). Mode `desktop-local` reste HTTP (localhost = secure context natif) — `dewicom-desktop/local-server.js`
- **Logging centralisé broadcast** : `console.log/warn/error` interceptés dans `server.js` et `local-server.js` — chaque message est bufferisé (300-500 entrées) et diffusé en temps réel aux clients abonnés via `server-log` Socket.io. Route `GET /api/logs` expose l'historique — `server.js`, `local-server.js`
- **Stats audio temps réel** : comptage des chunks et octets audio par intervalle de 2s, diffusés aux clients monitor via `audio-stats` Socket.io — `server.js`, `local-server.js`
- **Monitor refonte modulaire** : `monitor.html` restructuré en 3 fichiers (`monitor.html`, `monitor.css`, `monitor.js`). Ajout d'un onglet Console avec logs colorés par niveau (INFO/WARN/ERROR/AUDIO), filtres, auto-scroll, compteur d'erreurs. Stats audio dans la barre de métriques — `shared/public/monitor.{html,css,js}`
- **APK — acceptation certs HTTPS** : `onReceivedSslError` + `handler.proceed()` dans `SSLWebViewClient.java` et `buildWebViewClient()`. `normalizeUrl()` préfixe désormais `https://` par défaut — `dewicom-mobile/…/SSLWebViewClient.java`, `MainActivity.java`

### Modifié
- **Desktop `main.js`** : `pingServer()` essaie HTTPS d'abord (cert ignoré via `rejectUnauthorized:false`) puis fallback HTTP. `setupMediaPermissions()` simplifié — plus de relaunch app pour changer d'origine HTTP. Suppression du flag `unsafely-treat-insecure-origin-as-secure` — `dewicom-desktop/main.js`
- **Dockerfile + docker-compose** : healthcheck mis à jour en `https://` avec `--no-check-certificate`, `start_period` porté à 8s — `dewicom-server/Dockerfile`, `docker-compose.yml`

---

## [1.3.4] — 2026-03-03

### Corrigé
- **APK — pas d'audio vers/depuis serveur Docker** : `navigator.mediaDevices` est masqué par la WebView Android sur les origines HTTP non-localhost. Fix : injection JS de `isSecureContext=true` + polyfill `navigator.mediaDevices` via `evaluateJavascript` dans `onPageStarted`/`onPageFinished` — `MainActivity.java`
- **Toutes instances — `isSecureContext` bloquait `getUserMedia` sur HTTP** : la vérification `!window.isSecureContext` dans `startSession()` forçait le mode écoute seule avant même d'essayer `getUserMedia`. Fix : condition supprimée, l'échec réel est géré par le `catch` existant — `shared/public/socket.js`

---

## [1.3.3] — 2026-03-03

### Corrigé
- **Desktop — `superiorServerListener` absent au démarrage via `listenMulticast`** : quand un serveur dédié était trouvé au démarrage par multicast (bypass élection), le listener permanent n'était jamais lancé → le Docker arrivant après était invisible. Fix : `startSuperiorServerListener(prePriority - 1)` lancé dans tous les chemins — `main.js`
- **Desktop `--server`/`--headless` — jamais de bascule vers Docker** : le mode serveur dédié ne lançait pas le `superiorServerListener`, ignorant complètement les annonces Docker. Fix : listener lancé après `startDedicatedServer()` avec seuil `minPriority=2` (cède uniquement aux docker) — `main.js`
- **Desktop — conflit socket multicast port 9999** : `listenMulticast()` et `startSuperiorServerListener()` créaient chacun un socket UDP sur le même port. Sous Windows les paquets multicast étaient perdus. Fix : socket persistant unique partagé (`mcastSocket` + `mcastListeners`) — `main.js`
- **Android — liste SSID vide dans le dialogue de sélection WiFi** : `getScanResults()` et `getConnectionInfo()` nécessitent `ACCESS_FINE_LOCATION` au runtime (Android 8.1+). Fix : demande groupée `RECORD_AUDIO` + `ACCESS_FINE_LOCATION` avant l'init WiFi — `MainActivity.java`

### Ajouté
- **Desktop — socket multicast persistant partagé** : un seul socket UDP bind sur 9999, tous les listeners (découverte + superior) s'y abonnent via callbacks. Élimine les conflits de port et la perte de paquets sous Windows — `main.js`
- **Android — sélection WiFi dédié au démarrage** : dialogue de sélection du SSID DewiCom mémorisé en `SharedPreferences`. L'app se déconnecte (écran d'attente) si le WiFi change, et se reconnecte automatiquement au retour sur le réseau choisi — `MainActivity.java`, `AndroidManifest.xml`
- **Monitoring — vue tableau de bord opérateur** : refonte complète de `monitor.html` — layout grand écran avec canaux + sidebar journal, barres de niveau audio animées (PTT), glow coloré par canal, stats avec animation pulse, bouton "Effacer journal" — `shared/public/monitor.html`

---

## [1.3.2] — 2026-03-03

### Corrigé
- **`resumeTimers()` — double démarrage serveur au réveil de veille** : appelait `_becomeLeader()` qui retriggerait le callback `onBecomeLeader` → tentative de démarrer un second serveur sur port 3001 déjà occupé. Fix : appel direct à `_startHeartbeat()` — `leader-election.js`
- **`startAnnouncing()` — champ `mode` absent du payload multicast** : les annonces émises par le Desktop en mode leader Bully ne contenaient pas le champ `mode`, cassant la hiérarchie de priorité de découverte pour les autres nœuds. Fix : ajout de `mode` (défaut `"desktop-local"`) + intervalle aligné à 1s — `main.js`
- **`NetworkDiscovery.getServerMode()` Android — modes v1.3 non reconnus** : `docker`, `dedicated`, `desktop-local` étaient tous mappés sur `"nodejs"`, perdant l'information de hiérarchie lors du fallback HTTP. Fix : détection par itération des 4 modes — `NetworkDiscovery.java`
- **`powerSaveBlocker.stop()` non appelé à la fermeture** : le wake lock restait actif après fermeture de l'app sur certains OS. Fix : appel dans `window-all-closed` et `quit` — `main.js`
- **`setupMediaPermissions()` écrasait `forcedInterface`** : réécriture complète de `server-config.json` à chaque connexion → l'interface réseau forcée par l'utilisateur était perdue. Fix : lecture + merge avant écriture — `main.js`
- **Watchdog — timeout de détection trop long** : `checkServer()` pouvait mettre 1800ms (HTTP + HTTPS) par tentative, portant le failover réel à ~11s au lieu de 6s. Fix : nouvelle fonction `pingServer()` HTTP-only 500ms dédiée au watchdog — `main.js`
- **CI NSIS — warning 6050 traité comme erreur** : backslash de continuation de ligne dans `CreateShortCut` générait un warning bloquant. Fix : commandes sur une seule ligne — `build/installer.nsh`
- **CI Docker — build context trop restreint** : `COPY ../shared/public` hors du context `dewicom-server/`. Fix : context remonté à la racine du repo, chemins Dockerfile adaptés — `Dockerfile`, `release.yml`

### Ajouté
- **Raccourcis menu applications** pour les modes serveur — plus besoin de passer par un terminal :
  - **Windows** (NSIS) : `DewiCom Server` et `DewiCom Server (headless)` dans le Menu Démarrer — `build/installer.nsh`
  - **Linux** (deb) : entrées `.desktop` installées dans `/usr/share/applications/` via scripts `postinst`/`prerm` — `build/linux/`

---

## [1.3] — 2026-03-03

Refonte complète de l'architecture réseau : passage d'un système à élection unique à une **hiérarchie de déploiement à 3 niveaux** avec failover automatique et dégradation gracieuse.

### Architecture 3 niveaux

| Niveau | Infrastructure | Robustesse | Déploiement |
|--------|---------------|------------|-------------|
| 1 | Docker / serveur dédié | ★★★★★ | `docker compose up -d` |
| 2 | Desktop `--server` | ★★★★☆ | `DewiCom --server [--headless]` |
| 3 | APK only | ★★★☆☆ | Élection Bully automatique |

### Nouveau — `dewicom-server` service standalone (Niveau 1)

Serveur Node.js autonome extrait de `local-server.js`, entièrement découplé d'Electron, déployable sur Docker, RPi ou PC dédié sans interface graphique.

- `Dockerfile` + `docker-compose.yml` : `restart: always`, `network_mode: host` (multicast LAN), healthcheck sur `/api/dewicom-discovery`
- Port configurable via `.env` (`DEWICOM_PORT`) — évite les conflits avec d'autres services Docker
- Endpoint `/api/status` : état temps réel (users, canaux, uptime)
- Arrêt propre sur `SIGTERM`/`SIGINT`
- **Image Docker** publiée automatiquement sur `ghcr.io` à chaque tag via CI/CD

```bash
# Déploiement en 2 commandes
git clone https://github.com/dewiweb/dewicom && cd dewicom/dewicom-server
docker compose up -d
```

### Nouveau — Mode `--server` Desktop (Niveau 2)

- `DewiCom --server` : démarre immédiatement comme serveur dédié, annonce `mode=dedicated` en multicast, **sans passer par l'élection Bully**
- `DewiCom --server --headless` : mode daemon sans fenêtre (régie headless, RPi avec Electron)
- Si un autre serveur `--server` existe déjà sur le LAN, se connecte dessus en client — **pas de conflit de port**
- En mode `--server` : **inhibition de veille système** (`powerSaveBlocker`) — le PC ne peut pas dormir tant qu'il sert de serveur

### Nouveau — Hiérarchie de découverte multicast

Le champ `mode` est ajouté à tous les payloads multicast (`docker`/`dedicated`/`desktop-local`/`apk`). Tous les clients (Desktop + Android) appliquent la même priorité :

- `docker` (3) et `dedicated` (2) → **résolution immédiate**, bypass élection
- `desktop-local` (1) → résolution après timeout
- `apk` (0) → ignoré par les clients non-APK

### Nouveau — Failover automatique complet

Watchdog de connexion serveur côté Desktop : si le serveur externe disparaît, après ~6s (3 échecs × 2s) :
1. Re-découverte multicast (un autre serveur dédié a peut-être pris le relais)
2. Si rien → élection Bully entre les nœuds Desktop/APK restants

**Chaîne de dégradation gracieuse :**

```
Docker tombe  → Desktop prend le relais (~7s)
Desktop tombe → autre Desktop ou APK élu (~4-6s)
APK leader tombe → autre APK élu (~4s)
```

### Nouveau — Auto-rejoin sans formulaire

Si `name` + `channel` sont en `localStorage`, `startSession()` s'exécute automatiquement au chargement. L'utilisateur ne voit plus jamais le formulaire après la première connexion — reconnexion transparente lors de tout failover.

### Nouveau — Page de monitoring `/monitor`

Accessible depuis n'importe quel navigateur sur le LAN : `http://<ip-serveur>:3001/monitor`

- Canaux et utilisateurs connectés en temps réel (Socket.io, pas de polling)
- Badge `● PARLE` animé pendant les transmissions PTT
- Uptime, mode serveur, version, journal horodaté des connexions/départs
- Disponible sur Docker **et** Desktop `--server`

### Améliorations — Timings failover (−50%)

| Paramètre | Avant | Après |
|-----------|-------|-------|
| Heartbeat Bully | 2s | **1s** |
| Leader timeout | 6s | **3s** |
| Election wait | 2s | **1s** |
| Announce multicast | 2s | **1s** |
| Watchdog Desktop | 5s×2 | **2s×3** |
| Multicast listen | 3s | **1.5s** |

### Améliorations — Gestion veille système (Desktop)

- `powerMonitor.on("suspend")` : pause propre des timers Bully et watchdog avant la veille
- `powerMonitor.on("resume")` : 2s de délai puis vérification serveur, re-découverte si nécessaire
- `pauseTimers()`/`resumeTimers()` sur `LeaderElection` — reprise sans re-élection fantôme
- Hiérarchie découverte multicast appliquée aussi côté Android (`MulticastDiscovery.java`)

---

## [1.2.5] — 2026-03-02

### Corrigé
- **Arrivée/départ dynamique de nœuds sans perturbation** :
  - **Bug critique : LEADER qui se démet sur ELECTION supérieur** — un leader qui recevait `ELECTION` d'un nœud supérieur (ex: Desktop qui arrive sur un réseau où un APK est leader) ne se démettait pas : il répondait `OK` mais restait `LEADER` et continuait de broadcaster `HEARTBEAT` → deux leaders simultanés pendant `ELECTION_WAIT` (2s). Fix : sur réception de `ELECTION` d'un supérieur, le leader arrête son heartbeat, passe en `FOLLOWER` immédiatement et démarre son watchdog pour attendre le `LEADER` broadcast du supérieur — `LeaderElection.java` + `leader-election.js`
  - Ce fix couvre aussi le cas **retour de l'ancien leader** (même scénario : revient avec le même nodeId supérieur, l'actuel leader cède immédiatement)
  - `startWatchdog()` ajouté dans le handler `OK` pour les nœuds CANDIDATE qui se retirent

---

## [1.2.4] — 2026-03-02

### Corrigé
- **Robustesse multi-nœuds (N APK + M Desktop simultanés)** :
  - **Message `OK` (protocole Bully complet)** : quand un nœud inférieur reçoit `ELECTION` d'un supérieur, il répond `OK` → le supérieur sait qu'il peut annuler sa candidature immédiatement sans attendre le timeout `ELECTION_WAIT` — `LeaderElection.java` + `leader-election.js`
  - **Anti-storm ELECTION** (`BROADCAST_COOLDOWN = 500ms`) : avec N nœuds qui démarrent simultanément, chacun reçoit N-1 messages `ELECTION` et pourrait re-broadcaster N-1 fois → avalanche quadratique. Le cooldown limite à 1 broadcast par 500ms — `LeaderElection.java` + `leader-election.js`
  - **Élection avant serveur (Desktop)** : le serveur local ne démarre plus au démarrage de `discoverServer()`, mais uniquement dans `onBecomeLeader()` — évite que plusieurs Desktop aient un serveur actif simultanément pendant l'élection — `main.js`
  - **Port occupé à la prise de leadership** : retry automatique après 1s si le port 3001 est encore occupé par l'ancien leader — `main.js`

---

## [1.2.3] — 2026-03-02

### Corrigé
- **Boucle élection + double-leader (refonte complète)** — `LeaderElection.java` et `leader-election.js` :
  - `electionPending` debounce : une seule élection active à la fois, prevents re-entrée
  - `becomeFollower()` annule le timer d'élection en cours (`electionTask.cancel()`)
  - `ELECTION` d'un ID supérieur : reset `lastHeartbeat` pour laisser le temps au supérieur de se proclamer sans que le watchdog re-déclenche une élection trop tôt
  - `LEADER` d'un ID `>=` (au lieu de `>`) : évite le split-brain quand deux nœuds ont le même nodeId
  - `handleMessage`, `startElection`, `becomeLeader`, `becomeFollower` : `synchronized` en Java pour éviter les race conditions entre threads scheduler et thread réseau
  - Watchdog : reset `lastHeartbeat` sur réception de `HEARTBEAT` d'un nœud supérieur inconnu → `becomeFollower` immédiat

---

## [1.2.2] — 2026-03-02

### Corrigé
- **Arrêt serveur APK au swipe** : `onDestroy()` seul ne suffit pas — Android peut tuer le process sans l'appeler. Ajout de `android:stopWithTask="true"` dans le Manifest (garantit l'arrêt du process au swipe depuis le switcher) et refactorisation en `stopAll()` pour `leaderElection` + `LocalWebServer` + `executor`

---

## [1.2.1] — 2026-03-02

### Corrigé
- **Boucle élection leader** : quand un nœud recevait un `LEADER` d'ID inférieur, il relançait `_startElection()` → l'autre répondait `LEADER` → boucle infinie → déconnexions répétées. Fix : on ne challenge que si on n'est pas déjà `CANDIDATE` (le timer `ELECTION_WAIT` se charge de la proclamation dans ce cas) — `LeaderElection.java` et `leader-election.js`
- **Workflow CI** : extraction CHANGELOG réécrite en Python (awk échouait sur les délimiteurs) ; glob artefacts élargi à `artifacts/**/*` pour matcher la structure réelle du download

---

## [1.2.0] — 2026-03-02

### Nouvelles fonctionnalités
- **Director mode complet** : écoute et émission simultanée sur plusieurs canaux, sélection granulaire par canal (écoute / parole indépendantes)
- **`audio-chunk` multi-canal** : un seul paquet émis avec `talkChannels`, serveur distribue aux destinataires uniques — fin des sons découpés/délayés
- **`call-ring` multi-canal** : la sonnerie suit les canaux d'émission director (tous les `talkChannels` actifs)
- **Version dans le footer** : `v1.2.0` affiché dans le footer leader (lu dynamiquement depuis `dewicom-discovery`)

### Corrigé
- **Élection leader (Bully)** : un nœud se soumettait à un `LEADER` d'ID inférieur — désormais challenge et relance l'élection (`LeaderElection.java` + `leader-election.js`)
- **Desktop vs APK** : le desktop (nodeId = IP + 2³²) prend correctement le leadership face à un APK déjà leader
- **`channel-state` badges** : compteurs de participants jamais mis à jour — `broadcastChannelState()` ajouté après `join`/`switch-channel`/`disconnect`
- **`call-ring`** : diffusait sur tous les canaux (`broadcastAllExcept`) au lieu du canal de l'appelant
- **`user-left`** : notifiait tous les canaux au lieu du seul canal de l'utilisateur
- **Protocole Socket.io** : `"42[...]"` confondu avec heartbeat `"2"` dans `LocalWebServer.java` — `join` et autres événements ignorés
- **Navigateur externe → APK** : utilisait WS natif vers `127.0.0.1` au lieu de l'IP LAN réelle
- **`BuildConfig.VERSION_NAME`** : version APK servie dynamiquement dans `/api/dewicom-discovery` (plus de hardcode `1.0.0`)

### Amélioré
- **`LocalWebServer.java`** : `UserInfo` remplace `String[]` pour stocker `listenChannels`, `talkChannels`, `name`, `channel`
- **Déduplication audio** : `Set seen` côté serveur empêche envoi multiple du même chunk au même destinataire
- **`local-server.js`** : `payload.talkChannels` prioritaire sur `user.talkChannels` pour compatibilité ascendante

---

## [1.1.21] — 2026-03-02

### Corrigé
- **`call-ring` director mode** : la sonnerie n'était émise que sur `myChannel` — désormais émise sur tous les `talkChannels` actifs de l'émetteur (`ui.js`, `local-server.js`, `server/index.js`, `LocalWebServer.java`)
- Les destinataires sont dédupliqués : un utilisateur en écoute sur plusieurs canaux ciblés ne reçoit la sonnerie qu'une seule fois

---

## [1.1.20] — 2026-03-02

### Corrigé
- **Director mode audio (root cause)** : le client émettait N fois le même chunk (une par `talkChannel`) — corrigé en émettant une seule fois avec `talkChannels` dans le payload, le serveur gérant la distribution déduplicée
- **`audio.js`** : `socket.emit("audio-chunk", { talkChannels, ... })` — émission unique au lieu de N émissions en boucle
- **`local-server.js`, `server/index.js`, `LocalWebServer.java`** : utilise `payload.talkChannels` si présent (priorité sur `user.talkChannels`)

---

## [1.1.19] — 2026-03-02

### Corrigé
- **Director mode audio** : `audio-chunk` envoyé N fois au même destinataire si celui-ci était présent dans plusieurs `talkChannels` — corrigé par déduplication des destinataires (`Set<WebSocket> seen`) dans `LocalWebServer.java`, `local-server.js` et `server/index.js`

---

## [1.1.18] — 2026-03-02

### Corrigé
- **Élection leader** : bug Bully — un nœud se soumettait à un `LEADER` d'ID inférieur au sien ; désormais il challenge et relance l'élection (fix dans `LeaderElection.java` et `leader-election.js`)
- **Desktop vs APK** : le desktop (nodeId = IP + 2³²) gagne maintenant correctement l'élection face à un APK déjà leader

---

## [1.1.17] — 2026-03-02

### Ajouté
- **LocalWebServer.java** : implémentation complète du director mode — `update-listen-channels`, `update-talk-channels`, audio/PTT sur `talkChannels`, `call-ring` aux listeners du canal
- **LocalWebServer.java** : classe interne `UserInfo` remplace `String[]` pour stocker `listenChannels` et `talkChannels` par socket

---

## [1.1.16] — 2026-03-02

### Corrigé
- **LocalWebServer.java** : `channel-state` jamais envoyé → badges de participants vides — ajout de `broadcastChannelState()` après `join`/`switch-channel`/`disconnect`
- **LocalWebServer.java** : `call-ring` diffusait à tous les canaux (`broadcastAllExcept`) au lieu du canal du caller (`broadcastChannel`)
- **LocalWebServer.java** : `user-left` sur disconnect diffusait à tous les canaux au lieu du seul canal de l'utilisateur
- **LocalWebServer.java** : couleurs des canaux corrigées pour correspondre à celles du desktop/navigateur

---

## [1.1.15] — 2026-03-02

### Corrigé
- **CI release** : glob Windows restreint à `*Setup*.exe` pour n'uploader que l'installeur NSIS (évite les doublons `.exe`)

---

## [1.1.14] — 2026-03-02

### Corrigé
- **LocalWebServer.java** : bug critique dans le parsing du protocole Socket.io — `"42[\"join\",...]"` était confondu avec un heartbeat `"2"` après strip du préfixe `"4"`, rendant le `join` invisible pour le serveur APK

---

## [1.1.13] — 2026-03-02

### Corrigé
- **APK socket.js** : navigateur externe → APK utilise désormais WS natif port 3002 (détecté via `/api/dewicom-discovery`) au lieu de Socket.io qui n'est pas supporté par NanoHTTPD

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
