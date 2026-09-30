/**
 * CallSummarizer - WebRTC Signaling Service
 * Coordinates SDP Offers, Answers, and ICE Candidates via WebSockets
 */
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 5002;
const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        // Broadcast signaling messages (offers, answers, ICE candidates) to room peers
    });
});

console.log(`[Signaling Service] WebSocket server listening on port ${PORT}`);
