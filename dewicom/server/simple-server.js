const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const qr = require('qrcode');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 8000;

// API de découverte DewiCom
app.get('/api/dewicom-discovery', (req, res) => {
  res.json({
    service: 'DewiCom',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    status: 'running'
  });
});

// API de ping
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', service: 'DewiCom' });
});

// Servir les fichiers statiques
app.use(express.static('public'));
app.use(express.static('node_modules/socket.io/client-dist'));

// QR Code
app.get('/qr', async (req, res) => {
  try {
    const localIP = getLocalIP();
    const url = `http://${localIP}:${PORT}`;
    const qrDataUrl = await qrcode.toDataURL(url);
    
    res.send(`
      <html>
        <body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f0f0f0;">
          <div style="text-align:center;">
            <h2>DewiCom - QR Code</h2>
            <img src="${qrDataUrl}" style="width:300px;height:300px;border:2px solid #333;">
            <p style="font-family:monospace;">${url}</p>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Erreur QR Code');
  }
});

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      if (interface.family === 'IPv4' && !interface.internal) {
        return interface.address;
      }
    }
  }
  return 'localhost';
}

// Gestion Socket.IO
const channels = {
  general: { name: 'Général', users: new Set() },
  foh: { name: 'FOH', users: new Set() },
  plateau: { name: 'Plateau', users: new Set() },
  lumiere: { name: 'Lumière', users: new Set() },
  regie: { name: 'Régie', users: new Set() }
};

const users = new Map();

io.on('connection', (socket) => {
  console.log('Client connecté:', socket.id);

  socket.on('join-channel', (data) => {
    const { channel, username } = data;
    
    // Quitte l'ancien canal
    if (users.has(socket.id)) {
      const oldChannel = users.get(socket.id).channel;
      if (channels[oldChannel]) {
        channels[oldChannel].users.delete(socket.id);
        socket.leave(oldChannel);
        io.to(oldChannel).emit('user-left', { username: users.get(socket.id).username });
      }
    }

    // Rejoint le nouveau canal
    users.set(socket.id, { username, channel });
    channels[channel].users.add(socket.id);
    socket.join(channel);
    
    socket.emit('joined-channel', { channel });
    io.to(channel).emit('user-joined', { username });
    
    console.log(`${username} a rejoint ${channel}`);
  });

  socket.on('audio-data', (data) => {
    const user = users.get(socket.id);
    if (user && channels[user.channel]) {
      socket.to(user.channel).emit('audio-data', {
        username: user.username,
        audioData: data.audioData,
        channel: user.channel
      });
    }
  });

  socket.on('ptt-start', (data) => {
    const user = users.get(socket.id);
    if (user && channels[user.channel]) {
      socket.to(user.channel).emit('ptt-start', {
        username: user.username,
        channel: user.channel
      });
    }
  });

  socket.on('ptt-stop', (data) => {
    const user = users.get(socket.id);
    if (user && channels[user.channel]) {
      socket.to(user.channel).emit('ptt-stop', {
        username: user.username,
        channel: user.channel
      });
    }
  });

  socket.on('disconnect', () => {
    if (users.has(socket.id)) {
      const user = users.get(socket.id);
      if (channels[user.channel]) {
        channels[user.channel].users.delete(socket.id);
        io.to(user.channel).emit('user-left', { username: user.username });
      }
      users.delete(socket.id);
    }
    console.log('Client déconnecté:', socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`\n🚀 Serveur DewiCom démarré!`);
  console.log(`📱 Local: http://localhost:${PORT}`);
  console.log(`🌐 Réseau: http://${localIP}:${PORT}`);
  console.log(`📷 QR Code: http://${localIP}:${PORT}/qr`);
  console.log(`\n🎤 Micro: prêt pour PTT\n`);
});
