import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';

// ================================
// CONFIGURAÇÃO DO SERVIDOR
// ================================
const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Servir arquivos estáticos do Angular
app.use(express.static(path.join(import.meta.dirname, 'dist/browser'), {
  index: false
}));

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
const wss = new WebSocketServer({ server });

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
// RUNTIME CONFIG API
// ================================
app.get('/api/config', (req, res) => {
  res.json({
    geminiApiKey: process.env.GEMINI_API_KEY || ''
  });
});

// ================================
// TWA: DIGITAL ASSET LINKS
// ================================
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: process.env.TWA_PACKAGE_NAME || 'com.seuusuario.simbiose',
        sha256_cert_fingerprints: [
          process.env.TWA_SHA256_FINGERPRINT || 'COLE_AQUI_O_SHA256_DA_PLAY_STORE'
        ]
      }
    }
  ]);
});

// ================================
// SPA FALLBACK
// ================================
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(import.meta.dirname, 'dist/browser/index.html'));
});

// ================================
// INICIALIZAÇÃO
// ================================
server.listen(port, () => {
  console.log(`🚀 Backend rodando em http://localhost:${port}`);
});