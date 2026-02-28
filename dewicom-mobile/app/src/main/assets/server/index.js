// Serveur DewiCom simplifié pour Android
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 8000;

// API de découverte
app.get('/api/dewicom-discovery', (req, res) => {
  res.json({
    service: 'DewiCom',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    status: 'running',
    platform: 'android'
  });
});

// API de ping
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', service: 'DewiCom' });
});

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));

// Gestion Socket.IO simplifiée
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
    
    if (users.has(socket.id)) {
      const oldChannel = users.get(socket.id).channel;
      if (channels[oldChannel]) {
        channels[oldChannel].users.delete(socket.id);
        socket.leave(oldChannel);
        io.to(oldChannel).emit('user-left', { username: users.get(socket.id).username });
      }
    }

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

// Démarrage du serveur
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur DewiCom Android démarré sur le port ${PORT}`);
  console.log(`📱 Accès local: http://localhost:${PORT}`);
  console.log(`🌐 Accès réseau: http://0.0.0.0:${PORT}`);
});
