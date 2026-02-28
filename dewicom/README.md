# 🎙️ DewiCom

**Intercom WiFi local pour techniciens scène — zéro installation, zéro cloud, zéro abonnement.**

> Lance le serveur sur n'importe quel ordinateur en régie. Toute l'équipe rejoint en scannant un QR code. Parle par canal (FOH, Plateau, Lumière, Régie).

---

## Démarrage rapide

```bash
npm install
npm start
# → http://localhost:3000
# → QR code affiché dans le terminal
```

Ouvrir `http://[IP-LOCALE]:3000` sur tous les appareils du même réseau WiFi.  
Ou scanner le QR code affiché sur `http://[IP-LOCALE]:3000/qr`.

---

## Fonctionnalités

- **5 canaux prédéfinis** : Général, FOH Son, Plateau, Lumière, Régie
- **PTT (Push-To-Talk)** : bouton central ou touche `Espace`
- **Indicateur de parole** en temps réel avec animation
- **QR code** pour rejoindre instantanément depuis un mobile
- **Liste des participants** par canal
- **UI sombre** optimisée pour utilisation dans le noir
- **100% LAN** — fonctionne sans internet, zéro donnée externe

---

## Stack

- **Node.js + Express** — serveur de signaling
- **Socket.io** — communication temps réel
- **Web Audio API** — capture et lecture audio PCM 16bit/16kHz
- **PWA** — installable sur mobile depuis le navigateur

---

## Monétisation (one-time fee)

| Tier | Prix | Limite |
|---|---|---|
| **Gratuit** | 0€ | 3 appareils simultanés |
| **Show** | 15€ | 10 appareils, clé de session |
| **Tour** | 39€ | Illimité, support |

Clé de licence vérifiée côté serveur au démarrage — pas de cloud, juste une validation locale.

---

## Roadmap

- [ ] App Android native (PTT bouton volume physique)
- [ ] Canaux personnalisables
- [ ] Enregistrement de session
- [ ] Intégration OSC (trigger depuis console lumière)
- [ ] Mode hotspot autonome (Raspberry Pi)
