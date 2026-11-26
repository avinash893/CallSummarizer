const test = require('node:test');
const assert = require('node:assert');
const { app } = require('../index');

test('NLP Task Service - Task Extraction & Indian Participant Naming', async (t) => {
    let server;
    let baseUrl;

    await new Promise((resolve) => {
        server = app.listen(0, () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });

    t.after(() => {
        server.close();
    });

    await t.test('GET /health returns 200 with service status', async () => {
        const res = await fetch(`${baseUrl}/health`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.service, 'NLP Task Service');
        assert.strictEqual(data.status, 'Healthy');
    });

    await t.test('POST /api/extract-tasks extracts action items assigned to Rohan Sharma', async () => {
        const payload = {
            transcript: 'Rohan Sharma will connect the signaling service by Friday. I will review the architecture tomorrow.'
        };

        const res = await fetch(`${baseUrl}/api/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data.tasks));
        assert.strictEqual(data.tasks.length, 2);

        // Verify Indian participant assignment
        const rohanTask = data.tasks.find((task) => task.assignee === 'Rohan Sharma');
        assert.ok(rohanTask, 'Expected a task assigned to Rohan Sharma');
        assert.strictEqual(rohanTask.title, 'Connect signaling service');
        assert.strictEqual(rohanTask.due, 'Friday');
    });

    await t.test('POST /api/extract-tasks handles empty body gracefully', async () => {
        const res = await fetch(`${baseUrl}/api/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data.tasks));
    });

    await t.test('extracts tasks for arbitrary speakers, vocatives, 24h times, and returns summary', async () => {
        const payload = {
            transcript: [
                'Alice: I will deploy the audio backend at 14:30.',
                'Alex, please test the pitch detector by Tuesday.',
                'Priya will prepare guitar stems tomorrow at 5 pm.'
            ].join('\n')
        };

        const res = await fetch(`${baseUrl}/api/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.tasks.length, 3);
        assert.ok(Array.isArray(data.summary) && data.summary.length >= 2);

        const aliceTask = data.tasks.find((task) => task.assignee === 'Alice');
        assert.ok(aliceTask, 'Expected task assigned to Alice');
        assert.strictEqual(aliceTask.due, 'Today at 14:30');

        const alexTask = data.tasks.find((task) => task.assignee === 'Alex');
        assert.ok(alexTask, 'Expected task assigned to Alex');
        assert.strictEqual(alexTask.due, 'Tuesday');

        const priyaTask = data.tasks.find((task) => task.assignee === 'Priya');
        assert.ok(priyaTask, 'Expected task assigned to Priya');
        assert.strictEqual(priyaTask.due, 'Tomorrow at 5 PM');
    });
});
