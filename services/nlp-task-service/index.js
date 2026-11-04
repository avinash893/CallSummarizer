/**
 * CallSummarizer - NLP Task & Extraction Service
 * Identifies actionable commitments from meeting speech and forms tasks / calendar events.
 * Supports Gemini 1.5 Flash when GEMINI_API_KEY is configured, with a resilient local NLP fallback.
 */
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 5003;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({
        service: 'NLP Task Service',
        status: 'Healthy',
        port: PORT,
        nlpEngine: process.env.GEMINI_API_KEY ? 'Gemini Flash' : 'Deterministic Heuristic NLP'
    });
});

/**
 * Deterministic local NLP extractor for meeting speech
 */
function extractLocalTasks(text) {
    if (!text || typeof text !== 'string' || !text.trim()) {
        return [];
    }

    const tasks = [];
    const sentences = text.split(/(?<=[.?!])\s+|\n+/);

    sentences.forEach((sentence) => {
        const trimmed = sentence.trim();
        if (!trimmed) return;

        const commitmentMatch = trimmed.match(/(?:(?:i'll|i will|rohan will|rohan sharma will|avinash will|we will|you will|will|need to|should|must)\s+)([^.,;!?]+)/i);
        if (commitmentMatch) {
            let taskTitle = commitmentMatch[1].trim();
            // Remove articles (e.g. "connect the signaling service" -> "connect signaling service")
            taskTitle = taskTitle.replace(/\b(?:the|a|an)\s+/ig, '');
            taskTitle = taskTitle.charAt(0).toUpperCase() + taskTitle.slice(1);

            let assignee = 'You';
            if (/rohan/i.test(trimmed)) {
                assignee = 'Rohan Sharma';
            } else if (/avinash/i.test(trimmed)) {
                assignee = 'Avinash';
            }

            let due = 'Tomorrow';
            const timeMatch = trimmed.match(/\b(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i) || trimmed.match(/\b(?:at\s+([01]?\d|2[0-3]):([0-5]\d))\b/i);
            const timeSuffix = timeMatch ? ` at ${timeMatch[1].toUpperCase()}` : '';

            if (/\b(?:by|on)?\s*friday\b/i.test(trimmed)) due = `Friday${timeSuffix}`;
            else if (/\b(?:by|on)?\s*monday\b/i.test(trimmed)) due = `Monday${timeSuffix}`;
            else if (/\b(?:by|on)?\s*today\b/i.test(trimmed)) due = `Today${timeSuffix}`;
            else if (/\b(?:by|on)?\s*tomorrow\b/i.test(trimmed)) due = `Tomorrow${timeSuffix}`;
            else if (timeMatch) due = `Today at ${timeMatch[1].toUpperCase()}`;

            taskTitle = taskTitle.replace(/\s+(by|on|due)\s+(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday).*/i, '').trim();

            tasks.push({
                id: String(tasks.length + 1),
                title: taskTitle,
                assignee,
                due,
                completed: false
            });
        }
    });

    return tasks;
}

// Process meeting transcript text and extract structured tasks
const handleExtractTasks = async (req, res) => {
    const { transcript } = req.body || {};
    const geminiKey = process.env.GEMINI_API_KEY || req.headers['x-gemini-api-key'] || req.body?.geminiApiKey;

    if (geminiKey && transcript) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${geminiKey}`;
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
                                    ? String(t.id)
                                    : `task-${Date.now()}-${idx + 1}`,
                                title: title || t.title,
                                assignee: (/rohan/i.test(t.assignee || '')) ? 'Rohan Sharma' : (t.assignee || 'You'),
                                completed: Boolean(t.completed)
                            };
                        });
                        return res.json({ tasks: normalizedTasks, source: 'gemini-3.5-flash-lite' });
                    }
                }
            }
        } catch (err) {
            // Fall back to deterministic heuristic NLP
        }
    }

    const rawTasks = extractLocalTasks(transcript);
    const tasks = rawTasks.map((t, idx) => ({
        ...t,
        id: (t.id !== undefined && t.id !== null && String(t.id).trim() !== '')
            ? String(t.id)
            : String(idx + 1),
        completed: Boolean(t.completed)
    }));
    res.json({ tasks, source: 'heuristic-nlp' });
};

app.post('/api/extract-tasks', handleExtractTasks);
app.post('/extract-tasks', handleExtractTasks);

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`[NLP Task Service] Running on port ${PORT}`);
    });
}

module.exports = { app, extractLocalTasks };
