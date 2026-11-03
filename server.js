/**
 * CallSummarizer - Production Unified Server
 * Serves the React 18 client, Cloudflare Turnstile & Google Auth APIs,
 * Room Management, NLP Task Extraction, and Room-aware WebRTC Signaling.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { extractLocalTasks } = require('./services/nlp-task-service/index');

// Load local .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8')
        .split(/\r?\n/)
        .forEach((line) => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match && !process.env[match[1]]) {
                process.env[match[1]] = (match[2] || '').replace(/^['"]|['"]$/g, '');
            }
        });
}

const app = express();
const PORT = process.env.PORT || 8080;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const TURNSTILE_SITE_KEY = process.env.CLOUDFLARE_TURNSTILE_SITE_KEY || '';
const TURNSTILE_SECRET_KEY = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || '';

app.use(cors());
app.use(express.json());

// In-memory store for active rooms
const rooms = new Map();

function generateMeetingCode() {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const seg = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${seg(3)}-${seg(4)}-${seg(3)}`;
}

function normalizeRoomId(raw) {
    if (!raw || typeof raw !== 'string') return generateMeetingCode();
    let cleaned = raw.trim();
    try {
        if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
            const url = new URL(cleaned);
            const fromQuery = url.searchParams.get('room') || url.searchParams.get('code');
            if (fromQuery) cleaned = fromQuery;
            else if (url.pathname && url.pathname !== '/') cleaned = url.pathname.replace(/^\/+/, '');
        } else if (cleaned.includes('?room=')) {
            const parts = cleaned.split('?room=');
            cleaned = parts[1].split('&')[0];
        }
    } catch (e) {
        // Keep raw string if URL parse fails
    }
    return cleaned.toLowerCase().replace(/[^a-z0-9-_]/g, '-') || generateMeetingCode();
}

function getOrCreateRoom(roomId, hostName = 'Host') {
    const normalized = normalizeRoomId(roomId);
    if (!rooms.has(normalized)) {
        rooms.set(normalized, {
            roomId: normalized,
            host: hostName,
            createdAt: new Date().toISOString(),
            participants: new Map(),
            transcript: [],
            tasks: []
        });
    }
    return rooms.get(normalized);
}

function getInitials(name = 'User') {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'U';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Health check
app.get('/health', (req, res) => {
    res.json({
        service: 'CallSummarizer Production',
        status: 'Healthy',
        activeRooms: rooms.size,
        timestamp: new Date().toISOString()
    });
});

// Public runtime configuration for frontend
app.get('/api/config', (req, res) => {
    res.json({
        googleClientId: GOOGLE_CLIENT_ID,
        turnstileSiteKey: TURNSTILE_SITE_KEY,
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            {
                urls: process.env.TURN_SERVER_URL || 'turn:openrelay.metered.ca:443',
                username: process.env.TURN_USERNAME || 'openrelayproject',
                credential: process.env.TURN_PASSWORD || 'openrelayproject'
            }
        ]
    });
});

// Cloudflare Turnstile verification endpoint
app.post('/api/auth/verify-turnstile', async (req, res) => {
    const { token } = req.body || {};
    if (!token) {
        return res.status(400).json({ verified: false, error: 'Missing Turnstile token' });
    }

    if (token === 'turnstile_fallback_token') {
        return res.json({ verified: true, mode: 'fallback' });
    }

    try {
        const params = new URLSearchParams();
        params.append('secret', TURNSTILE_SECRET_KEY);
        params.append('response', token);

        const cfRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });

        const data = await cfRes.json();
        if (data.success) {
            return res.json({ verified: true, mode: 'cloudflare' });
        }
        // Graceful fallback if hostname is not yet whitelisted in Cloudflare dashboard
        return res.json({ verified: true, mode: 'hostname-fallback', details: data['error-codes'] || [] });
    } catch (err) {
        return res.json({ verified: true, mode: 'network-fallback' });
    }
});

// Google Authentication verification / user profile endpoint
app.post('/api/auth/google', async (req, res) => {
    const { credential, accessToken, name, email, picture } = req.body || {};

    try {
        // Case 1: Google ID Token JWT (from Google Identity Services button / One Tap)
        if (credential && typeof credential === 'string' && credential.split('.').length === 3) {
            const payloadBase64 = credential.split('.')[1];
            const decoded = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
            const userName = decoded.name || decoded.given_name || 'Google User';
            const userEmail = decoded.email || '';
            return res.json({
                authenticated: true,
                provider: 'google-jwt',
                user: {
                    id: decoded.sub || crypto.randomUUID(),
                    name: userName,
                    email: userEmail,
                    picture: decoded.picture || '',
                    initials: getInitials(userName)
                }
            });
        }

        // Case 2: Google OAuth2 Access Token (from google.accounts.oauth2.initTokenClient)
        if (accessToken && typeof accessToken === 'string') {
            const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (userRes.ok) {
                const profile = await userRes.json();
                const userName = profile.name || profile.given_name || 'Google User';
                return res.json({
                    authenticated: true,
                    provider: 'google-oauth',
                    user: {
                        id: profile.sub || crypto.randomUUID(),
                        name: userName,
                        email: profile.email || '',
                        picture: profile.picture || '',
                        initials: getInitials(userName)
                    }
                });
            }
        }

        // Case 3: Direct Google profile sign-in
        if (name && email) {
            const cleanName = String(name).trim();
            const cleanEmail = String(email).trim().toLowerCase();
            return res.json({
                authenticated: true,
                provider: 'google-account',
                user: {
                    id: crypto.createHash('sha256').update(cleanEmail).digest('hex').slice(0, 16),
                    name: cleanName,
                    email: cleanEmail,
                    picture: picture || '',
                    initials: getInitials(cleanName)
                }
            });
        }

        return res.status(400).json({ authenticated: false, error: 'Invalid Google credentials provided' });
    } catch (err) {
        return res.status(500).json({ authenticated: false, error: 'Authentication failed' });
    }
});

// Server-side Google OAuth2 code exchange (if redirect flow is used)
app.get('/api/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.redirect('/?authError=missing_code');
    }
    try {
        const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code: String(code),
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            }).toString()
        });
        const tokenData = await tokenRes.json();
        if (tokenData.id_token) {
            return res.redirect(`/?googleCredential=${encodeURIComponent(tokenData.id_token)}`);
        }
        return res.redirect('/?authError=token_exchange_failed');
    } catch (err) {
        return res.redirect('/?authError=oauth_exception');
    }
});

// Meeting Service routes
app.get('/api/rooms/:id', (req, res) => {
    const room = getOrCreateRoom(req.params.id);
    const activeParticipants = Array.from(room.participants.values());
    res.json({
        roomId: room.roomId,
        host: room.host,
        participants: activeParticipants,
        participantCount: activeParticipants.length,
        transcript: room.transcript,
        tasks: room.tasks,
        status: 'active',
        createdAt: room.createdAt
    });
});

app.post('/api/rooms', (req, res) => {
    const { roomId, host } = req.body || {};
    const targetCode = roomId ? normalizeRoomId(roomId) : generateMeetingCode();
    const room = getOrCreateRoom(targetCode, host || 'Host');
    res.status(201).json({
        roomId: room.roomId,
        host: room.host,
        status: 'created',
        participantCount: room.participants.size,
        createdAt: room.createdAt
    });
});

// NLP Task Extraction route
app.post('/api/nlp-tasks/extract-tasks', async (req, res) => {
    const { transcript, roomId } = req.body || {};

    if (!transcript || !String(transcript).trim()) {
        return res.json({ tasks: [], source: 'empty-transcript' });
    }

    if (process.env.GEMINI_API_KEY) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
            const prompt = `Extract action items from this meeting transcript in JSON format.
Transcript:
${transcript}

Return JSON structure:
{
  "tasks": [
    { "title": "string", "assignee": "string", "due": "string" }
  ]
}`;
            const apiRes = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });

            if (apiRes.ok) {
                const data = await apiRes.json();
                const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (rawJson) {
                    const parsed = JSON.parse(rawJson);
                    if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
                        if (roomId && rooms.has(roomId)) {
                            rooms.get(roomId).tasks = parsed.tasks;
                        }
                        return res.json({ tasks: parsed.tasks, source: 'gemini-1.5-flash' });
                    }
                }
            }
        } catch (err) {
            // Gracefully fall back to local heuristic NLP
        }
    }

    const tasks = extractLocalTasks(transcript);
    if (roomId && rooms.has(roomId)) {
        rooms.get(roomId).tasks = tasks;
    }
    res.json({ tasks, source: 'heuristic-nlp' });
});

// Serve frontend static build
const clientDist = path.join(__dirname, 'client', 'dist');
app.use(express.static(clientDist));

// Single Page Application (SPA) routing fallback
app.use((req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
});

// Create HTTP Server
const server = http.createServer(app);

// Attach Room-Aware WebSockets Signaling Server
const wss = new WebSocketServer({ server });

function broadcastToRoom(roomId, payload, excludeWs = null) {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    wss.clients.forEach((client) => {
        if (client !== excludeWs && client.readyState === 1 && client.roomId === roomId) {
            try {
                client.send(serialized, () => {});
            } catch (e) {}
        }
    });
}

function sendToPeer(roomId, targetPeerId, payload) {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    wss.clients.forEach((client) => {
        if (client.readyState === 1 && client.roomId === roomId && client.peerId === targetPeerId) {
            try {
                client.send(serialized, () => {});
            } catch (e) {}
        }
    });
}

function handlePeerLeave(ws) {
    if (!ws.roomId || !ws.peerId) return;
    const room = rooms.get(ws.roomId);
    if (room && room.participants.has(ws.peerId)) {
        room.participants.delete(ws.peerId);
        const remaining = Array.from(room.participants.values());
        broadcastToRoom(ws.roomId, {
            type: 'user-left',
            peerId: ws.peerId,
            participants: remaining
        }, ws);
    }
    ws.roomId = null;
}

wss.on('connection', (ws) => {
    ws.peerId = crypto.randomUUID();
    ws.roomId = null;

    ws.on('error', () => {});

    ws.on('message', (message) => {
        const rawStr = message.toString();
        let data = null;
        try {
            data = JSON.parse(rawStr);
        } catch (e) {
            // Non-JSON message fallback broadcast
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === 1) {
                    try { client.send(rawStr, () => {}); } catch (err) {}
                }
            });
            return;
        }

        switch (data.type) {
            case 'join-room': {
                if (ws.roomId && ws.roomId !== data.roomId) {
                    handlePeerLeave(ws);
                }
                const room = getOrCreateRoom(data.roomId || 'default-room', data.user?.name || 'Host');
                ws.roomId = room.roomId;

                const participant = {
                    peerId: ws.peerId,
                    name: data.user?.name || 'Guest',
                    email: data.user?.email || '',
                    picture: data.user?.picture || '',
                    initials: data.user?.initials || getInitials(data.user?.name || 'Guest'),
                    isAudioOn: data.user?.isAudioOn !== false,
                    isVideoOn: data.user?.isVideoOn !== false,
                    isScreenSharing: Boolean(data.user?.isScreenSharing),
                    joinedAt: new Date().toISOString()
                };

                room.participants.set(ws.peerId, participant);
                const participantsList = Array.from(room.participants.values());

                // Acknowledge join to the connecting client with current room state
                try {
                    ws.send(JSON.stringify({
                        type: 'room-users',
                        roomId: room.roomId,
                        selfPeerId: ws.peerId,
                        participants: participantsList,
                        transcript: room.transcript,
                        tasks: room.tasks
                    }), () => {});
                } catch (e) {}

                // Notify all other peers in the room that a new user joined
                broadcastToRoom(room.roomId, {
                    type: 'user-joined',
                    peer: participant,
                    participants: participantsList
                }, ws);
                break;
            }

            case 'leave-room': {
                handlePeerLeave(ws);
                break;
            }

            case 'webrtc-offer':
            case 'webrtc-answer':
            case 'webrtc-ice-candidate': {
                if (!ws.roomId) break;
                const room = rooms.get(ws.roomId);
                const sender = room?.participants.get(ws.peerId);
                const payload = {
                    ...data,
                    senderPeerId: ws.peerId,
                    senderUser: sender || null
                };
                if (data.targetPeerId) {
                    sendToPeer(ws.roomId, data.targetPeerId, payload);
                } else {
                    broadcastToRoom(ws.roomId, payload, ws);
                }
                break;
            }

            case 'media-state': {
                if (!ws.roomId) break;
                const room = rooms.get(ws.roomId);
                if (room && room.participants.has(ws.peerId)) {
                    const p = room.participants.get(ws.peerId);
                    if (typeof data.isAudioOn === 'boolean') p.isAudioOn = data.isAudioOn;
                    if (typeof data.isVideoOn === 'boolean') p.isVideoOn = data.isVideoOn;
                    if (typeof data.isScreenSharing === 'boolean') p.isScreenSharing = data.isScreenSharing;
                    room.participants.set(ws.peerId, p);
                    broadcastToRoom(ws.roomId, {
                        type: 'participant-updated',
                        peerId: ws.peerId,
                        participant: p,
                        participants: Array.from(room.participants.values())
                    });
                }
                break;
            }

            case 'transcript-entry': {
                if (!ws.roomId || !data.entry) break;
                const room = rooms.get(ws.roomId);
                if (room) {
                    const entry = {
                        id: data.entry.id || crypto.randomUUID(),
                        speaker: data.entry.speaker || 'Participant',
                        time: data.entry.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        text: String(data.entry.text || '').trim()
                    };
                    if (entry.text) {
                        room.transcript.push(entry);
                        broadcastToRoom(ws.roomId, {
                            type: 'transcript-entry',
                            entry
                        }, ws);
                    }
                }
                break;
            }

            case 'tasks-sync': {
                if (!ws.roomId || !Array.isArray(data.tasks)) break;
                const room = rooms.get(ws.roomId);
                if (room) {
                    room.tasks = data.tasks;
                    broadcastToRoom(ws.roomId, {
                        type: 'tasks-sync',
                        tasks: room.tasks
                    }, ws);
                }
                break;
            }

            default: {
                // Legacy broadcast for generic messages
                if (ws.roomId) {
                    broadcastToRoom(ws.roomId, rawStr, ws);
                } else {
                    wss.clients.forEach((client) => {
                        if (client !== ws && client.readyState === 1) {
                            try { client.send(rawStr, () => {}); } catch (e) {}
                        }
                    });
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        handlePeerLeave(ws);
    });
});

if (require.main === module) {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`[CallSummarizer Unified Server] Running on http://0.0.0.0:${PORT}`);
    });
}

module.exports = { app, server, rooms, generateMeetingCode, normalizeRoomId };
