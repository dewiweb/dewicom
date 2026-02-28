// Script de découverte automatique du serveur DewiCom
class DewiComDiscovery {
    constructor() {
        this.serverIP = null;
        this.serverPort = 8000;
        this.isScanning = false;
    }

    async scanNetwork() {
        if (this.isScanning) return;
        this.isScanning = true;

        console.log('🔍 Recherche des serveurs DewiCom...');
        
        // Détecte l'IP locale du poste
        const localNetwork = await this.detectLocalNetwork();
        
        if (localNetwork) {
            console.log(`📡 Scan du réseau: ${localNetwork}.x`);
            
            // Scan uniquement le sous-réseau local
            for (let i = 1; i <= 254; i++) {
                const ip = `${localNetwork}.${i}`;
                if (await this.testDewiComServer(ip)) {
                    console.log(`✅ Serveur DewiCom trouvé: ${ip}`);
                    this.serverIP = ip;
                    this.isScanning = false;
                    return ip;
                }
            }
        }
        
        console.log('❌ Aucun serveur DewiCom trouvé');
        this.isScanning = false;
        return null;
    }

    async detectLocalNetwork() {
        try {
            // Essaie de détecter l'IP locale via WebRTC
            const localIP = await this.getLocalIPViaWebRTC();
            if (localIP) {
                return localIP.split('.').slice(0, 3).join('.');
            }
        } catch (e) {
            console.log('WebRTC failed, fallback to common networks');
        }
        
        // Fallback: teste les réseaux locaux courants
        const commonNetworks = ['192.168.0', '192.168.1', '10.0.0', '172.16.0'];
        
        // Teste si on peut joindre le routeur de chaque réseau
        for (const network of commonNetworks) {
            if (await this.testHost(`${network}.1`)) {
                console.log(`🌐 Réseau détecté: ${network}.x`);
                return network;
            }
        }
        
        return null;
    }

    async getLocalIPViaWebRTC() {
        return new Promise((resolve, reject) => {
            const rtc = new RTCPeerConnection({iceServers: []});
            rtc.createDataChannel('');
            rtc.onicecandidate = (event) => {
                if (event.candidate) {
                    const candidate = event.candidate.candidate;
                    const match = candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
                    if (match && !match[1].startsWith('127.')) {
                        rtc.close();
                        resolve(match[1]);
                    }
                }
            };
            rtc.createOffer()
                .then(offer => rtc.setLocalDescription(offer))
                .catch(reject);
            
            // Timeout après 5 secondes
            setTimeout(() => {
                rtc.close();
                reject(new Error('Timeout'));
            }, 5000);
        });
    }

    async testHost(ip) {
        try {
            const response = await fetch(`http://${ip}`, {
                method: 'HEAD',
                timeout: 1000
            });
            return true;
        } catch (e) {
            return false;
        }
    }

    async testDewiComServer(ip) {
        try {
            const response = await fetch(`http://${ip}:${this.serverPort}/api/dewicom-discovery`, {
                method: 'GET',
                timeout: 2000
            });
            if (response.ok) {
                const data = await response.json();
                return data.service === 'DewiCom';
            }
        } catch (e) {
            // Timeout ou erreur de connexion
        }
        return false;
    }

    async connectToServer() {
        // Affiche un message de scan
        this.showScanMessage();
        
        const serverIP = await this.scanNetwork();
        
        if (serverIP) {
            // Redirige vers le serveur trouvé
            this.hideScanMessage();
            window.location.href = `http://${serverIP}:${this.serverPort}`;
        } else {
            // Mode local
            this.hideScanMessage();
            console.log('🚀 Mode local activé');
            this.startLocalMode();
        }
    }

    showScanMessage() {
        const message = document.createElement('div');
        message.id = 'scan-message';
        message.innerHTML = `
            <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                        background: #333; color: white; padding: 20px; border-radius: 10px; 
                        text-align: center; z-index: 10000;">
                <h3>🔍 Recherche DewiCom</h3>
                <p>Scan du réseau local...</p>
                <div style="margin: 10px 0;">
                    <div style="border: 2px solid #4CAF50; border-radius: 50%; 
                                width: 20px; height: 20px; display: inline-block; 
                                animation: spin 1s linear infinite;"></div>
                </div>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            </div>
        `;
        document.body.appendChild(message);
    }

    hideScanMessage() {
        const message = document.getElementById('scan-message');
        if (message) {
            message.remove();
        }
    }

    startLocalMode() {
        // Affiche un message et continue en mode local
        const message = document.createElement('div');
        message.innerHTML = `
            <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                        background: #333; color: white; padding: 20px; border-radius: 10px; 
                        text-align: center; z-index: 10000;">
                <h3>🚀 Mode Local</h3>
                <p>Aucun serveur DewiCom trouvé sur le réseau</p>
                <p>Fonctionnement en mode autonome</p>
                <button onclick="this.parentElement.remove()" 
                        style="background: #4CAF50; color: white; border: none; 
                               padding: 10px 20px; border-radius: 5px; cursor: pointer;">
                    OK
                </button>
            </div>
        `;
        document.body.appendChild(message);
    }
}

// Lance la découverte au chargement
const discovery = new DewiComDiscovery();
discovery.connectToServer();
