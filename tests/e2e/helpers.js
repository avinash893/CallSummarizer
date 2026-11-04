/**
 * CallSummarizer E2E Test Helpers & Harness
 * Supports testing Unified Server, WebSocket Signaling, Turnstile, Google OAuth/Calendar, and NLP.
 */
const { WebSocket } = require('ws');
const { app, server, rooms, sessions, generateMeetingCode, normalizeRoomId } = require('../../server');

let runningServer = null;
let serverPort = null;
let baseUrl = null;
let wsUrl = null;

async function startServer() {
    if (!runningServer) {
        await new Promise((resolve) => {
            if (server.listening) {
                const addr = server.address();
                serverPort = typeof addr === 'object' && addr ? addr.port : 8080;
                baseUrl = `http://127.0.0.1:${serverPort}`;
                wsUrl = `ws://127.0.0.1:${serverPort}`;
                runningServer = server;
                resolve();
            } else {
                runningServer = server.listen(0, '127.0.0.1', () => {
                    serverPort = server.address().port;
                    baseUrl = `http://127.0.0.1:${serverPort}`;
                    wsUrl = `ws://127.0.0.1:${serverPort}`;
                    resolve();
                });
            }
        });
    }
    return { app, server: runningServer, port: serverPort, baseUrl, wsUrl, rooms, sessions };
}

function resetServerState() {
    rooms.clear();
    sessions.clear();
}

function createWsClient(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const onOpen = () => {
            ws.removeListener('error', onError);
            resolve(ws);
        };
        const onError = (err) => {
            ws.removeListener('open', onOpen);
            reject(err);
        };
        ws.once('open', onOpen);
        ws.once('error', onError);
    });
}

function waitForMessage(ws, predicate = () => true, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        let timer;
        const messageHandler = (data) => {
            try {
                const raw = data.toString();
                let parsed = null;
                try {
                    parsed = JSON.parse(raw);
                } catch (e) {
                    parsed = raw;
                }
                if (predicate(parsed)) {
                    clearTimeout(timer);
                    ws.removeListener('message', messageHandler);
                    resolve(parsed);
                }
            } catch (err) {
                clearTimeout(timer);
                ws.removeListener('message', messageHandler);
                reject(err);
            }
        };

        timer = setTimeout(() => {
            ws.removeListener('message', messageHandler);
            reject(new Error(`waitForMessage timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        ws.on('message', messageHandler);
    });
}

function closeWs(ws) {
    return new Promise((resolve) => {
        if (!ws || ws.readyState === WebSocket.CLOSED) {
            return resolve();
        }
        ws.once('close', () => resolve());
        try {
            ws.close();
        } catch (e) {
            resolve();
        }
    });
}

// Grid layout calculator mirroring client VideoCanvas
function calculateGridLayout(participantCount) {
    if (participantCount <= 6) {
        return `count-${participantCount}`;
    }
    return 'count-many';
}

// MediaRecorder / Selective Audio Capture mock session simulator
class SelectiveAudioCaptureSession {
    constructor(peerId, peerName = 'Participant') {
        this.peerId = peerId;
        this.peerName = peerName;
        this.isRecording = true;
        this.startTime = Date.now();
        this.chunks = [];
        this.isRevoked = false;
        this.objectUrl = `blob:http://localhost:8080/audio-${peerId}-${Date.now()}`;
    }

    pushAudioChunk(chunk) {
        if (this.isRecording) {
            this.chunks.push(chunk);
        }
    }

    stop() {
        this.isRecording = false;
        const durationSec = Math.max(1, Math.round((Date.now() - this.startTime) / 1000));
        return {
            id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            peerId: this.peerId,
            peerName: this.peerName,
            url: this.objectUrl,
            duration: `${durationSec}s`,
            durationSec,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        };
    }

    revoke() {
        this.isRevoked = true;
    }
}

module.exports = {
    startServer,
    resetServerState,
    createWsClient,
    waitForMessage,
    closeWs,
    calculateGridLayout,
    SelectiveAudioCaptureSession,
    generateMeetingCode,
    normalizeRoomId,
    app,
    server,
    rooms,
    sessions
};
