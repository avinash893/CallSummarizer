/**
 * CallSummarizer - WebRTC Signaling Service
 * Coordinates SDP Offers, Answers, and ICE Candidates via WebSockets
 */
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 5002;

function createSignalingServer(port = PORT) {
    const wss = new WebSocketServer({ port });

    wss.on('connection', (ws) => {
        ws.on('error', () => {
            // Silently absorb socket client error to protect daemon uptime
        });

        ws.on('message', (message) => {
            // Broadcast signaling messages (offers, answers, ICE candidates) to other connected peers
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === 1) { // 1 = OPEN
                    try {
                        client.send(message.toString(), () => {});
                    } catch (e) {
                        // Ignore send errors if client disconnected concurrently
                    }
                }
            });
        });
    });

    return wss;
}

if (require.main === module) {
    createSignalingServer(PORT);
    console.log(`[Signaling Service] WebSocket server listening on port ${PORT}`);
}

module.exports = { createSignalingServer };
