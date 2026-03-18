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
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Servir arquivos estáticos do Angular
app.use(express.static(path.join(__dirname, 'dist/browser')));

const fs = require('fs');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');

// ... (configuração existente)

// ================================
// WEBAUTHN ENDPOINTS (SEGURANÇA)
// ================================
const rpName = "Simbiose Protocolo";
const appUrl = new URL(process.env.APP_URL || 'https://ais-pre-esvlsbtkj5xggs7ic2ocwh-8568421202.us-west2.run.app');
const rpID = appUrl.hostname;
const CREDENTIALS_FILE = path.join(__dirname, 'credentials.json');

// Carregar credenciais do arquivo
let userCredentials = new Map();
if (fs.existsSync(CREDENTIALS_FILE)) {
    const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    userCredentials = new Map(Object.entries(data));
}

function saveCredentials() {
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(Object.fromEntries(userCredentials), null, 2));
}

const challenges = new Map();

app.post('/api/auth/generate-registration-options', async (req, res) => {
    const { userId, userName } = req.body;
    const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userID: userId,
        userName: userName,
        attestationType: 'none',
    });
    challenges.set(userId, options.challenge);
    res.json(options);
});

app.post('/api/auth/verify-registration', async (req, res) => {
    const { userId, response } = req.body;
    const expectedChallenge = challenges.get(userId);
    
    const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedRPID: rpID,
        expectedOrigin: process.env.APP_URL || 'https://ais-pre-esvlsbtkj5xggs7ic2ocwh-8568421202.us-west2.run.app',
    });

    if (verification.verified) {
        userCredentials.set(userId, verification.registrationInfo);
        saveCredentials(); // Persiste no arquivo
        res.json({ verified: true });
    } else {
        res.status(400).json({ verified: false });
    }
});

app.post('/api/auth/generate-authentication-options', async (req, res) => {
    const { userId } = req.body;
    const credential = userCredentials.get(userId);
    
    if (!credential) return res.status(404).json({ error: 'Credencial não encontrada' });

    const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: [{
            id: credential.credentialID,
            type: 'public-key',
        }],
    });
    challenges.set(userId, options.challenge);
    res.json(options);
});

app.post('/api/auth/verify-authentication', async (req, res) => {
    const { userId, response } = req.body;
    const expectedChallenge = challenges.get(userId);
    const credential = userCredentials.get(userId);

    if (!credential) return res.status(404).json({ error: 'Credencial não encontrada' });

    const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedRPID: rpID,
        expectedOrigin: process.env.APP_URL || 'https://ais-pre-esvlsbtkj5xggs7ic2ocwh-8568421202.us-west2.run.app',
        authenticator: {
            credentialID: credential.credentialID,
            credentialPublicKey: credential.credentialPublicKey,
            counter: credential.counter,
        },
    });

    if (verification.verified) {
        res.json({ verified: true });
    } else {
        res.status(400).json({ verified: false });
    }
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
server.listen(port, () => {
  console.log(`🚀 Backend rodando em http://localhost:${port}`);
});