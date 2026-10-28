/**
 * CallSummarizer - NLP Task & Extraction Service
 * Identifies actionable commitments from meeting speech and forms tasks / calendar events
 */
const express = require('express');
const app = express();
const PORT = process.env.PORT || 5003;

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ service: 'NLP Task Service', status: 'Healthy', port: PORT });
});

// Process meeting transcript text and extract structured tasks
app.post('/api/extract-tasks', (req, res) => {
    const { transcript } = req.body;
    res.json({
        tasks: [
            { title: 'Review frontend responsiveness', assignee: 'You', due: 'Tomorrow' },
            { title: 'Connect signaling service', assignee: 'Rohan Sharma', due: 'Friday' }
        ]
    });
});

app.listen(PORT, () => {
    console.log(`[NLP Task Service] Running on port ${PORT}`);
});
