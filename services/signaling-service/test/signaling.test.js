const test = require('node:test');
const assert = require('node:assert');
const { WebSocket } = require('ws');
const { createSignalingServer } = require('../index');

test('Signaling Service - WebRTC SDP & ICE Candidate Broadcast', async (t) => {
    // Start on port 0 (ephemeral)
    const wss = createSignalingServer(0);

    await new Promise((resolve) => {
        wss.on('listening', resolve);
    });

    const port = wss.address().port;

    t.after(() => {
        wss.close();
    });

    await t.test('broadcasts message to peer clients', async () => {
        const client1 = new WebSocket(`ws://127.0.0.1:${port}`);
        const client2 = new WebSocket(`ws://127.0.0.1:${port}`);

        await Promise.all([
            new Promise((resolve) => client1.on('open', resolve)),
            new Promise((resolve) => client2.on('open', resolve))
        ]);

        const signalPayload = JSON.stringify({
            type: 'offer',
            sdp: 'v=0\r\no=- 20518 2 IN IP4 127.0.0.1',
            sender: 'You'
        });

        const receivedMessagePromise = new Promise((resolve) => {
            client2.on('message', (data) => {
                resolve(data.toString());
            });
        });

        client1.send(signalPayload);

        const received = await receivedMessagePromise;
        assert.strictEqual(received, signalPayload);

        client1.close();
        client2.close();
    });
});
