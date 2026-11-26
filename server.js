/**
 * CallSummarizer - Production Unified Server
 * Serves the React 18 client, Cloudflare Turnstile & Google Auth APIs,
 * Room Management, NLP Task Extraction, and Room-aware WebRTC Signaling.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { extractLocalTasks, generateLocalSummary } = require('./services/nlp-task-service/index');

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
app.disable('x-powered-by');
app.set('trust proxy', 1);
const PORT = process.env.PORT || 8080;
const IS_PROD = process.env.NODE_ENV === 'production';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const TURNSTILE_SITE_KEY = process.env.CLOUDFLARE_TURNSTILE_SITE_KEY || '';
const TURNSTILE_SECRET_KEY = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || '';
const ALLOWED_ORIGINS = new Set(
    String(process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
);

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Permissions-Policy', 'geolocation=(), payment=(), usb=()');
    if (IS_PROD && (req.secure || req.headers['x-forwarded-proto'] === 'https')) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

app.use((req, res, next) => {
    const reqHost = req.get('host');
    return cors({
        origin: (origin, cb) => {
            if (!origin) return cb(null, true);
            if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
            try {
                const parsed = new URL(origin);
                if (reqHost && parsed.host === reqHost) return cb(null, true);
                if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
                    return cb(null, true);
                }
            } catch (e) {}
            return cb(null, false);
        },
        credentials: true
    })(req, res, next);
});
app.use(express.json({ limit: '15mb' }));

function createRateLimiter({ windowMs, max }) {
    const hits = new Map();
    return (req, res, next) => {
        const ip = req.ip || req.socket?.remoteAddress || 'unknown';
        const now = Date.now();
        let entry = hits.get(ip);
        if (!entry || now - entry.start > windowMs) {
            entry = { start: now, count: 0 };
        }
        entry.count += 1;
        hits.set(ip, entry);
        if (hits.size > 5000) {
            for (const [k, v] of hits.entries()) {
                if (now - v.start > windowMs) hits.delete(k);
            }
        }
        if (entry.count > max) {
            return res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
        }
        return next();
    };
}

const authRateLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 60 });
const aiRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60 });
const stemsRateLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 25 });

app.use('/api/auth', authRateLimiter);
app.use('/api/nlp-tasks', aiRateLimiter);
app.use('/api/transcribe-audio', aiRateLimiter);
app.use('/api/ai-vocal-coach', aiRateLimiter);
app.use('/api/sargam/separate-stems', stemsRateLimiter);
app.use('/api/sargam/separate-stems-file', stemsRateLimiter);
app.use('/api/sargam/upload-cookies', stemsRateLimiter);

const DEFAULT_SARGAM_BACKEND = (
    process.env.SARGAM_BACKEND_URL ||
    'https://khurana-aaa3--sargam-tuner-backend-fastapi-app.us-east.modal.run'
).replace(/\/$/, '');

const ALLOWED_SARGAM_HOSTS = new Set(
    [
        DEFAULT_SARGAM_BACKEND,
        'https://khurana-aaa3--sargam-tuner-backend-fastapi-app.us-east.modal.run'
    ].map((u) => {
        try {
            return new URL(u).origin;
        } catch (e) {
            return '';
        }
    }).filter(Boolean)
);

function resolveSargamBackend(requested) {
    if (requested && typeof requested === 'string') {
        try {
            const parsed = new URL(requested.trim());
            if (ALLOWED_SARGAM_HOSTS.has(parsed.origin)) {
                return parsed.origin;
            }
        } catch (e) {
            // Fall back to default backend
        }
    }
    return DEFAULT_SARGAM_BACKEND;
}

const TEN_DAYS_SECONDS = 10 * 24 * 60 * 60; // 10 days in seconds (864,000s)
const TEN_DAYS_MS = TEN_DAYS_SECONDS * 1000;
const SESSION_SECRET_FILE = path.join(__dirname, '.session_secret');

function resolveSessionSecret() {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    if (process.env.GOOGLE_CLIENT_SECRET) return process.env.GOOGLE_CLIENT_SECRET;
    try {
        if (fs.existsSync(SESSION_SECRET_FILE)) {
            const existing = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
            if (existing.length >= 32) return existing;
        }
        const generated = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(SESSION_SECRET_FILE, generated, { encoding: 'utf8', mode: 0o600 });
        return generated;
    } catch (e) {
        return crypto.randomBytes(32).toString('hex');
    }
}

const SESSION_SECRET = resolveSessionSecret();

// Persistent 10-day server session store: sessionId -> { sessionId, user, tokens, createdAt }
const sessions = new Map();
const revokedSessions = new Set();
const SESSIONS_FILE = path.join(__dirname, '.sessions.json');

function signSessionToken(sessionObj) {
    try {
        const payload = JSON.stringify({
            sessionId: sessionObj.sessionId,
            user: sessionObj.user,
            tokens: sessionObj.tokens || {},
            createdAt: sessionObj.createdAt || new Date().toISOString()
        });
        const encoded = Buffer.from(payload, 'utf8').toString('base64url');
        const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
        return `cs.${encoded}.${sig}`;
    } catch (e) {
        return sessionObj.sessionId;
    }
}

function verifyAndRestoreSessionToken(tokenStr) {
    if (!tokenStr || typeof tokenStr !== 'string' || !tokenStr.startsWith('cs.')) {
        return null;
    }
    if (revokedSessions.has(tokenStr)) return null;
    const parts = tokenStr.split('.');
    if (parts.length !== 3) return null;
    const [, encoded, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
    const sigBuf = Buffer.from(sig, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        return null;
    }

    try {
        const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (!decoded || !decoded.sessionId || !decoded.user) return null;
        if (revokedSessions.has(decoded.sessionId)) return null;
        const age = Date.now() - new Date(decoded.createdAt).getTime();
        if (age >= TEN_DAYS_MS) return null;

        // Restore into active in-memory session map so subsequent requests are fast
        decoded.token = tokenStr;
        sessions.set(decoded.sessionId, decoded);
        sessions.set(tokenStr, decoded);
        return decoded;
    } catch (e) {
        return null;
    }
}

function setSessionCookie(res, req, sessionId, expires = null) {
    const isSecure = process.env.NODE_ENV === 'production' || Boolean(req?.secure) || req?.headers?.['x-forwarded-proto'] === 'https';
    if (!sessionId) {
        const clearCookie = `cs_session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${isSecure ? '; Secure' : ''}`;
        res.setHeader('Set-Cookie', clearCookie);
        return;
    }
    const tokenVal = sessions.get(sessionId)?.token || sessionId;
    const expiresDate = expires || new Date(Date.now() + TEN_DAYS_MS).toUTCString();
    let cookie = `cs_session_id=${tokenVal}; Path=/; Max-Age=${TEN_DAYS_SECONDS}; Expires=${expiresDate}; HttpOnly; SameSite=Lax`;
    if (isSecure) {
        cookie += '; Secure';
    }
    res.setHeader('Set-Cookie', cookie);
}

// In-memory store for active rooms
const rooms = new Map();
const ROOM_EMPTY_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes before deleting notes & actions of an empty room

function loadSessionsFromDisk() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
            const data = JSON.parse(raw);
            const now = Date.now();
            if (Array.isArray(data)) {
                for (const item of data) {
                    if (item && item.sessionId && item.createdAt) {
                        const age = now - new Date(item.createdAt).getTime();
                        if (age < TEN_DAYS_MS) {
                            sessions.set(item.sessionId, item);
                            if (item.token) {
                                sessions.set(item.token, item);
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        // Safe fallback
    }
}

function saveSessionsToDisk() {
    try {
        const unique = new Map();
        for (const s of sessions.values()) {
            if (s && s.sessionId) unique.set(s.sessionId, s);
        }
        const arr = Array.from(unique.values());
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(arr, null, 2), { encoding: 'utf8', mode: 0o600 });
    } catch (e) {
        // Safe fallback
    }
}

loadSessionsFromDisk();

function getSession(req) {
    if (!req) return null;

    // Never accept session IDs from URL query strings to avoid log/Referer leakage
    const candidates = [
        req.headers ? req.headers['x-session-id'] : null,
        req.headers ? req.headers['x-session-token'] : null,
        (req.headers?.authorization?.startsWith('Bearer ')) ? req.headers.authorization.slice(7).trim() : null,
        req.headers?.cookie ? (req.headers.cookie.match(/cs_session_id=([^;]+)/)?.[1] || null) : null,
        req.body?.sessionToken,
        req.body?.sessionId
    ].filter(Boolean);

    for (const cand of candidates) {
        if (revokedSessions.has(cand)) continue;
        if (sessions.has(cand)) {
            const s = sessions.get(cand);
            if (revokedSessions.has(s.sessionId) || (s.token && revokedSessions.has(s.token))) {
                continue;
            }
            return s;
        }
        const restored = verifyAndRestoreSessionToken(cand);
        if (restored) {
            if (revokedSessions.has(restored.sessionId) || (restored.token && revokedSessions.has(restored.token))) {
                continue;
            }
            return restored;
        }
    }
    return null;
}

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

function createDefaultJamState() {
    return {
        tonicMidi: 60, // C4
        raga: 'All Notes',
        tuningMode: 'et',
        langMode: 'en',
        isTanpuraOn: false,
        tanpuraVol: 0.45,
        taal: '4/4 Studio Click',
        bpm: 96,
        isMetronomeOn: false,
        updatedAt: Date.now()
    };
}

function createDefaultBackingState() {
    return {
        title: '',
        vocalUrl: '',
        instUrl: '',
        isPlaying: false,
        currentTime: 0,
        vocalVol: 0.85,
        instVol: 0.75,
        playbackSeq: 0,
        noteBars: [],
        lyrics: [],
        updatedAt: Date.now()
    };
}

function getOrCreateRoom(roomId, hostName = 'Host') {
    const normalized = normalizeRoomId(roomId);
    if (!rooms.has(normalized)) {
        rooms.set(normalized, {
            roomId: normalized,
            host: hostName,
            leaderPeerId: null,
            createdAt: new Date().toISOString(),
            participants: new Map(),
            transcript: [],
            tasks: [],
            sharedAudioFiles: new Map(),
            jamState: createDefaultJamState(),
            backingState: createDefaultBackingState(),
            emptySince: null,
            cleanupTimer: null
        });
    }
    const room = rooms.get(normalized);
    if (room.cleanupTimer) {
        clearTimeout(room.cleanupTimer);
        room.cleanupTimer = null;
    }
    room.emptySince = null;
    return room;
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
    if (!token || typeof token !== 'string' || !token.trim()) {
        return res.status(400).json({ verified: false, error: 'Missing Turnstile token' });
    }

    if (token === 'turnstile_fallback_token') {
        if (process.env.NODE_ENV === 'production') {
            return res.status(400).json({ verified: false, error: 'Fallback token not allowed in production' });
        }
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
        return res.json({ verified: false, error: 'Invalid Turnstile token' });
    } catch (err) {
        return res.status(502).json({ verified: false, error: 'Turnstile verification network error' });
    }
});

// Google Authentication verification / user profile endpoint
app.post('/api/auth/google', async (req, res) => {
    const { credential, accessToken, name, email, picture } = req.body || {};

    try {
        const authenticatedSession = getSession(req);

        // Case 1: Google ID Token JWT (from Google Identity Services button / One Tap)
        if (credential && typeof credential === 'string' && credential.split('.').length === 3) {
            let decoded = null;
            if (process.env.NODE_ENV === 'production') {
                try {
                    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
                    if (!verifyRes.ok) {
                        return res.status(401).json({ authenticated: false, error: 'Invalid Google ID token signature' });
                    }
                    const info = await verifyRes.json();
                    if (GOOGLE_CLIENT_ID && info.aud !== GOOGLE_CLIENT_ID) {
                        return res.status(401).json({ authenticated: false, error: 'Google token audience mismatch' });
                    }
                    if (info.email_verified !== true && info.email_verified !== 'true') {
                        return res.status(401).json({ authenticated: false, error: 'Google email is not verified' });
                    }
                    if (info.exp && Number(info.exp) * 1000 <= Date.now()) {
                        return res.status(401).json({ authenticated: false, error: 'Google ID token expired' });
                    }
                    decoded = info;
                } catch (e) {
                    return res.status(502).json({ authenticated: false, error: 'Failed to verify Google ID token' });
                }
            } else {
                const payloadBase64 = credential.split('.')[1];
                decoded = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
            }

            const userName = decoded.name || decoded.given_name || 'Google User';
            const userEmail = (decoded.email || '').trim().toLowerCase();
            if (!userEmail) {
                return res.status(401).json({ authenticated: false, error: 'Google token missing verified email' });
            }
            const userId = decoded.sub || crypto.randomUUID();
            const canReuseSession = authenticatedSession && authenticatedSession.user?.email === userEmail;
            const existingTokens = canReuseSession ? (authenticatedSession.tokens || {}) : {};
            const sessionId = canReuseSession ? authenticatedSession.sessionId : crypto.randomUUID();

            const userObj = {
                id: userId,
                name: userName,
                email: userEmail,
                picture: decoded.picture || '',
                initials: getInitials(userName),
                sessionId
            };

            const sessionObj = {
                sessionId,
                user: userObj,
                tokens: {
                    ...existingTokens,
                    idToken: credential,
                    accessToken: accessToken || existingTokens.accessToken || null,
                    scope: existingTokens.scope || 'openid email profile https://www.googleapis.com/auth/calendar.events'
                },
                createdAt: canReuseSession ? authenticatedSession.createdAt : new Date().toISOString()
            };
            const sessionToken = signSessionToken(sessionObj);
            sessionObj.token = sessionToken;
            userObj.sessionId = sessionId;
            userObj.sessionToken = sessionToken;
            sessions.set(sessionId, sessionObj);
            sessions.set(sessionToken, sessionObj);
            saveSessionsToDisk();

            setSessionCookie(res, req, sessionToken);
            return res.json({
                authenticated: true,
                provider: 'google-jwt',
                sessionId,
                sessionToken,
                user: userObj
            });
        }

        // Case 2: Google OAuth2 Access Token (from google.accounts.oauth2.initTokenClient)
        if (accessToken && typeof accessToken === 'string') {
            let userName = 'Google User';
            let userEmail = '';
            let userPicture = '';
            let userId = crypto.randomUUID();

            if (process.env.NODE_ENV !== 'production' && (accessToken.startsWith('mock-') || accessToken === 'test-access-token')) {
                userName = name || 'Google User';
                userEmail = (email || 'user@gmail.com').trim().toLowerCase();
                userPicture = picture || '';
            } else {
                try {
                    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                        headers: { Authorization: `Bearer ${accessToken}` }
                    });
                    if (!userRes.ok) {
                        return res.status(401).json({
                            authenticated: false,
                            error: 'Invalid or expired Google access token'
                        });
                    }
                    const profile = await userRes.json();
                    userName = profile.name || profile.given_name || 'Google User';
                    userEmail = (profile.email || '').trim().toLowerCase();
                    userPicture = profile.picture || '';
                    userId = profile.sub || userId;
                } catch (e) {
                    return res.status(502).json({
                        authenticated: false,
                        error: 'Failed to verify Google access token with Google API'
                    });
                }
            }

            if (!userEmail) {
                return res.status(400).json({
                    authenticated: false,
                    error: 'Unable to retrieve verified email from Google account'
                });
            }

            const canReuseSession = authenticatedSession && authenticatedSession.user?.email === userEmail;
            const existingTokens = canReuseSession ? (authenticatedSession.tokens || {}) : {};
            const sessionId = canReuseSession ? authenticatedSession.sessionId : crypto.randomUUID();
            const userObj = {
                id: userId,
                name: userName,
                email: userEmail,
                picture: userPicture,
                initials: getInitials(userName),
                sessionId
            };

            const sessionObj = {
                sessionId,
                user: userObj,
                tokens: {
                    ...existingTokens,
                    accessToken,
                    scope: 'openid email profile https://www.googleapis.com/auth/calendar.events'
                },
                createdAt: canReuseSession ? authenticatedSession.createdAt : new Date().toISOString()
            };
            const sessionToken = signSessionToken(sessionObj);
            sessionObj.token = sessionToken;
            userObj.sessionId = sessionId;
            userObj.sessionToken = sessionToken;
            sessions.set(sessionId, sessionObj);
            sessions.set(sessionToken, sessionObj);
            saveSessionsToDisk();

            setSessionCookie(res, req, sessionToken);
            return res.json({
                authenticated: true,
                provider: 'google-oauth',
                sessionId,
                sessionToken,
                user: userObj
            });
        }

        // Case 3: Direct profile sign-in (only when Google OAuth client isn't enforcing Google identity in prod)
        if (name && email) {
            if (process.env.NODE_ENV === 'production' && GOOGLE_CLIENT_ID && process.env.ALLOW_DEV_LOGIN !== 'true') {
                return res.status(401).json({
                    authenticated: false,
                    error: 'Google OAuth verification is required in production'
                });
            }
            const cleanName = String(name).trim().slice(0, 80);
            const cleanEmail = String(email).trim().toLowerCase();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!cleanName || !emailRegex.test(cleanEmail)) {
                return res.status(400).json({
                    authenticated: false,
                    error: 'Invalid Google email address format'
                });
            }

            const canReuseSession = authenticatedSession && authenticatedSession.user?.email === cleanEmail;
            const existingTokens = canReuseSession ? (authenticatedSession.tokens || {}) : {};
            const sessionId = canReuseSession ? authenticatedSession.sessionId : crypto.randomUUID();
            const userId = crypto.createHash('sha256').update(cleanEmail).digest('hex').slice(0, 16);

            const userObj = {
                id: userId,
                name: cleanName,
                email: cleanEmail,
                picture: picture || '',
                initials: getInitials(cleanName),
                sessionId
            };

            const sessionObj = {
                sessionId,
                user: userObj,
                tokens: {
                    ...existingTokens,
                    accessToken: accessToken || existingTokens.accessToken || (!IS_PROD ? 'mock-calendar-token' : null),
                    scope: 'openid email profile https://www.googleapis.com/auth/calendar.events'
                },
                createdAt: canReuseSession ? authenticatedSession.createdAt : new Date().toISOString()
            };
            const sessionToken = signSessionToken(sessionObj);
            sessionObj.token = sessionToken;
            userObj.sessionId = sessionId;
            userObj.sessionToken = sessionToken;
            sessions.set(sessionId, sessionObj);
            sessions.set(sessionToken, sessionObj);
            saveSessionsToDisk();

            setSessionCookie(res, req, sessionToken);
            return res.json({
                authenticated: true,
                provider: 'google-account',
                sessionId,
                sessionToken,
                user: userObj
            });
        }

        return res.status(400).json({ authenticated: false, error: 'Invalid Google credentials provided' });
    } catch (err) {
        return res.status(500).json({ authenticated: false, error: 'Authentication failed' });
    }
});

function getGoogleRedirectUri(req) {
    if (process.env.PUBLIC_BASE_URL) {
        return `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/auth/google/callback`;
    }
    const forwardedProto = req.headers['x-forwarded-proto']
        ? String(req.headers['x-forwarded-proto']).split(',')[0].trim().toLowerCase()
        : '';
    const proto = (forwardedProto === 'http' || forwardedProto === 'https') ? forwardedProto : (req.protocol === 'https' ? 'https' : 'http');
    const rawHost = String(req.get('host') || 'localhost:8080').trim();
    const safeHost = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(rawHost) ? rawHost : 'localhost:8080';
    return `${proto}://${safeHost}/api/auth/google/callback`;
}

// Server-side Google OAuth2 authorization URL initiation
app.get('/api/auth/google/url', (req, res) => {
    const redirectUri = getGoogleRedirectUri(req);
    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID || 'dummy-google-client-id',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile https://www.googleapis.com/auth/calendar.events',
        access_type: 'offline',
        prompt: 'consent'
    });
    return res.json({
        url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
        redirectUri
    });
});

// Direct browser redirect to Google OAuth2 consent screen
app.get('/api/auth/google/login', (req, res) => {
    const redirectUri = getGoogleRedirectUri(req);
    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID || 'dummy-google-client-id',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile https://www.googleapis.com/auth/calendar.events',
        access_type: 'offline',
        prompt: 'consent'
    });
    return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// Server-side Google OAuth2 code exchange (if redirect flow is used)
app.get('/api/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.redirect('/?authError=missing_code');
    }
    try {
        const redirectUri = getGoogleRedirectUri(req);
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
        if (tokenData.id_token || tokenData.access_token) {
            const sessionId = crypto.randomUUID();
            let userObj = null;

            if (tokenData.id_token && tokenData.id_token.split('.').length === 3) {
                try {
                    const payloadBase64 = tokenData.id_token.split('.')[1];
                    const decoded = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
                    const userName = decoded.name || decoded.given_name || 'Google User';
                    userObj = {
                        id: decoded.sub || crypto.randomUUID(),
                        name: userName,
                        email: decoded.email || '',
                        picture: decoded.picture || '',
                        initials: getInitials(userName),
                        sessionId
                    };
                } catch (e) {}
            }

            if (!userObj && tokenData.access_token) {
                try {
                    const uRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                        headers: { Authorization: `Bearer ${tokenData.access_token}` }
                    });
                    if (uRes.ok) {
                        const prof = await uRes.json();
                        const userName = prof.name || prof.given_name || 'Google User';
                        userObj = {
                            id: prof.sub || crypto.randomUUID(),
                            name: userName,
                            email: prof.email || '',
                            picture: prof.picture || '',
                            initials: getInitials(userName),
                            sessionId
                        };
                    }
                } catch (e) {}
            }

            if (!userObj) {
                userObj = {
                    id: crypto.randomUUID(),
                    name: 'Google User',
                    email: 'user@gmail.com',
                    picture: '',
                    initials: 'GU',
                    sessionId
                };
            }

            const sessionObj = {
                sessionId,
                user: userObj,
                tokens: {
                    accessToken: tokenData.access_token || null,
                    refreshToken: tokenData.refresh_token || null,
                    idToken: tokenData.id_token || null,
                    scope: tokenData.scope || 'openid email profile https://www.googleapis.com/auth/calendar.events'
                },
                createdAt: new Date().toISOString()
            };
            const sessionToken = signSessionToken(sessionObj);
            sessionObj.token = sessionToken;
            userObj.sessionToken = sessionToken;
            sessions.set(sessionId, sessionObj);
            sessions.set(sessionToken, sessionObj);
            saveSessionsToDisk();
            setSessionCookie(res, req, sessionToken);
            return res.redirect('/?googleAuth=1');
        }
        return res.redirect('/?authError=token_exchange_failed');
    } catch (err) {
        return res.redirect('/?authError=oauth_exception');
    }
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
    const session = getSession(req);
    if (!session) {
        setSessionCookie(res, req, '', 'Thu, 01 Jan 1970 00:00:00 GMT');
        return res.status(IS_PROD ? 401 : 200).json({ success: !IS_PROD });
    }
    const targetSessionId = session.sessionId;
    if (targetSessionId) {
        revokedSessions.add(targetSessionId);
        if (sessions.has(targetSessionId)) {
            const sess = sessions.get(targetSessionId);
            if (sess?.token) revokedSessions.add(sess.token);
            if (sess?.sessionId) revokedSessions.add(sess.sessionId);
            sessions.delete(targetSessionId);
            if (sess?.token) sessions.delete(sess.token);
        }
        saveSessionsToDisk();
    }
    if (session?.token) revokedSessions.add(session.token);
    setSessionCookie(res, req, '', 'Thu, 01 Jan 1970 00:00:00 GMT');
    return res.json({ success: true });
});

// Session verification route
app.get('/api/auth/session', (req, res) => {
    const session = getSession(req);
    if (!session) {
        return res.status(401).json({ authenticated: false, error: 'No active session found' });
    }
    return res.json({
        authenticated: true,
        sessionId: session.sessionId,
        sessionToken: session.token || session.sessionId,
        user: session.user,
        hasCalendarAccess: Boolean(session.tokens?.accessToken)
    });
});

// Safely extract explicit time (e.g. "at 2 pm", "2:30 pm", "2.30 pm", "14:00", "at 5")
function extractTimeDetails(str) {
    if (!str || typeof str !== 'string') return null;
    const ampmMatch = str.match(/\b(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i);
    if (ampmMatch) {
        let hour = parseInt(ampmMatch[1], 10);
        const minute = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
        const period = ampmMatch[3].toLowerCase();
        if (period === 'pm' && hour < 12) hour += 12;
        if (period === 'am' && hour === 12) hour = 0;
        return { hour, minute };
    }
    const milMatch = str.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i);
    if (milMatch) {
        return { hour: parseInt(milMatch[1], 10), minute: parseInt(milMatch[2], 10) };
    }
    const bareHourMatch = str.match(/\bat\s+(\d{1,2})\b/i);
    if (bareHourMatch) {
        let hour = parseInt(bareHourMatch[1], 10);
        if (hour >= 1 && hour <= 7) hour += 12;
        if (hour >= 0 && hour <= 23) return { hour, minute: 0 };
    }
    return null;
}

function getTimezoneOffsetString(timeZone, date = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            timeZoneName: 'shortOffset'
        }).formatToParts(date);
        const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT';
        const match = tzPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
        if (!match) return '+00:00';
        const sign = match[1];
        const h = match[2].padStart(2, '0');
        const m = (match[3] || '00').padStart(2, '0');
        return `${sign}${h}:${m}`;
    } catch (e) {
        return '+00:00';
    }
}

function getLocalDateString(timeZone, daysToAdd = 0) {
    try {
        const target = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);
        const fmt = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        return fmt.format(target);
    } catch (e) {
        const d = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);
        return d.toISOString().split('T')[0];
    }
}

function formatRfc3339(date, timeZone = 'UTC') {
    if (!date) return new Date().toISOString();
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return new Date().toISOString();
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const parts = formatter.formatToParts(d);
        const getPart = (type) => parts.find((p) => p.type === type)?.value || '00';
        const YYYY = getPart('year').padStart(4, '0');
        const MM = getPart('month');
        const DD = getPart('day');
        let HH = getPart('hour');
        if (HH === '24') HH = '00';
        const mm = getPart('minute');
        const ss = getPart('second');
        const offset = getTimezoneOffsetString(timeZone, d);
        return `${YYYY}-${MM}-${DD}T${HH}:${mm}:${ss}${offset}`;
    } catch (e) {
        try {
            return d.toISOString();
        } catch (err) {
            return new Date().toISOString();
        }
    }
}

// Safely parse event start and end times from startTime, endTime, natural due strings, title, and description
function parseEventDates(startTime, endTime, due, title = '', description = '', timeZone = 'UTC') {
    let startDateTime = null;
    let endDateTime = null;

    if (startTime) {
        const parsedStart = new Date(startTime);
        if (!isNaN(parsedStart.getTime()) && parsedStart.getFullYear() >= 1970 && parsedStart.getFullYear() < 2100) {
            startDateTime = parsedStart;
        }
    }

    const combinedText = `${due || ''} ${title || ''} ${description || ''}`.trim();
    const explicitTime = extractTimeDetails(combinedText);

    if (!startDateTime && due) {
        if (typeof due === 'number') {
            const parsedDue = new Date(due);
            if (!isNaN(parsedDue.getTime()) && parsedDue.getFullYear() >= 1970 && parsedDue.getFullYear() < 2100) startDateTime = parsedDue;
        } else if (typeof due === 'string') {
            const trimmedDue = due.trim();
            const lowerDue = trimmedDue.toLowerCase();
            const directParsed = new Date(trimmedDue);
            if (!isNaN(directParsed.getTime()) && directParsed.getFullYear() >= 1970 && directParsed.getFullYear() < 2100 && !/^\d{1,2}(:\d{2})?\s*(am|pm)?$/i.test(trimmedDue)) {
                startDateTime = directParsed;
            } else {
                let daysToAdd = 0;
                let dayMatched = false;
                if (lowerDue.includes('tomorrow')) {
                    daysToAdd = 1;
                    dayMatched = true;
                } else if (lowerDue.includes('today')) {
                    daysToAdd = 0;
                    dayMatched = true;
                } else {
                    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                    const matchedDay = days.findIndex((d) => lowerDue.includes(d));
                    if (matchedDay !== -1) {
                        const nowInTz = new Date();
                        const currentDay = nowInTz.getDay();
                        daysToAdd = (matchedDay - currentDay + 7) % 7;
                        if (daysToAdd === 0) daysToAdd = 7;
                        dayMatched = true;
                    }
                }

                if (dayMatched || explicitTime) {
                    const dateStr = getLocalDateString(timeZone, daysToAdd);
                    const offsetStr = getTimezoneOffsetString(timeZone);
                    const pad = (n) => String(n).padStart(2, '0');
                    const targetHour = explicitTime ? explicitTime.hour : 10;
                    const targetMinute = explicitTime ? explicitTime.minute : 0;
                    const rfcString = `${dateStr}T${pad(targetHour)}:${pad(targetMinute)}:00${offsetStr}`;
                    startDateTime = new Date(rfcString);
                }
            }
        }
    }

    if (!startDateTime && explicitTime) {
        const dateStr = getLocalDateString(timeZone, 0);
        const offsetStr = getTimezoneOffsetString(timeZone);
        const pad = (n) => String(n).padStart(2, '0');
        const rfcString = `${dateStr}T${pad(explicitTime.hour)}:${pad(explicitTime.minute)}:00${offsetStr}`;
        let parsed = new Date(rfcString);
        if (parsed.getTime() <= Date.now()) {
            const tomorrowStr = getLocalDateString(timeZone, 1);
            parsed = new Date(`${tomorrowStr}T${pad(explicitTime.hour)}:${pad(explicitTime.minute)}:00${offsetStr}`);
        }
        startDateTime = parsed;
    }

    if (!startDateTime || isNaN(startDateTime.getTime())) {
        const tomorrowStr = getLocalDateString(timeZone, 1);
        const offsetStr = getTimezoneOffsetString(timeZone);
        startDateTime = new Date(`${tomorrowStr}T10:00:00${offsetStr}`);
        if (isNaN(startDateTime.getTime())) {
            startDateTime = new Date();
        }
    }

    if (endTime) {
        const parsedEnd = new Date(endTime);
        if (!isNaN(parsedEnd.getTime()) && parsedEnd.getFullYear() >= 1970 && parsedEnd.getFullYear() < 2100) {
            endDateTime = parsedEnd;
        }
    }

    // Ensure endDateTime is strictly after startDateTime
    if (!endDateTime || isNaN(endDateTime.getTime()) || endDateTime.getTime() <= startDateTime.getTime()) {
        endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); // 1 hour duration
    }

    return { startDateTime, endDateTime, hasExplicitTime: Boolean(startTime || explicitTime) };
}

// Google Calendar Event Creation with 5-minute popup notification reminder
app.post('/api/calendar/events', async (req, res) => {
    try {
        const { title, description, due, startTime, endTime, timeZone: requestedTimeZone, requireTime } = req.body || {};

        if (!title || !String(title).trim()) {
            return res.status(400).json({ success: false, error: 'Event title is required' });
        }

        const session = getSession(req);
        const bearerToken = req.headers?.authorization?.startsWith('Bearer ')
            ? req.headers.authorization.slice(7).trim()
            : null;
        const accessToken = session?.tokens?.accessToken
            || req.body?.accessToken
            || (bearerToken && !sessions.has(bearerToken) ? bearerToken : null);

        if (!accessToken) {
            return res.status(401).json({
                success: false,
                needsCalendarAuth: true,
                error: 'Google Calendar authorization required. Please sign in with Google to grant calendar access.'
            });
        }

        const rawTimeZone = (requestedTimeZone && typeof requestedTimeZone === 'string' && requestedTimeZone.trim())
            ? requestedTimeZone.trim()
            : (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

        let timeZone = 'UTC';
        try {
            Intl.DateTimeFormat(undefined, { timeZone: rawTimeZone });
            timeZone = rawTimeZone;
        } catch (tzErr) {
            timeZone = 'UTC';
        }

        const { startDateTime, endDateTime, hasExplicitTime } = parseEventDates(startTime, endTime, due, title, description, timeZone);

        if (requireTime && !hasExplicitTime) {
            return res.status(400).json({
                success: false,
                error: 'Cannot add to Google Calendar: No time specified for this task'
            });
        }

        const cleanSummary = String(title).trim().slice(0, 1000);
        const eventPayload = {
            summary: cleanSummary,
            description: description ? String(description).trim() : `Action item from CallSummarizer meeting: ${cleanSummary}`,
            start: {
                dateTime: formatRfc3339(startDateTime, timeZone),
                timeZone
            },
            end: {
                dateTime: formatRfc3339(endDateTime, timeZone),
                timeZone
            },
            reminders: {
                useDefault: false,
                overrides: [
                    {
                        method: 'popup',
                        minutes: 5
                    }
                ]
            }
        };

        // Explicit mock errors & simulated events allowed strictly outside production
        if (!IS_PROD) {
            if (accessToken === 'mock-fail' || accessToken === 'mock-expired') {
                return res.status(401).json({
                    success: false,
                    error: 'Google Calendar API error: User calendar access revoked or expired'
                });
            }
            if (accessToken === 'mock-forbidden' || accessToken === 'mock-insufficient-scopes') {
                return res.status(403).json({
                    success: false,
                    error: 'Google Calendar API error: Insufficient permissions to create calendar events'
                });
            }
            if (accessToken.startsWith('mock-') || accessToken === 'test-access-token') {
                const gcalStart = startDateTime.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
                const gcalEnd = endDateTime.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
                const templateUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(eventPayload.summary)}&dates=${gcalStart}/${gcalEnd}&details=${encodeURIComponent(eventPayload.description + '\n\nAlarm: 5-minute popup reminder')}`;
                return res.status(201).json({
                    success: true,
                    mode: 'simulated',
                    event: {
                        id: 'cal-event-' + Date.now(),
                        htmlLink: templateUrl,
                        summary: eventPayload.summary,
                        description: eventPayload.description,
                        start: eventPayload.start,
                        end: eventPayload.end,
                        reminders: eventPayload.reminders
                    }
                });
            }
        }

        let activeToken = accessToken;
        let gCalRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${activeToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(eventPayload)
        });

        // If access token expired and a refresh token is stored in the session, attempt token refresh
        if (gCalRes.status === 401 && session?.tokens?.refreshToken && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
            try {
                const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id: GOOGLE_CLIENT_ID,
                        client_secret: GOOGLE_CLIENT_SECRET,
                        refresh_token: session.tokens.refreshToken,
                        grant_type: 'refresh_token'
                    }).toString()
                });
                if (refreshRes.ok) {
                    const refreshedData = await refreshRes.json();
                    if (refreshedData.access_token) {
                        activeToken = refreshedData.access_token;
                        if (session.tokens) {
                            session.tokens.accessToken = activeToken;
                        }
                        // Retry calendar event creation with fresh token
                        gCalRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${activeToken}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(eventPayload)
                        });
                    }
                }
            } catch (refreshErr) {
                // Proceed to error response if refresh fails
            }
        }

        const gCalData = await gCalRes.json().catch(() => ({}));

        if (!gCalRes.ok) {
            const errorMsg =
                (typeof gCalData.error === 'object' ? gCalData.error?.message : gCalData.error_description || gCalData.error) ||
                'Failed to create Google Calendar event';
            const needsAuth = gCalRes.status === 401 || gCalRes.status === 403;
            return res.status(gCalRes.status >= 400 && gCalRes.status < 500 ? gCalRes.status : 502).json({
                success: false,
                needsCalendarAuth: needsAuth,
                error: `Google Calendar API error: ${errorMsg}`
            });
        }

        return res.status(201).json({
            success: true,
            event: {
                id: gCalData.id,
                htmlLink: gCalData.htmlLink,
                summary: gCalData.summary,
                start: gCalData.start,
                end: gCalData.end,
                reminders: gCalData.reminders
            }
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: `Error processing Google Calendar request: ${err.message}`
        });
    }
});

function sanitizePublicParticipant(p) {
    if (!p) return null;
    const { email: _omitEmail, sessionId: _omitSid, ...safe } = p;
    return safe;
}

// Meeting Service routes
app.get('/api/rooms/:id', (req, res) => {
    const normalized = normalizeRoomId(req.params.id);
    if (!rooms.has(normalized)) {
        return res.status(404).json({ error: 'Room not found' });
    }
    const room = rooms.get(normalized);
    // If the room has been empty for >= 5 minutes, clear transcript and tasks
    if (room.participants.size === 0 && room.emptySince && (Date.now() - room.emptySince >= ROOM_EMPTY_EXPIRY_MS)) {
        room.transcript = [];
        room.tasks = [];
        room.summary = [];
        if (room.cleanupTimer) {
            clearTimeout(room.cleanupTimer);
            room.cleanupTimer = null;
        }
    }
    const activeParticipants = Array.from(room.participants.values()).map(sanitizePublicParticipant);
    res.json({
        roomId: room.roomId,
        host: room.host,
        participants: activeParticipants,
        participantCount: activeParticipants.length,
        transcript: room.transcript,
        tasks: room.tasks,
        summary: room.summary || [],
        jamState: room.jamState || createDefaultJamState(),
        backingState: room.backingState || createDefaultBackingState(),
        status: 'active',
        createdAt: room.createdAt
    });
});

// Explicit session wipe endpoint to remove older transcripts and tasks for a room
app.delete('/api/rooms/:id/session', (req, res) => {
    if (process.env.NODE_ENV === 'production' && !getSession(req)) {
        return res.status(401).json({ error: 'Authentication required to clear room session' });
    }
    const normalized = normalizeRoomId(req.params.id);
    if (rooms.has(normalized)) {
        const room = rooms.get(normalized);
        room.transcript = [];
        room.tasks = [];
        room.summary = [];
        broadcastToRoom(normalized, { type: 'room-session-cleared' });
    }
    res.json({ success: true, message: `Room ${normalized} session cleared` });
});

// Room-scoped shared audio relay for locally uploaded backing tracks when offline
app.post('/api/rooms/:id/shared-audio', express.raw({ type: '*/*', limit: '25mb' }), (req, res) => {
    const normalized = normalizeRoomId(req.params.id);
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Uploaded audio is empty.' });
    }
    const room = getOrCreateRoom(normalized);
    if (!room.sharedAudioFiles) room.sharedAudioFiles = new Map();
    // Retain at most 3 files per room to bound memory
    while (room.sharedAudioFiles.size >= 3) {
        const oldestKey = room.sharedAudioFiles.keys().next().value;
        room.sharedAudioFiles.delete(oldestKey);
    }
    const fileId = crypto.randomUUID().slice(0, 12);
    const mimeType = String(req.headers['content-type'] || 'audio/mpeg').split(';')[0].trim();
    room.sharedAudioFiles.set(fileId, { buffer: req.body, mimeType });
    return res.status(201).json({
        success: true,
        url: `/api/rooms/${encodeURIComponent(normalized)}/shared-audio/${fileId}`
    });
});

