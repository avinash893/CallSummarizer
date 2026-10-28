/**
 * CallSummarizer - API Gateway
 * Routes requests to Meeting Service, Signaling Service, and NLP Task Service
 */
const express = require('express');
const cors = require('cors');
const proxy = require('express-http-proxy');

const app = express();
const PORT = process.env.PORT || 5000;
const MEETING_SERVICE_URL = process.env.MEETING_SERVICE_URL;
const NLP_SERVICE_URL = process.env.NLP_SERVICE_URL;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'API Gateway Online', timestamp: new Date() });
});

// Downstream microservice route proxies (with fallback stubs for standalone mode)
if (MEETING_SERVICE_URL) {
    app.use('/api/meetings', proxy(MEETING_SERVICE_URL));
} else {
    app.use('/api/meetings', (req, res) => {
        res.json({ message: 'Routed to Meeting Service (Port 5001)' });
    });
}

if (NLP_SERVICE_URL) {
    app.use('/api/nlp-tasks', proxy(NLP_SERVICE_URL));
} else {
    app.use('/api/nlp-tasks', (req, res) => {
        res.json({ message: 'Routed to NLP Task Service (Port 5003)' });
    });
}

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`[API Gateway] Listening on port ${PORT}`);
    });
}

module.exports = { app };
