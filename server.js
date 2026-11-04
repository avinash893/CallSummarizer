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
app.set('trust proxy', 1);
const PORT = process.env.PORT || 8080;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const TURNSTILE_SITE_KEY = process.env.CLOUDFLARE_TURNSTILE_SITE_KEY || '';
const TURNSTILE_SECRET_KEY = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || '';

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());

const TEN_DAYS_SECONDS = 10 * 24 * 60 * 60; // 10 days in seconds (864,000s)
const TEN_DAYS_MS = TEN_DAYS_SECONDS * 1000;
const SESSION_SECRET = process.env.SESSION_SECRET || GOOGLE_CLIENT_SECRET || 'callsummarizer-persistent-session-secret-2026';

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
    if (sig !== expectedSig) return null;

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
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(arr, null, 2), 'utf8');
    } catch (e) {
        // Safe fallback
    }
}

loadSessionsFromDisk();

function getSession(req) {
    if (!req) return null;

    const candidates = [
        req.body?.sessionId,
        req.query?.sessionId,
        req.headers ? req.headers['x-session-id'] : null,
        (req.headers?.authorization?.startsWith('Bearer ')) ? req.headers.authorization.slice(7).trim() : null,
        req.headers?.cookie ? (req.headers.cookie.match(/cs_session_id=([^;]+)/)?.[1] || null) : null
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

function getOrCreateRoom(roomId, hostName = 'Host') {
    const normalized = normalizeRoomId(roomId);
    if (!rooms.has(normalized)) {
        rooms.set(normalized, {
            roomId: normalized,
            host: hostName,
            createdAt: new Date().toISOString(),
            participants: new Map(),
            transcript: [],
            tasks: [],
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
    const { credential, accessToken, name, email, picture, sessionId: requestedSessionId } = req.body || {};

    try {
        const existingSession = getSession(req) || (requestedSessionId && sessions.has(requestedSessionId) ? sessions.get(requestedSessionId) : null);
        const existingTokens = existingSession?.tokens || {};

        // Case 1: Google ID Token JWT (from Google Identity Services button / One Tap)
        if (credential && typeof credential === 'string' && credential.split('.').length === 3) {
            const payloadBase64 = credential.split('.')[1];
            const decoded = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
            const userName = decoded.name || decoded.given_name || 'Google User';
            const userEmail = (decoded.email || '').trim().toLowerCase();
            const userId = decoded.sub || crypto.randomUUID();
            const sessionId = existingSession ? existingSession.sessionId : crypto.randomUUID();

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
                createdAt: existingSession?.createdAt || new Date().toISOString()
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

            if (accessToken.startsWith('mock-') || accessToken === 'test-access-token') {
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

            const sessionId = existingSession ? existingSession.sessionId : crypto.randomUUID();
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
                createdAt: existingSession?.createdAt || new Date().toISOString()
            };
            const sessionToken = signSessionToken(sessionObj);
            sessionObj.token = sessionToken;
            userObj.sessionId = sessionId;
            userObj.sessionToken = sessionToken;
            userObj.accessToken = accessToken;
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

        // Case 3: Direct Google profile sign-in (e.g., manual form or offline/testing)
        if (name && email) {
            const cleanName = String(name).trim();
            const cleanEmail = String(email).trim().toLowerCase();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(cleanEmail)) {
                return res.status(400).json({
                    authenticated: false,
                    error: 'Invalid Google email address format'
                });
            }

            const sessionId = existingSession ? existingSession.sessionId : crypto.randomUUID();
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
                    accessToken: accessToken || existingTokens.accessToken || 'mock-calendar-token',
                    scope: 'openid email profile https://www.googleapis.com/auth/calendar.events'
                },
                createdAt: existingSession?.createdAt || new Date().toISOString()
            };
            const sessionToken = signSessionToken(sessionObj);
            sessionObj.token = sessionToken;
            userObj.sessionId = sessionId;
            userObj.sessionToken = sessionToken;
            userObj.accessToken = sessionObj.tokens.accessToken;
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
    const forwardedProto = req.headers['x-forwarded-proto']
        ? String(req.headers['x-forwarded-proto']).split(',')[0].trim()
        : '';
    const proto = forwardedProto || req.protocol || 'https';
    return `${proto}://${req.get('host')}/api/auth/google/callback`;
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
            sessions.set(sessionId, sessionObj);
            sessions.set(sessionToken, sessionObj);
            saveSessionsToDisk();
            setSessionCookie(res, req, sessionToken);
            return res.redirect(`/?sessionId=${encodeURIComponent(sessionToken)}&googleCredential=${encodeURIComponent(tokenData.id_token || '')}`);
        }
        return res.redirect('/?authError=token_exchange_failed');
    } catch (err) {
        return res.redirect('/?authError=oauth_exception');
    }
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
    const session = getSession(req);
    const targetSessionId = req.body?.sessionId || session?.sessionId;
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
    if (session?.sessionId) revokedSessions.add(session.sessionId);
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
        user: session.user,
        hasCalendarAccess: Boolean(session.tokens?.accessToken)
    });
});