function sendBufferWithRange(req, res, buffer, mimeType) {
    const total = buffer.length;
    const range = req.headers.range;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', mimeType || 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (range) {
        const m = String(range).match(/bytes=(\d+)-(\d*)/);
        if (m) {
            const start = parseInt(m[1], 10);
            const rawEnd = m[2] ? parseInt(m[2], 10) : total - 1;
            if (!Number.isFinite(start) || start >= total || start < 0) {
                res.status(416);
                res.setHeader('Content-Range', `bytes */${total}`);
                return res.end();
            }
            const end = Math.min(total - 1, Math.max(start, rawEnd));
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
            res.setHeader('Content-Length', end - start + 1);
            return res.send(buffer.subarray(start, end + 1));
        }
    }
    res.setHeader('Content-Length', total);
    return res.send(buffer);
}

app.get('/api/rooms/:id/shared-audio/:fileId', (req, res) => {
    const normalized = normalizeRoomId(req.params.id);
    const room = rooms.get(normalized);
    const entry = room?.sharedAudioFiles?.get(String(req.params.fileId || ''));
    if (!entry) {
        return res.status(404).json({ error: 'Shared audio not found' });
    }
    return sendBufferWithRange(req, res, entry.buffer, entry.mimeType);
});

app.post('/api/rooms', async (req, res) => {
    const session = getSession(req);
    const turnstileToken = req.body?.turnstileToken || req.body?.token || req.headers?.['x-turnstile-token'];

    let isTurnstileValid = false;
    if (turnstileToken && typeof turnstileToken === 'string') {
        if (turnstileToken === 'turnstile_fallback_token') {
            if (process.env.NODE_ENV !== 'production') {
                isTurnstileValid = true;
            }
        } else if (TURNSTILE_SECRET_KEY) {
            try {
                const params = new URLSearchParams();
                params.append('secret', TURNSTILE_SECRET_KEY);
                params.append('response', turnstileToken);
                const cfRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });
                const data = await cfRes.json();
                if (data.success) {
                    isTurnstileValid = true;
                }
            } catch (e) {
                // Ignore verification network error
            }
        }
    }

    if (!session && !isTurnstileValid) {
        return res.status(401).json({
            error: 'Authentication or Turnstile verification required to create a room'
        });
    }

    const { roomId, host } = req.body || {};
    const hostName = session?.user?.name || host || 'Host';
    const targetCode = roomId ? normalizeRoomId(roomId) : generateMeetingCode();
    const room = getOrCreateRoom(targetCode, hostName);
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
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Invalid request body' });
    }
    const { transcript, roomId } = req.body;

    if (transcript !== undefined && transcript !== null && typeof transcript !== 'string') {
        return res.status(400).json({ error: 'Transcript must be a string' });
    }

    if (!transcript || !String(transcript).trim()) {
        return res.json({ tasks: [], source: 'empty-transcript' });
    }

    const cleanTranscript = String(transcript).trim().slice(0, 50000);
    const reqGeminiKey = req.headers['x-gemini-api-key'] || req.body?.geminiApiKey;
    const envGeminiKey = Date.now() > geminiEnvDisabledUntil ? process.env.GEMINI_API_KEY : '';
    const geminiKey = reqGeminiKey || envGeminiKey;

    if (geminiKey) {
        const candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-3-flash-preview'];
        for (const modelName of candidateModels) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;
                const prompt = `You are an expert meeting assistant. Extract all action items, commitments, and a 2-bullet summary from the following meeting transcript.

Transcript:
${cleanTranscript}

Guidelines:
- Identify who is assigned to do what (assignee), the clear concise action/task (title), and any due date or exact time mentioned (due).
- If speaker says "Alice, please send the stems today at 1:00 pm", extract title "Send stems", assignee "Alice", due "Today at 1:00 PM".
- Include a 2-3 bullet "summary" array capturing key topics, decisions, and next steps.
- Return valid JSON matching this schema:
{
  "summary": ["Concise summary bullet 1", "Concise summary bullet 2"],
  "tasks": [
    {
      "title": "Clean concise action description",
      "assignee": "Person name or You",
      "due": "Due date/time string, e.g. Today at 1:00 PM, Tomorrow, or Upcoming"
    }
  ]
}`;
                const apiRes = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(25000),
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { responseMimeType: "application/json" }
                    })
                });

                if (apiRes.ok) {
                    const data = await apiRes.json();
                    const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (rawJson) {
                        const cleaned = rawJson.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
                        const parsed = JSON.parse(cleaned);
                        if (Array.isArray(parsed.tasks)) {
                            const normalizedTasks = parsed.tasks.map((t, idx) => {
                                let title = String(t.title || '').replace(/\b(?:the|a|an)\s+/ig, '').trim();
                                if (title) title = title.charAt(0).toUpperCase() + title.slice(1);
                                return {
                                    ...t,
                                    id: (t.id !== undefined && t.id !== null && String(t.id).trim() !== '')
                                        ? `${String(t.id)}-${idx + 1}`
                                        : `task-${Date.now()}-${idx + 1}`,
                                    title: title || t.title,
                                    assignee: (/rohan/i.test(t.assignee || '')) ? 'Rohan Sharma' : (t.assignee || 'You'),
                                    due: t.due || 'Upcoming',
                                    completed: Boolean(t.completed)
                                };
                            });
                            const summary = Array.isArray(parsed.summary) && parsed.summary.length > 0
                                ? parsed.summary
                                : generateLocalSummary(cleanTranscript, normalizedTasks);
                            if (roomId && rooms.has(roomId)) {
                                rooms.get(roomId).tasks = normalizedTasks;
                                rooms.get(roomId).summary = summary;
                            }
                            return res.json({ tasks: normalizedTasks, summary, source: modelName });
                        }
                    }
                } else if (apiRes.status === 401 || apiRes.status === 403) {
                    if (!reqGeminiKey) {
                        geminiEnvDisabledUntil = Date.now() + 5 * 60 * 1000;
                    }
                    break;
                }
            } catch (err) {
                // Try next candidate model
            }
        }
    }

    const rawTasks = extractLocalTasks(cleanTranscript);
    const seenIds = new Set();
    const tasks = rawTasks.map((t, idx) => {
        let id = (t.id !== undefined && t.id !== null && String(t.id).trim() !== '') ? String(t.id) : String(idx + 1);
        if (seenIds.has(id)) {
            id = `${id}-${idx + 1}`;
        }
        seenIds.add(id);
        return { ...t, id: String(id), completed: Boolean(t.completed) };
    });
    const summary = generateLocalSummary(cleanTranscript, tasks);
    if (roomId && rooms.has(roomId)) {
        rooms.get(roomId).tasks = tasks;
        rooms.get(roomId).summary = summary;
    }
    res.json({ tasks, summary, source: 'render-server-nlp' });
});

