/**
 * CallSummarizer - Production Unified Server
 * Serves the React 18 client, REST API routes (Meeting & NLP extraction), and WebSockets signaling.
 */
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { extractLocalTasks } = require('./services/nlp-task-service/index');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({
        service: 'CallSummarizer Production',
        status: 'Healthy',
        timestamp: new Date().toISOString()
    });
});

// Meeting Service routes
app.get('/api/rooms/:id', (req, res) => {
    res.json({
        roomId: req.params.id,
        participants: ['You', 'Rohan Sharma'],
        status: 'active'
    });
});

app.post('/api/rooms', (req, res) => {
    const { roomId, host } = req.body || {};
    res.status(201).json({
        roomId: roomId || 'room-' + Date.now(),
        host: host || 'You',
        status: 'created',
        createdAt: new Date().toISOString()
    });
});

// NLP Task Extraction route
app.post('/api/nlp-tasks/extract-tasks', async (req, res) => {
    const { transcript } = req.body || {};

    if (process.env.GEMINI_API_KEY && transcript) {
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
                        return res.json({ tasks: parsed.tasks, source: 'gemini-1.5-flash' });
                    }
                }
            }
        } catch (err) {
            // Gracefully fall back to local heuristic NLP
        }
    }

    const tasks = extractLocalTasks(transcript);
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

// Attach WebSockets Signaling Server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    ws.on('error', () => {});

    ws.on('message', (message) => {
        // Broadcast signaling messages (offers, answers, ICE candidates) to other connected peers
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === 1) { // 1 = OPEN
                try {
                    client.send(message.toString(), () => {});
                } catch (e) {}
            }
        });
    });
});

if (require.main === module) {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`[CallSummarizer Unified Server] Running on http://0.0.0.0:${PORT}`);
    });
}

module.exports = { app, server };
