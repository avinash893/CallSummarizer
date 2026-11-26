const test = require('node:test');
const assert = require('node:assert');
const { WebSocket } = require('ws');
const { server, rooms } = require('../../../server');

test('Security Controls - Headers, CORS, SSRF, Path Traversal, Token Integrity & WS Isolation', async (t) => {
    let baseUrl;
    let wsUrl;

    await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            wsUrl = `ws://127.0.0.1:${port}`;
            resolve();
        });
    });

    t.after(() => {
        server.closeAllConnections?.();
        server.close();
    });

    await t.test('sets hardened HTTP security headers and strips x-powered-by', async () => {
        const res = await fetch(`${baseUrl}/health`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers.get('x-powered-by'), null);
        assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
        assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
        assert.strictEqual(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
        assert.strictEqual(res.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
    });

    await t.test('rejects untrusted third-party CORS origins', async () => {
        const res = await fetch(`${baseUrl}/health`, {
            headers: { Origin: 'https://evil-attacker.example' }
        });
        assert.strictEqual(res.headers.get('access-control-allow-origin'), null);
    });

    await t.test('blocks SSRF URLs in separate-stems and get-pitch-and-lyrics', async () => {
        for (const badUrl of [
            'http://169.254.169.254/latest/meta-data/',
            'http://127.0.0.1:8080/health',
            'http://localhost:3000/secret',
            'file:///etc/passwd'
        ]) {
            const res = await fetch(`${baseUrl}/api/sargam/separate-stems`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: badUrl })
            });
            assert.strictEqual(res.status, 400, `Expected 400 for ${badUrl}`);
        }

        const pitchSsrf = await fetch(`${baseUrl}/api/sargam/get-pitch-and-lyrics?vocal_url=${encodeURIComponent('http://127.0.0.1:9000/internal.wav')}`);
        assert.strictEqual(pitchSsrf.status, 400);
    });

    await t.test('blocks path traversal and protocol injection in /api/sargam/audio', async () => {
        for (const badFile of ['../../etc/passwd', '../.env', '/etc/passwd', 'http://evil.com/a.mp3']) {
            const res = await fetch(`${baseUrl}/api/sargam/audio?file=${encodeURIComponent(badFile)}`);
            assert.strictEqual(res.status, 400, `Expected 400 for file=${badFile}`);
        }
    });

    await t.test('rejects forged or tampered HMAC session tokens', async () => {
        const fakePayload = Buffer.from(JSON.stringify({
            sessionId: 'forged-id',
            user: { name: 'Attacker', email: 'attacker@evil.com' },
            createdAt: new Date().toISOString()
        })).toString('base64url');
        const forgedToken = `cs.${fakePayload}.invalid-signature`;

        const res = await fetch(`${baseUrl}/api/auth/session`, {
            headers: { 'X-Session-ID': forgedToken }
        });
        assert.strictEqual(res.status, 401);
    });

    await t.test('WebSocket drops unjoined global broadcasts and malformed frames across clients', async (sub) => {
        const ws1 = new WebSocket(wsUrl);
        const ws2 = new WebSocket(wsUrl);
        sub.after(() => {
            try { ws1.close(); } catch (e) {}
            try { ws2.close(); } catch (e) {}
            rooms.delete('isolated-room-sec');
        });

        await Promise.all([
            new Promise((res) => ws1.once('open', res)),
            new Promise((res) => ws2.once('open', res))
        ]);

        // Join ws2 into a room, leave ws1 unjoined
        const joinedPromise = new Promise((res) => {
            ws2.once('message', (raw) => res(JSON.parse(raw.toString())));
        });
        ws2.send(JSON.stringify({ type: 'join-room', roomId: 'isolated-room-sec', user: { name: 'Victim', email: 'victim@secret.com' } }));
        const joinAck = await joinedPromise;

        // Public room list must NOT expose raw participant email
        assert.strictEqual(joinAck.participants[0].email, undefined);

        let leaked = false;
        ws2.on('message', () => {
            leaked = true;
        });

        ws1.send('not-valid-json-payload');
        ws1.send(JSON.stringify({ type: 'unknown-global-event', secret: 'inject' }));

        await new Promise((r) => setTimeout(r, 120));
        assert.strictEqual(leaked, false, 'Unjoined/malformed WebSocket frames must not leak to other clients');
    });

    await t.test('rejects forged JWT and unauthenticated session deletion when NODE_ENV=production', async (sub) => {
        const prevEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        sub.after(() => {
            process.env.NODE_ENV = prevEnv;
        });

        const fakePayload = Buffer.from(JSON.stringify({
            sub: 'forged',
            name: 'Attacker',
            email: 'attacker@evil.com'
        })).toString('base64url');
        const jwtRes = await fetch(`${baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: `header.${fakePayload}.sig` })
        });
        assert.strictEqual(jwtRes.status, 401);

        const delRes = await fetch(`${baseUrl}/api/rooms/some-room/session`, { method: 'DELETE' });
        assert.strictEqual(delRes.status, 401);
    });
});