// Validates whether transcribed text is actual human speech rather than silence, timestamps, or artifacts
function isValidSpeechTranscript(text, speakerName = '') {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim().replace(/^["'`«»“”„]+|["'`«»“”„]+$/g, '').trim();
    if (!trimmed) return false;

    // Reject pure timestamps or time codes (e.g. "00:00", "00:01", "0:01", "00:00:00", "[00:00]")
    if (/^\[?\s*\d{1,2}:\d{2}(?::\d{2})?\s*\]?$/.test(trimmed)) return false;

    // Reject silence, audio indicators, or non-speech tags
    if (/^(silence|silent|none|empty|null|n\/a|audio|ambient|noise|blank|background noise|cough|throat clearing|applause|music|\.|\.\.\.)$/i.test(trimmed)) return false;
    if (/\bsilence\b/i.test(trimmed) && trimmed.length <= 15) return false;
    if (/^(\[.*\]|\(.*\))$/.test(trimmed)) return false;

    // Reject known hallucination artifacts
    if (/identify the root cause|first step is to identify|finished the presentation/i.test(trimmed)) return false;

    // Reject numbers/punctuation only (must have at least one 2+ letter word)
    if (!/[a-zA-Z]{2,}/.test(trimmed)) return false;

    // Reject repetition or echo of speaker name
    const cleanSpeaker = String(speakerName || '').trim();
    if (cleanSpeaker) {
        if (trimmed.toLowerCase() === cleanSpeaker.toLowerCase()) return false;
        const cleanAlpha = cleanSpeaker.toLowerCase().replace(/[^a-z0-9]/g, '');
        const textAlpha = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cleanAlpha && textAlpha === cleanAlpha) return false;
        if (cleanAlpha && (cleanAlpha.includes(textAlpha) || textAlpha.includes(cleanAlpha)) && textAlpha.length <= cleanAlpha.length + 3) return false;
    }

    return true;
}

let geminiEnvDisabledUntil = 0;
let whisperWorker = null;
let whisperWorkerReady = false;
let whisperWorkerDisabled = false;
let whisperWorkerBootPromise = null;
const whisperPendingRequests = new Map();

function ensureLocalWhisperWorker() {
    if (whisperWorkerDisabled) return Promise.resolve(false);
    if (whisperWorker && whisperWorkerReady && !whisperWorker.killed) {
        return Promise.resolve(true);
    }
    if (whisperWorkerBootPromise) return whisperWorkerBootPromise;

    const scriptPath = path.join(__dirname, 'services', 'stt-whisper-worker.py');
    if (!fs.existsSync(scriptPath)) {
        whisperWorkerDisabled = true;
        return Promise.resolve(false);
    }

    whisperWorkerBootPromise = new Promise((resolve) => {
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        let proc;
        try {
            proc = spawn(pythonCmd, [scriptPath], { stdio: ['pipe', 'pipe', 'ignore'] });
        } catch (err) {
            whisperWorkerDisabled = true;
            whisperWorkerBootPromise = null;
            return resolve(false);
        }

        whisperWorker = proc;
        proc.unref?.();
        proc.stdin?.unref?.();
        proc.stdout?.unref?.();
        let stdoutBuf = '';
        let bootSettled = false;

        const finishBoot = (ok) => {
            if (!bootSettled) {
                bootSettled = true;
                whisperWorkerReady = ok;
                if (!ok) whisperWorkerDisabled = true;
                whisperWorkerBootPromise = null;
                resolve(ok);
            }
        };

        const bootTimer = setTimeout(() => finishBoot(false), 15000);
        if (typeof bootTimer.unref === 'function') bootTimer.unref();

        // When worker closes on idle, clean up cleanly
        let idleTimer = null;
        const scheduleIdleShutdown = () => {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                if (whisperPendingRequests.size === 0) {
                    shutdownLocalWhisperWorker();
                }
            }, 45000);
            idleTimer.unref?.();
        };

        proc.stdout.on('data', (chunk) => {
            stdoutBuf += chunk.toString('utf8');
            let nlIdx;
            while ((nlIdx = stdoutBuf.indexOf('\n')) !== -1) {
                const line = stdoutBuf.slice(0, nlIdx).trim();
                stdoutBuf = stdoutBuf.slice(nlIdx + 1);
                if (!line) continue;
                try {
                    const msg = JSON.parse(line);
                    if (Object.prototype.hasOwnProperty.call(msg, 'ready')) {
                        clearTimeout(bootTimer);
                        scheduleIdleShutdown();
                        finishBoot(Boolean(msg.ready));
                        continue;
                    }
                    if (msg.id && whisperPendingRequests.has(msg.id)) {
                        const pending = whisperPendingRequests.get(msg.id);
                        whisperPendingRequests.delete(msg.id);
                        clearTimeout(pending.timer);
                        if (whisperPendingRequests.size === 0) scheduleIdleShutdown();
                        pending.resolve(msg);
                    }
                } catch (e) {}
            }
        });

        proc.on('error', () => {
            clearTimeout(bootTimer);
            finishBoot(false);
        });
        proc.on('exit', () => {
            clearTimeout(bootTimer);
            whisperWorkerReady = false;
            whisperWorker = null;
            whisperPendingRequests.forEach((pending) => {
                clearTimeout(pending.timer);
                pending.resolve({ text: '', error: 'Worker exited' });
            });
            whisperPendingRequests.clear();
            finishBoot(false);
        });
    });

    return whisperWorkerBootPromise;
}

