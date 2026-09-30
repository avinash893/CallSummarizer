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

app.listen(PORT, () => {
    console.log(`[Meeting Service] Running on port ${PORT}`);
});
