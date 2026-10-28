const test = require('node:test');
const assert = require('node:assert');
const { app } = require('../index');

test('Meeting Service - Health and Room Endpoints', async (t) => {
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

    await t.test('GET /health returns 200 and healthy status', async () => {
        const res = await fetch(`${baseUrl}/health`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.service, 'Meeting Service');
        assert.strictEqual(data.status, 'Healthy');
    });

    await t.test('GET /api/rooms/:id returns room details and participants', async () => {
        const res = await fetch(`${baseUrl}/api/rooms/strategy-sync`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.roomId, 'strategy-sync');
        assert.deepStrictEqual(data.participants, ['You', 'Rohan Sharma']);
        assert.strictEqual(data.status, 'active');
    });

    await t.test('POST /api/rooms creates a new room session', async () => {
        const res = await fetch(`${baseUrl}/api/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId: 'product-review', host: 'You' })
        });
        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.strictEqual(data.roomId, 'product-review');
        assert.strictEqual(data.status, 'created');
    });
});