async function transcribeWithLocalWhisper(audioBuffer, cleanMime) {
    const ok = await ensureLocalWhisperWorker();
    if (!ok || !whisperWorker || !whisperWorker.stdin.writable) return null;

    const ext = cleanMime.includes('mp4') ? '.mp4' : cleanMime.includes('wav') ? '.wav' : '.webm';
    const tmpFile = path.join(os.tmpdir(), `cs_snip_${crypto.randomUUID()}${ext}`);
    try {
        fs.writeFileSync(tmpFile, audioBuffer);
        const reqId = crypto.randomUUID();
        const result = await new Promise((resolve) => {
            const timer = setTimeout(() => {
                whisperPendingRequests.delete(reqId);
                resolve({ text: '', error: 'Local Whisper timeout' });
            }, 15000);
            whisperPendingRequests.set(reqId, { resolve, timer });
            whisperWorker.stdin.write(`${JSON.stringify({ id: reqId, path: tmpFile })}\n`);
        });
        if (result && typeof result.text === 'string' && !result.error) {
            return result.text;
        }
        return null;
    } catch (e) {
        return null;
    } finally {
        try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) {}
    }
}

async function transcribeWithModalWhisper(audioBuffer, cleanMime) {
    try {
        const formData = new FormData();
        formData.append('file', new Blob([audioBuffer], { type: cleanMime || 'audio/webm' }), 'snippet.webm');
        const upRes = await fetch(`${DEFAULT_SARGAM_BACKEND}/api/transcribe-snippet`, {
            method: 'POST',
            body: formData,
            signal: AbortSignal.timeout(25000)
        });
        if (!upRes.ok) return null;
        const data = await upRes.json().catch(() => null);
        if (data && data.success && typeof data.transcript === 'string') {
            return data.transcript;
        }
        return null;
    } catch (e) {
        return null;
    }
}

