const test = require('node:test');
const assert = require('node:assert');
const { app } = require('../index');

test('API Gateway - Health Check and Route Routing', async (t) => {
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

    await t.test('GET /health returns 200 with online status', async () => {
        const res = await fetch(`${baseUrl}/health`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.status, 'API Gateway Online');
        assert.ok(data.timestamp);
    });

    await t.test('GET /api/meetings returns route message', async () => {
        const res = await fetch(`${baseUrl}/api/meetings`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.message, 'Routed to Meeting Service (Port 5001)');
    });

    await t.test('GET /api/nlp-tasks returns route message', async () => {
        const res = await fetch(`${baseUrl}/api/nlp-tasks`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.message, 'Routed to NLP Task Service (Port 5003)');
    });
});
