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
            transcript: 'Rohan will connect the signaling service by Friday.'
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
});