// Audio transcription endpoint for captured speech snippets
async function handleTranscribeAudio(req, res) {
    const { audioData, mimeType, speakerName } = req.body || {};
    if (!audioData || typeof audioData !== 'string') {
        return res.status(400).json({ error: 'Missing audioData base64 string' });
    }

    const cleanSpeaker = String(speakerName || 'Participant').trim();
    const cleanMime = String(mimeType || 'audio/webm').split(';')[0].trim();
    const pureBase64 = audioData.includes(',') ? audioData.split(',')[1] : audioData.replace(/^data:[^,]+,/, '');
    const audioBuffer = Buffer.from(pureBase64, 'base64');

    // Ignore empty or header-only tiny chunks (< 256 bytes)
    if (!audioBuffer || audioBuffer.length < 256) {
        return res.json({
            success: true,
            transcript: '',
            speaker: cleanSpeaker,
            source: 'server-stt-empty'
        });
    }

    const reqGeminiKey = req.headers['x-gemini-api-key'] || req.body?.geminiApiKey;
    const envGeminiKey = Date.now() > geminiEnvDisabledUntil ? process.env.GEMINI_API_KEY : '';
    const geminiKey = reqGeminiKey || envGeminiKey;
    let lastGeminiError = '';

    if (geminiKey) {
        const candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-3-flash-preview'];
        for (const modelName of candidateModels) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;
                const gRes = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(25000),
                    body: JSON.stringify({
                        contents: [
                            {
                                parts: [
                                    {
                                        text: `You are a speech-to-text transcriber. Transcribe ONLY the human speech actually spoken in this audio snippet as plain text.
Strict Rules:
- If there is silence, background noise, breathing, or no clear human speech, you MUST return ONLY: SILENCE
- Do NOT guess, imagine, fabricate, autocomplete, or invent any words.
- Do NOT output timestamps, time codes, speaker names, notes, quotation marks, or explanations.
- Output ONLY the exact transcribed spoken words, or SILENCE.`
                                    },
                                    {
                                        inlineData: {
                                            mimeType: cleanMime,
                                            data: pureBase64
                                        }
                                    }
                                ]
                            }
                        ]
                    })
                });

                if (gRes.ok) {
                    const gData = await gRes.json();
                    const rawText = gData.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (rawText && rawText.trim() && !rawText.includes('[Audio clip recorded]')) {
                        let trimmed = rawText.trim().replace(/^["'`«»“”„]+|["'`«»“”„]+$/g, '').trim();
                        if (!isValidSpeechTranscript(trimmed, cleanSpeaker)) {
                            return res.json({
                                success: true,
                                transcript: '',
                                speaker: cleanSpeaker,
                                source: modelName
                            });
                        }
                        return res.json({
                            success: true,
                            transcript: trimmed,
                            speaker: cleanSpeaker,
                            source: modelName
                        });
                    }
                } else {
                    const errBody = await gRes.json().catch(() => ({}));
                    lastGeminiError = errBody?.error?.message || `Gemini HTTP ${gRes.status}`;
                    if (gRes.status === 401 || gRes.status === 403) {
                        if (!reqGeminiKey) {
                            geminiEnvDisabledUntil = Date.now() + 5 * 60 * 1000;
                        }
                        break;
                    }
                }
            } catch (e) {
                lastGeminiError = e.message || 'Gemini request failed';
            }
        }
    }

    // Tier 2: Free local faster-whisper worker (when Python + faster-whisper is installed on host)
    const localText = await transcribeWithLocalWhisper(audioBuffer, cleanMime);
    if (localText !== null) {
        const trimmed = localText.replace(/^["'`«»“”„]+|["'`«»“”„]+$/g, '').trim();
        return res.json({
            success: true,
            transcript: isValidSpeechTranscript(trimmed, cleanSpeaker) ? trimmed : '',
            speaker: cleanSpeaker,
            source: 'local-faster-whisper'
        });
    }

    // Tier 3: Cloud Modal faster-whisper backend fallback
    const modalText = await transcribeWithModalWhisper(audioBuffer, cleanMime);
    if (modalText !== null) {
        const trimmed = modalText.replace(/^["'`«»“”„]+|["'`«»“”„]+$/g, '').trim();
        return res.json({
            success: true,
            transcript: isValidSpeechTranscript(trimmed, cleanSpeaker) ? trimmed : '',
            speaker: cleanSpeaker,
            source: 'modal-faster-whisper'
        });
    }

    return res.json({
        success: true,
        transcript: '',
        speaker: cleanSpeaker,
        source: lastGeminiError ? 'server-stt-error' : 'server-stt-empty',
        warning: lastGeminiError || (!geminiKey ? 'Speech-to-text backends unavailable' : '')
    });
}

app.post('/api/transcribe-audio', handleTranscribeAudio);
app.post('/api/nlp-tasks/transcribe-audio', handleTranscribeAudio);

// ============================================================
// SARGAMJAM STUDIO: AI Stem Separation, Audio Proxy & Vocal Coach
// ============================================================
function toProxyAudioUrl(rawUrl, backendBase) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    try {
        if (rawUrl.startsWith('/api/audio')) {
            const u = new URL(rawUrl, backendBase);
            const file = u.searchParams.get('file');
            if (file) return `/api/sargam/audio?file=${encodeURIComponent(file)}`;
        }
        const parsed = new URL(rawUrl);
        if (ALLOWED_SARGAM_HOSTS.has(parsed.origin) && parsed.pathname.includes('/api/audio')) {
            const file = parsed.searchParams.get('file');
            if (file) return `/api/sargam/audio?file=${encodeURIComponent(file)}`;
        }
        return rawUrl;
    } catch (e) {
        return rawUrl;
    }
}

function isSafePublicHttpUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        const h = parsed.hostname.toLowerCase();
        if (
            h === 'localhost' ||
            h === '0.0.0.0' ||
            h.endsWith('.local') ||
            h.endsWith('.internal') ||
            /^127\./.test(h) ||
            /^10\./.test(h) ||
            /^192\.168\./.test(h) ||
            /^169\.254\./.test(h) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
            h === '::1' ||
            h === '[::1]' ||
            /^\[?(fc|fd|fe80)/i.test(h)
        ) {
            return false;
        }
        return true;
    } catch (e) {
        return false;
    }
}

function toBackendVocalUrl(clientUrl, backendBase) {
    if (!clientUrl || typeof clientUrl !== 'string') return '';
    if (clientUrl.startsWith('/api/sargam/audio')) {
        try {
            const u = new URL(clientUrl, 'http://localhost');
            const file = u.searchParams.get('file');
            if (file && !file.includes('..') && !file.includes('\\')) {
                return `${backendBase}/api/audio?file=${encodeURIComponent(file)}`;
            }
        } catch (e) {}
    }
    if (clientUrl.startsWith('/api/audio')) {
        return `${backendBase}${clientUrl}`;
    }
    try {
        const parsed = new URL(clientUrl);
        if (ALLOWED_SARGAM_HOSTS.has(parsed.origin)) {
            return clientUrl;
        }
    } catch (e) {}
    return '';
}

function normalizeNoteBars(rawBars) {
    if (!Array.isArray(rawBars)) return [];
    return rawBars
        .map((b) => {
            const midi = Number(b.midi);
            const hz = Number(b.freq ?? b.avg_hz ?? (Number.isFinite(midi) ? 440 * Math.pow(2, (midi - 69) / 12) : 0));
            return {
                start: Number(b.start) || 0,
                end: Number(b.end) || 0,
                midi: Number.isFinite(midi) ? midi : (hz > 0 ? Math.round(69 + 12 * Math.log2(hz / 440)) : 60),
                freq: Number(hz.toFixed(2)),
                noteName: b.noteName || ''
            };
        })
        .filter((b) => b.freq > 50);
}

function normalizeSargamPayload(data, backend, fallbackTitle = 'AI Separated Track') {
    const rawVocal = data.vocals || data.vocal_url || data.vocalUrl || '';
    const rawInst = data.instruments || data.inst_url || data.instUrl || '';
    const noteBars = normalizeNoteBars(data.note_bars || data.noteBars);
    const pitchCurve = Array.isArray(data.pitch_curve || data.pitchCurve)
        ? (data.pitch_curve || data.pitchCurve).map((p) => ({
            time: Number(p.time ?? p.t) || 0,
            freq: Number(p.freq ?? p.hz) || 0
        }))
        : [];
    return {
        ...data,
        title: data.title || fallbackTitle,
        vocalUrl: toProxyAudioUrl(rawVocal, backend),
        instUrl: toProxyAudioUrl(rawInst, backend),
        rawVocalUrl: rawVocal,
        rawInstUrl: rawInst,
        noteBars,
        pitchCurve,
        lyrics: Array.isArray(data.lyrics) ? data.lyrics : []
    };
}

app.get('/api/sargam/health', async (req, res) => {
    const backend = resolveSargamBackend(req.query.backend || req.headers['x-sargam-backend']);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const upRes = await fetch(`${backend}/api/health`, { signal: controller.signal });
        clearTimeout(timeout);
        if (upRes.ok) {
            const details = await upRes.json().catch(() => ({}));
            return res.json({ ok: true, backend, details });
        }
        return res.json({ ok: false, backend, status: upRes.status });
    } catch (err) {
        clearTimeout(timeout);
        return res.json({ ok: false, backend, error: err.message });
    }
});

