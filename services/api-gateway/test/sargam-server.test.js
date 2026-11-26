const test = require('node:test');
const assert = require('node:assert');
const { WebSocket } = require('ws');
const { server, rooms, normalizeSargamPayload } = require('../../../server');

test('SargamJam Unified Server - Sargam APIs, Vocal Coach & Jam WebSocket Sync', async (t) => {
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

    await t.test('GET /api/sargam/health and POST /api/sargam/separate-stems validation', async () => {
        const healthRes = await fetch(`${baseUrl}/api/sargam/health`);
        assert.strictEqual(healthRes.status, 200);
        const healthData = await healthRes.json();
        assert.strictEqual(typeof healthData.ok, 'boolean');
        assert.ok(healthData.backend);

        const badSepRes = await fetch(`${baseUrl}/api/sargam/separate-stems`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.strictEqual(badSepRes.status, 400);

        const normalized = normalizeSargamPayload({
            title: 'Test Raag',
            vocals: '/api/audio?file=vid_abc123/vocals.mp3',
            instruments: '/api/audio?file=vid_abc123/no_vocals.mp3',
            note_bars: [{ start: 0.2, end: 0.8, midi: 60, avg_hz: 261.6 }],
            pitch_curve: [{ t: 0.2, hz: 261.6 }],
            lyrics: [{ start: 0.2, end: 1.5, text: 'Sa Re Ga' }]
        }, 'https://khurana-aaa3--sargam-tuner-backend-fastapi-app.us-east.modal.run');
        assert.strictEqual(normalized.vocalUrl, '/api/sargam/audio?file=vid_abc123%2Fvocals.mp3');
        assert.strictEqual(normalized.instUrl, '/api/sargam/audio?file=vid_abc123%2Fno_vocals.mp3');
        assert.strictEqual(normalized.noteBars[0].freq, 261.6);
        assert.strictEqual(normalized.pitchCurve[0].time, 0.2);
        assert.strictEqual(normalized.lyrics[0].text, 'Sa Re Ga');
    });

    await t.test('POST /api/ai-vocal-coach returns validation 400 when empty and coaching analysis when valid', async () => {
        const emptyRes = await fetch(`${baseUrl}/api/ai-vocal-coach`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.strictEqual(emptyRes.status, 400);

        const coachRes = await fetch(`${baseUrl}/api/ai-vocal-coach`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                raga: 'Yaman',
                tonicLabel: 'C#4',
                taal: 'Teentaal (16)',
                bpm: 108,
                userAvgHz: 277.9,
                refAvgHz: 277.18,
                avgCentsOffset: 4.5,
                inTunePercent: 86,
                stabilityCents: 11.2,
                durationSec: 18.4,
                sampleNotes: ['Sa', 'Ga', 'Tivra Ma', 'Pa', 'Ni']
            })
        });
        assert.strictEqual(coachRes.status, 200);
        const data = await coachRes.json();
        assert.strictEqual(data.success, true);
        assert.ok(data.analysis);
        assert.ok(data.analysis.score >= 25 && data.analysis.score <= 100);
        assert.ok(Array.isArray(data.analysis.drills) && data.analysis.drills.length > 0);
        assert.ok(data.analysis.raagTip);
    });

    await t.test('WebSocket broadcasts jam-state-sync and pitch-telemetry across peers and updates room state', async (sub) => {
        const ws1 = new WebSocket(wsUrl);
        const ws2 = new WebSocket(wsUrl);
        sub.after(() => {
            try { ws1.close(); } catch (e) {}
            try { ws2.close(); } catch (e) {}
            rooms.delete('yaman-riyaz-session');
        });

        await Promise.all([
            new Promise((res) => ws1.once('open', res)),
            new Promise((res) => ws2.once('open', res))
        ]);

        const room1UsersPromise = new Promise((res) => {
            ws1.on('message', (raw) => {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'room-users') res(msg);
            });
        });

        ws1.send(JSON.stringify({
            type: 'join-room',
            roomId: 'yaman-riyaz-session',
            user: { name: 'Riya', instrument: 'Vocalist' }
        }));

        const ack1 = await room1UsersPromise;
        assert.ok(ack1.jamState);
        assert.strictEqual(ack1.jamState.raga, 'All Notes');

        const room2UsersPromise = new Promise((res) => {
            const handler = (raw) => {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'room-users') {
                    ws2.off('message', handler);
                    res(msg);
                }
            };
            ws2.on('message', handler);
        });

        ws2.send(JSON.stringify({
            type: 'join-room',
            roomId: 'yaman-riyaz-session',
            user: { name: 'Kabir', instrument: 'Tabla / Beats' }
        }));

        await room2UsersPromise;

        const jamSyncPromise = new Promise((res) => {
            const handler = (raw) => {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'jam-state-sync') {
                    ws2.off('message', handler);
                    res(msg);
                }
            };
            ws2.on('message', handler);
        });

        ws1.send(JSON.stringify({
            type: 'jam-state-sync',
            jamState: { tonicMidi: 62, raga: 'Yaman', bpm: 112, isTanpuraOn: true }
        }));

        const synced = await jamSyncPromise;
        assert.strictEqual(synced.jamState.raga, 'Yaman');
        assert.strictEqual(synced.jamState.tonicMidi, 62);
        assert.strictEqual(synced.jamState.bpm, 112);

        const roomRes = await fetch(`${baseUrl}/api/rooms/yaman-riyaz-session`);
        assert.strictEqual(roomRes.status, 200);
        const roomData = await roomRes.json();
        assert.strictEqual(roomData.jamState.raga, 'Yaman');

        ws1.close();
        ws2.close();
        rooms.delete('yaman-riyaz-session');
    });
});
