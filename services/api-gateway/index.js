/**
 * CallSummarizer - API Gateway
 * Routes requests to Meeting Service, Signaling Service, and NLP Task Service
 */
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'API Gateway Online', timestamp: new Date() });
});

// Downstream microservice route stubs
app.use('/api/meetings', (req, res) => {
    res.json({ message: 'Routed to Meeting Service (Port 5001)' });
});

app.use('/api/nlp-tasks', (req, res) => {
    res.json({ message: 'Routed to NLP Task Service (Port 5003)' });
});

app.listen(PORT, () => {
    console.log(`[API Gateway] Listening on port ${PORT}`);
});
