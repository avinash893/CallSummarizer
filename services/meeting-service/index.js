/**
 * CallSummarizer - Meeting Service (MERN: Express + MongoDB)
 * Manages active rooms, participant metadata, and persistent notes
 */
const express = require('express');
const app = express();
const PORT = process.env.PORT || 5001;

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ service: 'Meeting Service', status: 'Healthy', port: PORT });
});

// Room metadata stub
app.get('/api/rooms/:id', (req, res) => {
    res.json({
        roomId: req.params.id,
        participants: ['You', 'Rohan Sharma'],
        status: 'active'
    });
});

// Create room endpoint
app.post('/api/rooms', (req, res) => {
    const { roomId, host } = req.body || {};
    res.status(201).json({
        roomId: roomId || 'room-' + Date.now(),
        host: host || 'You',
        status: 'created',
        createdAt: new Date()
    });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`[Meeting Service] Running on port ${PORT}`);
    });
}

module.exports = { app };