const sargamAudioCache = new Map();
const sargamAudioInFlight = new Map();
const MAX_SARGAM_CACHE_ENTRIES = 6;
const MAX_SARGAM_CACHE_BYTES = 35 * 1024 * 1024;

function getOrFetchSargamAudio(upstreamUrl) {
    if (sargamAudioCache.has(upstreamUrl)) {
        const hit = sargamAudioCache.get(upstreamUrl);
        // Refresh LRU order
        sargamAudioCache.delete(upstreamUrl);
        sargamAudioCache.set(upstreamUrl, hit);
        return Promise.resolve(hit);
    }
    if (sargamAudioInFlight.has(upstreamUrl)) {
        return sargamAudioInFlight.get(upstreamUrl);
    }
    const promise = (async () => {
        const upRes = await fetch(upstreamUrl, { signal: AbortSignal.timeout(45000) });
        if (!upRes.ok) {
            const err = new Error(`Upstream audio returned ${upRes.status}`);
            err.statusCode = upRes.status;
            throw err;
        }
        const mimeType = upRes.headers.get('content-type') || 'audio/mpeg';
        const arrayBuf = await upRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        if (buffer.length > 0 && buffer.length <= MAX_SARGAM_CACHE_BYTES) {
            while (sargamAudioCache.size >= MAX_SARGAM_CACHE_ENTRIES) {
                const oldestKey = sargamAudioCache.keys().next().value;
                sargamAudioCache.delete(oldestKey);
            }
            sargamAudioCache.set(upstreamUrl, { buffer, mimeType });
        }
        return { buffer, mimeType };
    })();
    sargamAudioInFlight.set(upstreamUrl, promise);
    promise.finally(() => {
        sargamAudioInFlight.delete(upstreamUrl);
    });
    return promise;
}

function warmSargamAudioCache(payload, backend) {
    if (!payload) return;
    [payload.vocalUrl, payload.instUrl].forEach((clientUrl) => {
        const upstream = toBackendVocalUrl(clientUrl, backend);
        if (upstream && !sargamAudioCache.has(upstream) && !sargamAudioInFlight.has(upstream)) {
            getOrFetchSargamAudio(upstream).catch(() => {});
        }
    });
}

app.post('/api/sargam/separate-stems', async (req, res) => {
    const { url, sourceUrl, backend: requestedBackend } = req.body || {};
    const targetUrl = (url || sourceUrl || '').trim();
    if (!targetUrl) {
        return res.status(400).json({ error: 'Please provide a YouTube or audio URL.' });
    }
    if (!isSafePublicHttpUrl(targetUrl)) {
        return res.status(400).json({ error: 'Invalid or private media URL provided.' });
    }
    const backend = resolveSargamBackend(requestedBackend || req.headers['x-sargam-backend']);
    try {
        const upRes = await fetch(`${backend}/api/separate-stems`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: targetUrl }),
            signal: AbortSignal.timeout(240000)
        });
        const data = await upRes.json().catch(() => ({}));
        if (!upRes.ok || data.success === false) {
            return res.status(upRes.ok ? 422 : upRes.status).json({ error: data.detail || data.error || 'Stem separation failed.' });
        }
        const normalized = normalizeSargamPayload(data, backend, 'AI Separated Track');
        warmSargamAudioCache(normalized, backend);
        return res.json(normalized);
    } catch (err) {
        return res.status(502).json({ error: `Stem backend unreachable: ${err.message}` });
    }
});

