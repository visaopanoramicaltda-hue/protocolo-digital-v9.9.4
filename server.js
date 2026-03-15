require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');

// ================================
// CONFIGURAÇÃO DO SERVIDOR
// ================================
const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Servir arquivos estáticos do Angular
app.use(express.static(path.join(__dirname, 'dist/browser')));

// ================================
// ROTA RAIZ (TESTE)
// ================================
app.get('/api/health', (req, res) => {
  res.send({ status: 'online', service: 'Simbiose Backend (Signaling Only)' });
});

// ================================
// IP TRACKING FOR ADMINS
// ================================
const adminAllowedIps = new Map(); // userId -> string[]

app.post('/api/check-ip', (req, res) => {
    const { userId, ip } = req.body;
    if (!userId || !ip) return res.status(400).send({ error: 'Missing userId or ip' });

    const allowedIps = adminAllowedIps.get(userId) || [];
    
    if (allowedIps.includes(ip)) {
        return res.send({ allowed: true, forceMultiCondo: false });
    }

    if (allowedIps.length >= 2) {
        return res.send({ allowed: false, forceMultiCondo: true });
    }

    allowedIps.push(ip);
    adminAllowedIps.set(userId, allowedIps);
    return res.send({ allowed: true, forceMultiCondo: false });
});

// ================================
// WEBSOCKET SIGNALING (QUANTUM NET)
// ================================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  ws.on('message', (message) => {
    // Relay simples para sinalização P2P
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });
});

// ================================
// SPA FALLBACK
// ================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist/browser/index.html'));
});

// ================================
// INICIALIZAÇÃO
// ================================
server.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Backend rodando em http://0.0.0.0:${port}`);
});