/**
 * CallSummarizer - NLP Task & Extraction Service
 * Identifies actionable commitments and key summary points from meeting speech.
 * Supports Gemini Flash when GEMINI_API_KEY is configured, with a deterministic local NLP fallback.
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

function normalizePersonName(rawName) {
    if (!rawName || typeof rawName !== 'string') return 'You';
    const clean = rawName.trim().replace(/[^a-zA-Z .'-]/g, '').trim();
    if (!clean) return 'You';
    if (/^(i|me|myself|you|speaker|participant)$/i.test(clean)) return 'You';
    if (/^(we|us|team|everyone|all)$/i.test(clean)) return 'Team';
    if (/^suk[hm]an$/i.test(clean)) return 'Sukhman';
    if (/^rohan(?:\s+sharma)?$/i.test(clean)) return 'Rohan Sharma';
    if (/^avinash$/i.test(clean)) return 'Avinash';
    return clean
        .split(/\s+/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
}

function parseDueDate(trimmed) {
    // Match 12h time ("1 pm", "1:30 pm", "at 5pm") OR 24h time ("at 14:30", "14:30")
    const match12h = trimmed.match(/\b(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);
    const match24h = !match12h ? trimmed.match(/\b(?:at\s+)?((?:[01]?\d|2[0-3]):[0-5]\d)\b/i) : null;
    const rawTime = match12h ? match12h[1].trim().toUpperCase().replace(/\s+/g, ' ') : match24h ? match24h[1] : '';
    const timeSuffix = rawTime ? ` at ${rawTime}` : '';

    const dayMatch = trimmed.match(/\b(?:by|on|before|for|due)?\s*(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week)\b/i);
    if (dayMatch) {
        const dayWord = dayMatch[1].toLowerCase();
        if (dayWord === 'tonight') return `Today${timeSuffix || ' Tonight'}`;
        if (dayWord === 'next week') return `Next Week${timeSuffix}`;
        const capDay = dayWord.charAt(0).toUpperCase() + dayWord.slice(1);
        return `${capDay}${timeSuffix}`;
    }

    if (rawTime) return `Today at ${rawTime}`;
    return 'Tomorrow';
}

/**
 * Deterministic local NLP extractor for meeting speech
 */