app.post('/api/sargam/separate-stems-file', express.raw({ type: '*/*', limit: '60mb' }), async (req, res) => {
    const backend = resolveSargamBackend(req.query.backend || req.headers['x-sargam-backend']);
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Uploaded audio file is empty.' });
    }

    try {
        let upRes;
        if (contentType.includes('multipart/form-data')) {
            upRes = await fetch(`${backend}/api/separate-stems-file`, {
                method: 'POST',
                headers: { 'Content-Type': contentType },
                body: req.body,
                signal: AbortSignal.timeout(240000)
            });
        } else {
            const filename = String(req.headers['x-filename'] || req.query.filename || 'upload.mp3').replace(/[^a-zA-Z0-9._-]/g, '_');
            const formData = new FormData();
            formData.append('file', new Blob([req.body], { type: contentType }), filename);
            upRes = await fetch(`${backend}/api/separate-stems-file`, {
                method: 'POST',
                body: formData,
                signal: AbortSignal.timeout(240000)
            });
        }

        const data = await upRes.json().catch(() => ({}));
        if (!upRes.ok || data.success === false) {
            return res.status(upRes.ok ? 422 : upRes.status).json({ error: data.detail || data.error || 'File stem separation failed.' });
        }
        const normalized = normalizeSargamPayload(data, backend, 'Uploaded Song Stems');
        warmSargamAudioCache(normalized, backend);
        return res.json(normalized);
    } catch (err) {
        return res.status(502).json({ error: `Stem file backend unreachable: ${err.message}` });
    }
});

app.post('/api/sargam/upload-cookies', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
    const backend = resolveSargamBackend(req.query.backend || req.headers['x-sargam-backend']);
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Uploaded cookies file is empty.' });
    }
    try {
        const formData = new FormData();
        formData.append('file', new Blob([req.body], { type: 'text/plain' }), 'cookies.txt');
        const upRes = await fetch(`${backend}/api/upload-cookies`, {
            method: 'POST',
            body: formData,
            signal: AbortSignal.timeout(15000)
        });
        const data = await upRes.json().catch(() => ({}));
        if (!upRes.ok) {
            return res.status(upRes.status).json({ error: data.error || 'Cookie upload failed.' });
        }
        return res.json(data);
    } catch (err) {
        return res.status(502).json({ error: `Cookie upload error: ${err.message}` });
    }
});

app.get('/api/sargam/audio', async (req, res) => {
    const file = String(req.query.file || '').trim();
    if (!file) {
        return res.status(400).json({ error: 'Missing file parameter' });
    }
    if (file.includes('..') || file.includes('\\') || file.includes('\0') || file.includes('://') || file.startsWith('/') || !/^[a-zA-Z0-9._/-]+$/.test(file)) {
        return res.status(400).json({ error: 'Invalid audio file path' });
    }
    const backend = resolveSargamBackend(req.query.backend);
    const upstreamUrl = `${backend}/api/audio?file=${encodeURIComponent(file)}`;
    try {
        const entry = await getOrFetchSargamAudio(upstreamUrl);
        return sendBufferWithRange(req, res, entry.buffer, entry.mimeType);
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(502).json({ error: `Audio stream proxy error: ${err.message}` });
    }
});

app.get('/api/sargam/get-pitch-and-lyrics', async (req, res) => {
    const vocalUrl = String(req.query.vocal_url || '').trim();
    if (!vocalUrl) {
        return res.status(400).json({ error: 'Missing vocal_url parameter' });
    }
    const backend = resolveSargamBackend(req.query.backend);
    const normalizedVocalUrl = toBackendVocalUrl(vocalUrl, backend);
    if (!normalizedVocalUrl) {
        return res.status(400).json({ error: 'Invalid vocal_url origin' });
    }
    try {
        const upRes = await fetch(`${backend}/api/get-pitch-and-lyrics?vocal_url=${encodeURIComponent(normalizedVocalUrl)}`);
        const data = await upRes.json().catch(() => ({}));
        if (!upRes.ok) {
            return res.status(upRes.status).json({ error: data.detail || data.error || 'Pitch/lyrics extraction failed' });
        }
        return res.json({
            ...data,
            noteBars: normalizeNoteBars(data.note_bars || data.noteBars),
            lyrics: Array.isArray(data.lyrics) ? data.lyrics : []
        });
    } catch (err) {
        return res.status(502).json({ error: `Pitch backend error: ${err.message}` });
    }
});

app.post('/api/ai-vocal-coach', async (req, res) => {
    const {
        raga = 'Standard',
        tonicLabel = 'C4',
        taal = '4/4 Studio Click',
        bpm = 96,
        userAvgHz = 0,
        refAvgHz = 0,
        avgCentsOffset = 0,
        inTunePercent = 0,
        stabilityCents = 0,
        durationSec = 0,
        sampleNotes = [],
        geminiApiKey
    } = req.body || {};

    if (!userAvgHz && !inTunePercent && (!Array.isArray(sampleNotes) || sampleNotes.length === 0)) {
        return res.status(400).json({
            success: false,
            error: 'Provide pitch metrics (userAvgHz, inTunePercent, or sampleNotes) for analysis.'
        });
    }

    const centsAbs = Math.abs(Number(avgCentsOffset) || 0);
    const computedScore = Math.max(
        25,
        Math.min(
            99,
            Math.round((Number(inTunePercent) || 65) * 0.65 + Math.max(0, 35 - centsAbs * 0.7))
        )
    );

    const apiKey = process.env.GEMINI_API_KEY || geminiApiKey || req.headers['x-gemini-api-key'];
    if (apiKey) {
        const prompt = `You are a professional Studio Vocal Coach & Audio Producer.
Analyze this vocalist's take and give concrete, warm, encouraging technical feedback:
- Scale: ${raga} | Key / Tonic: ${tonicLabel} | Meter: ${taal} (${bpm} BPM)
- Vocalist Mean Pitch: ${Number(userAvgHz || 0).toFixed(1)} Hz vs Reference: ${Number(refAvgHz || 0).toFixed(1)} Hz
- Mean Pitch Offset: ${Number(avgCentsOffset || 0).toFixed(1)} cents (${avgCentsOffset > 12 ? 'tends sharp' : avgCentsOffset < -12 ? 'tends flat' : 'well centered'})
- In Tune Accuracy (<=15c): ${Math.round(Number(inTunePercent || 0))}% | Pitch Stability StdDev: ${Number(stabilityCents || 0).toFixed(1)} cents
- Take Duration: ${Number(durationSec || 0).toFixed(1)}s
- Notes sung: ${Array.isArray(sampleNotes) ? sampleNotes.slice(0, 12).join(', ') : 'N/A'}

Return ONLY strict JSON (no markdown fences) with keys:
{
  "score": number (0-100),
  "pitchVerdict": string (concise 1-sentence summary),
  "strengths": string[],
  "drills": string[],
  "raagTip": string
}`;
        const models = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-2.0-flash'];
        for (const modelName of models) {
            try {
                const gRes = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: prompt }] }],
                            generationConfig: { temperature: 0.35, responseMimeType: 'application/json' }
                        })
                    }
                );
                if (gRes.ok) {
                    const gData = await gRes.json();
                    const rawText = gData.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    const cleaned = rawText.replace(/^```json\s*|\s*```$/g, '').trim();
                    const parsed = JSON.parse(cleaned);
                    return res.json({
                        success: true,
                        source: modelName,
                        analysis: {
                            score: Number(parsed.score) || computedScore,
                            pitchVerdict: parsed.pitchVerdict || 'Balanced tonal alignment with room for finer sustain.',
                            strengths: Array.isArray(parsed.strengths) ? parsed.strengths : ['Steady breath support around the key center'],
                            drills: Array.isArray(parsed.drills) ? parsed.drills : [`Sustained scale hold on ${tonicLabel} for 8 bars at ${bpm} BPM`],
                            raagTip: parsed.raagTip || `Focus on settling cleanly onto target anchor notes in ${raga}.`
                        }
                    });
                }
            } catch (e) {
                // Fallback to next model
            }
        }
    }

    const tendency =
        avgCentsOffset > 12
            ? 'slightly sharp — relax throat tension on upper transitions'
            : avgCentsOffset < -12
              ? 'slightly flat — engage diaphragmatic breath support'
              : 'well centered inside the 15-cent In Tune pocket';

    return res.json({
        success: true,
        source: 'local-dsp-coach',
        analysis: {
            score: computedScore,
            pitchVerdict: `Your phrasing in ${raga} is ${tendency} (${Math.round(Number(inTunePercent || 65))}% In Tune).`,
            strengths: [
                centsAbs <= 15
                    ? `Strong tonal center lock around ${tonicLabel} (${avgCentsOffset >= 0 ? '+' : ''}${Number(avgCentsOffset || 0).toFixed(1)}c avg)`
                    : `Consistent melodic contour tracked across ${Number(durationSec || 0).toFixed(1)}s take`,
                stabilityCents <= 25
                    ? 'Smooth vibrato/sustain stability with low micro-jitter'
                    : 'Expressive dynamic phrasing across note transitions'
            ],
            drills: [
                `Sustained scale hold: hold ${tonicLabel} with reference drone ON for 2 bars at ${bpm} BPM before ascending.`,
                avgCentsOffset > 12
                    ? 'Pitch calibration drill: hum descending 5-4-3-2-1 slowly while watching the tuner needle sit dead-center.'
                    : 'Breath & projection drill: sing scale degrees 1-2-3-5-6-8 in staccato, then sustained long notes.'
            ],
            raagTip: `${raga}: Approach anchor notes via smooth pitch calibration glides rather than snapping abruptly.`
        }
    });
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
const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });

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

function getLeaderInfo(room) {
    if (!room) return { leaderPeerId: null, leaderName: null };
    if (room.leaderPeerId && room.participants.has(room.leaderPeerId)) {
        return {
            leaderPeerId: room.leaderPeerId,
            leaderName: room.participants.get(room.leaderPeerId)?.name || 'Leader'
        };
    }
    const firstPeerId = room.participants.keys().next().value || null;
    room.leaderPeerId = firstPeerId;
    return {
        leaderPeerId: firstPeerId,
        leaderName: firstPeerId ? (room.participants.get(firstPeerId)?.name || 'Leader') : null
    };
}

function getLiveBackingSnapshot(room) {
    const base = room?.backingState || createDefaultBackingState();
    if (!base.isPlaying) return base;
    const elapsedSec = Math.max(0, (Date.now() - (base.updatedAt || Date.now())) / 1000);
    return {
        ...base,
        currentTime: Number((Number(base.currentTime || 0) + elapsedSec).toFixed(3))
    };
}