// Safely extract explicit time (e.g. "at 2 pm", "2:30 pm", "14:00")
function extractTimeDetails(str) {
    if (!str || typeof str !== 'string') return null;
    const ampmMatch = str.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
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

        // Explicit mock errors for testing and simulation
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

        // If test / simulated token is provided
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
            return res.status(gCalRes.status >= 400 && gCalRes.status < 500 ? gCalRes.status : 502).json({
                success: false,
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
        if (room.cleanupTimer) {
            clearTimeout(room.cleanupTimer);
            room.cleanupTimer = null;
        }
    }
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

// Explicit session wipe endpoint to remove older transcripts and tasks for a room
app.delete('/api/rooms/:id/session', (req, res) => {
    const normalized = normalizeRoomId(req.params.id);
    if (rooms.has(normalized)) {
        const room = rooms.get(normalized);
        room.transcript = [];
        room.tasks = [];
        broadcastToRoom(normalized, { type: 'room-session-cleared' });
    }
    res.json({ success: true, message: `Room ${normalized} session cleared` });
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
    const geminiKey = process.env.GEMINI_API_KEY || req.headers['x-gemini-api-key'] || req.body?.geminiApiKey;

    if (geminiKey) {
        const candidateModels = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3.5-flash-lite'];
        for (const modelName of candidateModels) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;
                const prompt = `You are an expert meeting assistant. Extract all action items, commitments, and delegated tasks from the following meeting transcript (which may include Indian names like Sukhman, Avinash, Rohan, and conversational or Hinglish phrasing).

Transcript:
${cleanTranscript}

Guidelines:
- Identify who is assigned to do what (assignee), the clear action/task (title), and any due date or exact time mentioned (due).
- If speaker says "Sukman, you have to make notes today itself by 1:00 p.m.", extract task "Make notes" assigned to "Sukhman" with due "Today at 1:00 PM".
- Infer sensible titles and normalize names (e.g. Sukman -> Sukhman).
- Return valid JSON matching this schema:
{
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
                        const parsed = JSON.parse(rawJson);
                        if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
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
                                    completed: Boolean(t.completed)
                                };
                            });
                            if (roomId && rooms.has(roomId)) {
                                rooms.get(roomId).tasks = normalizedTasks;
                            }
                            return res.json({ tasks: normalizedTasks, source: modelName });
                        }
                    }
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
    if (roomId && rooms.has(roomId)) {
        rooms.get(roomId).tasks = tasks;
    }
    res.json({ tasks, source: 'render-server-nlp' });
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

// Audio transcription endpoint for captured speech snippets
async function handleTranscribeAudio(req, res) {
    const { audioData, mimeType, speakerName } = req.body || {};
    if (!audioData || typeof audioData !== 'string') {
        return res.status(400).json({ error: 'Missing audioData base64 string' });
    }

    const cleanSpeaker = String(speakerName || 'Participant').trim();
    const cleanMime = String(mimeType || 'audio/webm').split(';')[0].trim();
    const pureBase64 = audioData.includes(',') ? audioData.split(',')[1] : audioData.replace(/^data:[^,]+,/, '');
    const geminiKey = process.env.GEMINI_API_KEY || req.headers['x-gemini-api-key'] || req.body?.geminiApiKey;

    if (geminiKey) {
        const candidateModels = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3.5-flash-lite'];
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
                }
            } catch (e) {
                // Try next model
            }
        }
    }

    return res.json({
        success: true,
        transcript: '',
        speaker: cleanSpeaker,
        source: 'server-stt-empty'
    });
}

app.post('/api/transcribe-audio', handleTranscribeAudio);
app.post('/api/nlp-tasks/transcribe-audio', handleTranscribeAudio);

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

module.exports = { app, server, rooms, sessions, generateMeetingCode, normalizeRoomId };