function extractLocalTasks(text) {
    if (!text || typeof text !== 'string' || !text.trim()) {
        return [];
    }

    const tasks = [];
    const seenTitles = new Set();
    const lines = text.split(/\n+/);

    for (const rawLine of lines) {
        let lineSpeaker = null;
        let lineBody = rawLine.trim();
        if (!lineBody) continue;

        // Parse "Speaker Name: statement..." prefix if present
        const speakerMatch = lineBody.match(/^([A-Za-z][A-Za-z0-9 ._-]{0,30}):\s+(.+)$/);
        if (speakerMatch) {
            lineSpeaker = speakerMatch[1].trim();
            lineBody = speakerMatch[2].trim();
        }

        const sentences = lineBody.split(/(?<=[.?!])\s+/);
        for (const sentence of sentences) {
            const trimmed = sentence.trim();
            if (!trimmed || trimmed.length < 5) continue;

            // Match explicit commitment patterns including vocatives and direct assignments
            const commitmentMatch = trimmed.match(
                /(?:^|\b)(?:([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s+(?:can you|could you|would you|please|you have to|you need to|you should|you must|will|needs to|has to|should|must|remember to)\s+|(?:i'll|i will|i am going to|i'm going to|i need to|i have to|i should|i must|we'll|we will|let's|we need to|we should|you will|you have to|you need to|you should|remind me to|don't forget to|make sure to|action item:?|please|will|need to|needs to|have to|has to|should|must)\s+)([^.!?\n]+)/i
            );
            if (!commitmentMatch) continue;

            const explicitTarget = commitmentMatch[1] ? commitmentMatch[1].trim() : '';
            let taskTitle = commitmentMatch[2].trim();

            // Clean trailing punctuation/time/deadline clauses cleanly while preserving core action
            taskTitle = taskTitle
                .replace(/\s+(?:by|on|due|before)\s+(?:today(?:\s+itself)?|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week)\b.*/i, '')
                .replace(/\s+(?:today(?:\s+itself)?|tomorrow|tonight)\s+(?:at|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b.*/i, '')
                .replace(/\b(?:the|a|an)\s+/ig, '')
                .replace(/[,;:\s]+$/, '')
                .trim();

            if (!taskTitle || taskTitle.length < 3) continue;
            // Skip vague non-actions like "see", "check later" empty noise
            if (/^(see|wait|let you know|be fine|do that)$/i.test(taskTitle)) continue;

            taskTitle = taskTitle.charAt(0).toUpperCase() + taskTitle.slice(1);

            // Resolve assignee carefully
            let assignee = 'You';
            if (explicitTarget && !/^(i|we|you|please|someone|somebody)$/i.test(explicitTarget)) {
                assignee = normalizePersonName(explicitTarget);
            } else if (/sukhman|sukman/i.test(trimmed)) {
                assignee = 'Sukhman';
            } else if (/rohan/i.test(trimmed)) {
                assignee = 'Rohan Sharma';
            } else if (/avinash/i.test(trimmed)) {
                assignee = 'Avinash';
            } else if (/\b(?:we'll|we will|let's|we need|we should)\b/i.test(trimmed)) {
                assignee = 'Team';
            } else if (lineSpeaker && !/^(you|participant|host)$/i.test(lineSpeaker)) {
                assignee = normalizePersonName(lineSpeaker);
            }

            const due = parseDueDate(trimmed);
            const dedupeKey = `${assignee.toLowerCase()}::${taskTitle.toLowerCase()}`;
            if (seenTitles.has(dedupeKey)) continue;
            seenTitles.add(dedupeKey);

            tasks.push({
                id: String(tasks.length + 1),
                title: taskTitle,
                assignee,
                due,
                completed: false
            });
        }
    }

    return tasks;
}

/**
 * Deterministic extractive summarizer for live transcripts
 */
function generateLocalSummary(transcriptText, extractedTasks = []) {
    if (!transcriptText || typeof transcriptText !== 'string' || !transcriptText.trim()) {
        return ['Meeting room active and ready for discussion.'];
    }

    const lines = transcriptText
        .split(/\n+/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('['));

    if (lines.length === 0) {
        return ['Meeting room active and ready for discussion.'];
    }

    const speakers = new Set();
    const scored = [];
    const cueRegex = /\b(decided|agreed|plan|goal|deadline|deploy|release|review|fix|issue|bug|schedule|mix|stem|scale|bpm|ready|complete|update|important)\b/i;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(/^([A-Za-z][A-Za-z0-9 ._-]{0,30}):\s+(.+)$/);
        const speaker = m ? m[1].trim() : null;
        const body = m ? m[2].trim() : line;
        if (speaker) speakers.add(speaker);

        let score = body.split(/\s+/).length >= 4 ? 1 : 0;
        if (cueRegex.test(body)) score += 3;
        if (i === 0 || i === lines.length - 1) score += 1;
        scored.push({ text: speaker ? `${speaker}: ${body}` : body, score, idx: i });
    }

    scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
    const highlights = [];
    const used = new Set();
    for (const item of scored) {
        if (highlights.length >= 2) break;
        const norm = item.text.toLowerCase();
        if (!used.has(norm)) {
            used.add(norm);
            highlights.push(item.text.length > 140 ? `${item.text.slice(0, 137)}...` : item.text);
        }
    }

    const speakerList = Array.from(speakers);
    const metaBullet = speakerList.length > 0
        ? `Active speakers (${speakerList.length}): ${speakerList.join(', ')} across ${lines.length} statement${lines.length === 1 ? '' : 's'}.`
        : `${lines.length} discussion note${lines.length === 1 ? '' : 's'} captured.`;

    const bullets = [metaBullet, ...highlights];
    if (Array.isArray(extractedTasks) && extractedTasks.length > 0) {
        bullets.push(`Identified ${extractedTasks.length} action item${extractedTasks.length === 1 ? '' : 's'}.`);
    }
    return bullets;
}

// Process meeting transcript text and extract structured tasks + summary
const handleExtractTasks = async (req, res) => {
    const { transcript } = req.body || {};
    const geminiKey = process.env.GEMINI_API_KEY || req.headers['x-gemini-api-key'] || req.body?.geminiApiKey;

    if (geminiKey && transcript) {
        const candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-3-flash-preview'];
        for (const modelName of candidateModels) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;
                const prompt = `Extract action items and a 2-bullet summary from this meeting transcript in JSON format.
Transcript:
${transcript}

Return valid JSON:
{
  "summary": ["concise bullet 1", "concise bullet 2"],
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
                        const cleaned = rawJson.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
                        const parsed = JSON.parse(cleaned);
                        if (Array.isArray(parsed.tasks)) {
                            const normalizedTasks = parsed.tasks.map((t, idx) => {
                                let title = String(t.title || '').replace(/\b(?:the|a|an)\s+/ig, '').trim();
                                if (title) title = title.charAt(0).toUpperCase() + title.slice(1);
                                return {
                                    ...t,
                                    id: (t.id !== undefined && t.id !== null && String(t.id).trim() !== '')
                                        ? String(t.id)
                                        : `task-${Date.now()}-${idx + 1}`,
                                    title: title || t.title,
                                    assignee: normalizePersonName(t.assignee || 'You'),
                                    due: t.due || 'Upcoming',
                                    completed: Boolean(t.completed)
                                };
                            });
                            const summary = Array.isArray(parsed.summary) && parsed.summary.length > 0
                                ? parsed.summary
                                : generateLocalSummary(transcript, normalizedTasks);
                            return res.json({ tasks: normalizedTasks, summary, source: modelName });
                        }
                    }
                }
            } catch (err) {
                // Try next model or fall back to heuristic NLP
            }
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
    const summary = generateLocalSummary(transcript, tasks);
    res.json({ tasks, summary, source: 'heuristic-nlp' });
};

app.post('/api/extract-tasks', handleExtractTasks);
app.post('/extract-tasks', handleExtractTasks);

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`[NLP Task Service] Running on port ${PORT}`);
    });
}

module.exports = { app, extractLocalTasks, generateLocalSummary };