function handlePeerLeave(ws) {
    if (!ws.roomId || !ws.peerId) return;
    const room = rooms.get(ws.roomId);
    if (room && room.participants.has(ws.peerId)) {
        const wasLeader = room.leaderPeerId === ws.peerId;
        room.participants.delete(ws.peerId);
        if (wasLeader) {
            room.leaderPeerId = room.participants.keys().next().value || null;
        }
        const { leaderPeerId, leaderName } = getLeaderInfo(room);
        const remaining = Array.from(room.participants.values()).map(sanitizePublicParticipant);
        broadcastToRoom(ws.roomId, {
            type: 'user-left',
            peerId: ws.peerId,
            participants: remaining,
            leaderPeerId,
            leaderName
        }, ws);
        if (wasLeader && leaderPeerId) {
            broadcastToRoom(ws.roomId, {
                type: 'room-leader-changed',
                leaderPeerId,
                leaderName
            });
        }

        // When all participants have left, start 5-minute timer to delete session notes & actions
        if (room.participants.size === 0) {
            room.emptySince = Date.now();
            if (room.cleanupTimer) {
                clearTimeout(room.cleanupTimer);
            }
            room.cleanupTimer = setTimeout(() => {
                if (room.participants.size === 0) {
                    room.transcript = [];
                    room.tasks = [];
                    room.sharedAudioFiles?.clear();
                    room.leaderPeerId = null;
                    room.emptySince = null;
                    room.cleanupTimer = null;
                }
            }, ROOM_EMPTY_EXPIRY_MS);
            if (typeof room.cleanupTimer.unref === 'function') {
                room.cleanupTimer.unref();
            }
        }
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
            // Drop malformed non-JSON frames rather than broadcasting across rooms
            return;
        }
        if (!data || typeof data !== 'object' || typeof data.type !== 'string') {
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
                    name: String(data.user?.name || 'Guest').slice(0, 80),
                    picture: data.user?.picture || '',
                    initials: data.user?.initials || getInitials(data.user?.name || 'Guest'),
                    instrument: data.user?.instrument || 'Vocalist',
                    isAudioOn: data.user?.isAudioOn !== false,
                    isVideoOn: data.user?.isVideoOn !== false,
                    isScreenSharing: Boolean(data.user?.isScreenSharing),
                    joinedAt: new Date().toISOString()
                };

                room.participants.set(ws.peerId, participant);
                if (!room.leaderPeerId || !room.participants.has(room.leaderPeerId)) {
                    room.leaderPeerId = ws.peerId;
                }
                const { leaderPeerId, leaderName } = getLeaderInfo(room);
                const participantsList = Array.from(room.participants.values()).map(sanitizePublicParticipant);

                // Acknowledge join to the connecting client with current room state
                try {
                    ws.send(JSON.stringify({
                        type: 'room-users',
                        roomId: room.roomId,
                        selfPeerId: ws.peerId,
                        leaderPeerId,
                        leaderName,
                        serverTime: Date.now(),
                        participants: participantsList,
                        transcript: room.transcript,
                        tasks: room.tasks,
                        jamState: room.jamState || createDefaultJamState(),
                        backingState: getLiveBackingSnapshot(room)
                    }), () => {});
                } catch (e) {}

                // Notify all other peers in the room that a new user joined
                broadcastToRoom(room.roomId, {
                    type: 'user-joined',
                    peer: participant,
                    participants: participantsList,
                    leaderPeerId,
                    leaderName
                }, ws);
                break;
            }

            case 'leave-room': {
                handlePeerLeave(ws);
                break;
            }

            case 'clear-room-session': {
                if (!ws.roomId) break;
                const room = rooms.get(ws.roomId);
                if (room) {
                    room.transcript = [];
                    room.tasks = [];
                    broadcastToRoom(ws.roomId, {
                        type: 'room-session-cleared'
                    });
                }
                break;
            }

            case 'webrtc-offer':
            case 'webrtc-answer':
            case 'webrtc-ice-candidate':
            case 'remote-transcribe-toggle': {
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
                    if (typeof data.instrument === 'string' && data.instrument.trim()) p.instrument = data.instrument.trim();
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

            case 'jam-state-sync': {
                if (!ws.roomId || !data.jamState) break;
                const room = rooms.get(ws.roomId);
                if (room) {
                    room.jamState = {
                        ...(room.jamState || createDefaultJamState()),
                        ...data.jamState,
                        updatedAt: Date.now()
                    };
                    broadcastToRoom(ws.roomId, {
                        type: 'jam-state-sync',
                        jamState: room.jamState,
                        senderPeerId: ws.peerId
                    }, ws);
                }
                break;
            }

            case 'sync-ping': {
                try {
                    ws.send(JSON.stringify({
                        type: 'sync-pong',
                        clientSentAt: data.clientSentAt,
                        serverTime: Date.now()
                    }), () => {});
                } catch (e) {}
                break;
            }

            case 'claim-leader': {
                if (!ws.roomId) break;
                const room = rooms.get(ws.roomId);
                if (room && room.participants.has(ws.peerId)) {
                    room.leaderPeerId = ws.peerId;
                    const { leaderPeerId, leaderName } = getLeaderInfo(room);
                    broadcastToRoom(ws.roomId, {
                        type: 'room-leader-changed',
                        leaderPeerId,
                        leaderName
                    });
                }
                break;
            }

            case 'backing-sync': {
                if (!ws.roomId || !data.backingState) break;
                const room = rooms.get(ws.roomId);
                if (room) {
                    if (!data.preserveLeader || !room.leaderPeerId || !room.participants.has(room.leaderPeerId)) {
                        room.leaderPeerId = ws.peerId;
                    }
                    const { leaderPeerId, leaderName } = getLeaderInfo(room);
                    room.backingState = {
                        ...(room.backingState || createDefaultBackingState()),
                        ...data.backingState,
                        playbackSeq: ((room.backingState?.playbackSeq || 0) + 1),
                        updatedAt: Date.now()
                    };
                    broadcastToRoom(ws.roomId, {
                        type: 'backing-sync',
                        backingState: room.backingState,
                        leaderPeerId,
                        leaderName,
                        senderPeerId: ws.peerId
                    }, ws);
                }
                break;
            }

            case 'backing-control': {
                if (!ws.roomId || !data.action) break;
                const room = rooms.get(ws.roomId);
                if (!room) break;
                const { leaderPeerId, leaderName } = getLeaderInfo(room);
                if (leaderPeerId && leaderPeerId !== ws.peerId) {
                    break;
                }
                const prev = room.backingState || createDefaultBackingState();
                const action = String(data.action);
                const nextTime = Number.isFinite(Number(data.currentTime)) ? Math.max(0, Number(data.currentTime)) : prev.currentTime;
                let nextPlaying = prev.isPlaying;
                if (action === 'play' || action === 'sync') nextPlaying = true;
                else if (action === 'pause') nextPlaying = false;
                else if (action === 'stop') nextPlaying = false;

                room.backingState = {
                    ...prev,
                    isPlaying: nextPlaying,
                    currentTime: action === 'stop' ? 0 : nextTime,
                    vocalVol: typeof data.vocalVol === 'number' ? data.vocalVol : prev.vocalVol,
                    instVol: typeof data.instVol === 'number' ? data.instVol : prev.instVol,
                    playbackSeq: (prev.playbackSeq || 0) + 1,
                    updatedAt: Date.now()
                };

                broadcastToRoom(ws.roomId, {
                    type: 'backing-control',
                    action,
                    isPlaying: room.backingState.isPlaying,
                    currentTime: room.backingState.currentTime,
                    vocalVol: room.backingState.vocalVol,
                    instVol: room.backingState.instVol,
                    seq: room.backingState.playbackSeq,
                    sentAt: Date.now(),
                    leaderPeerId,
                    leaderName,
                    senderPeerId: ws.peerId
                }, ws);
                break;
            }

            case 'pitch-telemetry': {
                if (!ws.roomId) break;
                broadcastToRoom(ws.roomId, {
                    type: 'pitch-telemetry',
                    peerId: ws.peerId,
                    note: data.note || null,
                    sargam: data.sargam || null,
                    sargamDevanagari: data.sargamDevanagari || null,
                    cents: typeof data.cents === 'number' ? data.cents : 0,
                    hz: typeof data.hz === 'number' ? data.hz : 0,
                    inTune: Boolean(data.inTune),
                    level: typeof data.level === 'number' ? data.level : 0
                }, ws);
                break;
            }

            case 'transcript-entry': {
                if (!ws.roomId || !data.entry) break;
                const room = rooms.get(ws.roomId);
                if (room) {
                    const rawText = String(data.entry.text || '').trim();
                    const cleanSpeaker = String(data.entry.speaker || 'Participant').trim();
                    if (!isValidSpeechTranscript(rawText, cleanSpeaker)) {
                        break;
                    }
                    const entry = {
                        id: data.entry.id || crypto.randomUUID(),
                        speaker: cleanSpeaker,
                        time: data.entry.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        text: rawText.replace(/^["'`«»“”„]+|["'`«»“”„]+$/g, '').trim()
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

            case 'transcript-entry-update': {
                if (!ws.roomId || !data.entry) break;
                const room = rooms.get(ws.roomId);
                if (room) {
                    const rawText = String(data.entry.text || '').trim();
                    const cleanSpeaker = String(data.entry.speaker || 'Participant').trim();
                    if (!isValidSpeechTranscript(rawText, cleanSpeaker)) {
                        break;
                    }
                    const cleanEntry = {
                        id: data.entry.id || crypto.randomUUID(),
                        speaker: cleanSpeaker,
                        time: data.entry.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        text: rawText.replace(/^["'`«»“”„]+|["'`«»“”„]+$/g, '').trim()
                    };
                    if (cleanEntry.text) {
                        const existingIdx = room.transcript.findIndex((t) => t.id === cleanEntry.id);
                        if (existingIdx !== -1) {
                            room.transcript[existingIdx] = cleanEntry;
                        } else {
                            room.transcript.push(cleanEntry);
                        }
                        broadcastToRoom(ws.roomId, {
                            type: 'transcript-entry-update',
                            entry: cleanEntry
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
                // Only relay messages within an authenticated/joined room; never broadcast globally across wss.clients
                if (ws.roomId) {
                    broadcastToRoom(ws.roomId, rawStr, ws);
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        handlePeerLeave(ws);
    });
});

function shutdownLocalWhisperWorker() {
    if (whisperWorker && !whisperWorker.killed) {
        try { whisperWorker.kill(); } catch (e) {}
        whisperWorker = null;
        whisperWorkerReady = false;
    }
}

server.on('close', shutdownLocalWhisperWorker);
process.on('exit', shutdownLocalWhisperWorker);

if (require.main === module) {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`[CallSummarizer Unified Server] Running on http://0.0.0.0:${PORT}`);
    });
}

module.exports = { app, server, wss, rooms, sessions, generateMeetingCode, normalizeRoomId, normalizeSargamPayload, shutdownLocalWhisperWorker };
