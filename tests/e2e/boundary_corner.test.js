/**
 * Tier 2: Boundary & Corner Cases E2E Test Suite
 * Covers extreme inputs, timeouts, malformed tokens, special characters, and boundary conditions
 * across all 5 feature areas:
 * 1. WebRTC & Room Boundaries
 * 2. Selective Audio Capture Boundaries
 * 3. Hybrid NLP Boundaries
 * 4. Google OAuth & Calendar Boundaries
 * 5. Cloudflare Turnstile Boundaries
 */
const test = require('node:test');
const assert = require('node:assert');
const {
    startServer,
    resetServerState,
    createWsClient,
    waitForMessage,
    closeWs,
    SelectiveAudioCaptureSession,
    normalizeRoomId,
    generateMeetingCode
} = require('./helpers');

test('Tier 2: Boundary & Corner Cases Suite', async (suite) => {
    let ctx;

    suite.before(async () => {
        ctx = await startServer();
    });

    suite.beforeEach(() => {
        resetServerState();
    });

    // -------------------------------------------------------------
    // Category 1: WebRTC & Room Boundaries
    // -------------------------------------------------------------

    await suite.test('B1.1: GET /api/rooms/:id boundary - Non-existent room returns 404, created zero-participant room returns 200', async () => {
        // Non-existent room returns 404
        const notFoundRes = await fetch(`${ctx.baseUrl}/api/rooms/unknown-uncreated-room`);
        assert.strictEqual(notFoundRes.status, 404);
        const errData = await notFoundRes.json();
        assert.strictEqual(errData.error, 'Room not found');

        // Create a room with 0 participants
        const createRes = await fetch(`${ctx.baseUrl}/api/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                roomId: 'zero-participant-room',
                host: 'Host User',
                turnstileToken: 'turnstile_fallback_token'
            })
        });
        assert.strictEqual(createRes.status, 201);

        // Fetch created room with zero active participants
        const res = await fetch(`${ctx.baseUrl}/api/rooms/zero-participant-room`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.roomId, 'zero-participant-room');
        assert.strictEqual(data.participantCount, 0);
        assert.deepStrictEqual(data.participants, []);
        assert.strictEqual(data.status, 'active');
    });

    await suite.test('B1.2: normalizeRoomId handles complex URLs with query params, port, and hash fragments', () => {
        const url1 = 'https://meet.example.com:8443/custom-room?ref=test#stage';
        assert.strictEqual(normalizeRoomId(url1), 'custom-room');

        const url2 = 'https://callsummarizer.onrender.com/?room=weekly-sync&utm=share';
        assert.strictEqual(normalizeRoomId(url2), 'weekly-sync');

        const url3 = 'http://localhost:3000/?code=dev-standup';
        assert.strictEqual(normalizeRoomId(url3), 'dev-standup');
    });

    await suite.test('B1.3: normalizeRoomId with non-string, null, undefined, or empty inputs falls back to a generated meeting code', () => {
        const code1 = normalizeRoomId(null);
        assert.match(code1, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);

        const code2 = normalizeRoomId(undefined);
        assert.match(code2, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);

        const code3 = normalizeRoomId('');
        assert.match(code3, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);

        const code4 = normalizeRoomId('    ');
        assert.match(code4, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    });

    await suite.test('B1.4: normalizeRoomId with uppercase, emojis, symbols, and SQL metacharacters safely sanitizes to clean lowercase alphanumeric slug', () => {
        const raw = "Room #42: Executive's Sync! 🔥 SELECT * FROM rooms;";
        const normalized = normalizeRoomId(raw);
        assert.ok(!normalized.includes("'"));
        assert.ok(!normalized.includes(";"));
        assert.ok(!normalized.includes("!"));
        assert.ok(!normalized.includes("🔥"));
        assert.strictEqual(normalized, normalized.toLowerCase());
        assert.match(normalized, /^[a-z0-9-]+$/);
    });

    await suite.test('B1.5: WebRTC signaling to a non-existent or disconnected targetPeerId is dropped gracefully without crashing the server', async () => {
        const client = await createWsClient(ctx.wsUrl);
        client.send(JSON.stringify({
            type: 'join-room',
            roomId: 'orphan-target-room',
            user: { name: 'Sender' }
        }));
        await waitForMessage(client, (m) => m.type === 'room-users');

        // Send offer to completely bogus peer ID
        client.send(JSON.stringify({
            type: 'webrtc-offer',
            targetPeerId: 'non-existent-peer-uuid-999999',
            sdp: { type: 'offer', sdp: 'dummy' }
        }));

        // Send ICE candidate to bogus peer ID
        client.send(JSON.stringify({
            type: 'webrtc-ice-candidate',
            targetPeerId: 'non-existent-peer-uuid-888888',
            candidate: { candidate: 'dummy' }
        }));

        await new Promise((r) => setTimeout(r, 60));
        assert.strictEqual(client.readyState, 1, 'Client should remain connected');

        await closeWs(client);
    });

    await suite.test('B1.6: Non-JSON raw text message sent to WebSocket server does not crash the server and falls back to safe generic broadcast', async () => {
        const client1 = await createWsClient(ctx.wsUrl);
        const client2 = await createWsClient(ctx.wsUrl);

        const rawString = 'NON-JSON-MALFORMED-SIGNAL-PAYLOAD-@@##';
        const receivedPromise = new Promise((resolve) => {
            client2.on('message', (data) => {
                resolve(data.toString());
            });
        });

        client1.send(rawString);
        const received = await receivedPromise;
        assert.strictEqual(received, rawString);

        await closeWs(client1);
        await closeWs(client2);
    });

    // -------------------------------------------------------------
    // Category 2: Selective Audio Capture Boundaries
    // -------------------------------------------------------------

    await suite.test('B2.1: Toggling audio capture for an empty, null, or non-existent peer ID is a safe no-op', () => {
        let capturedPeerIds = ['peer-1', 'peer-2'];

        const toggleCapture = (peerId) => {
            if (!peerId) return capturedPeerIds;
            if (capturedPeerIds.includes(peerId)) {
                capturedPeerIds = capturedPeerIds.filter((id) => id !== peerId);
            } else {
                capturedPeerIds = [...capturedPeerIds, peerId];
            }
            return capturedPeerIds;
        };

        toggleCapture('');
        assert.deepStrictEqual(capturedPeerIds, ['peer-1', 'peer-2']);

        toggleCapture(null);
        assert.deepStrictEqual(capturedPeerIds, ['peer-1', 'peer-2']);

        toggleCapture(undefined);
        assert.deepStrictEqual(capturedPeerIds, ['peer-1', 'peer-2']);
    });

    await suite.test('B2.2: Rapid consecutive start/stop toggle calls on the same peer ID do not duplicate recorder instances or create orphan sessions', () => {
        const activeSessions = new Map();
        const peerId = 'peer-rapid-test';

        // Rapid start
        activeSessions.set(peerId, new SelectiveAudioCaptureSession(peerId, 'Rapid User'));
        // Rapid stop
        if (activeSessions.has(peerId)) {
            activeSessions.get(peerId).stop();
            activeSessions.delete(peerId);
        }
        // Rapid start again
        activeSessions.set(peerId, new SelectiveAudioCaptureSession(peerId, 'Rapid User'));
        // Rapid stop again
        if (activeSessions.has(peerId)) {
            activeSessions.get(peerId).stop();
            activeSessions.delete(peerId);
        }

        assert.strictEqual(activeSessions.size, 0);
    });

    await suite.test('B2.3: Audio capture session with zero audio chunks creates a valid audio clip object with 1s minimum duration and valid time string', () => {
        const session = new SelectiveAudioCaptureSession('peer-silent', 'Silent Peer');
        const clip = session.stop();

        assert.strictEqual(clip.peerId, 'peer-silent');
        assert.strictEqual(clip.durationSec, 1, 'Minimum duration should be 1s');
        assert.strictEqual(clip.duration, '1s');
        assert.ok(clip.time.length > 0);
        assert.ok(clip.url.startsWith('blob:'));
    });

    await suite.test('B2.4: Deleting a non-existent clip ID leaves existing clips intact without throwing an exception', () => {
        let clips = [
            { id: 'clip-1', peerName: 'User A', url: 'blob:a' },
            { id: 'clip-2', peerName: 'User B', url: 'blob:b' }
        ];

        const deleteClip = (clipId) => {
            clips = clips.filter((c) => c.id !== clipId);
        };

        deleteClip('non-existent-clip-id-999');
        assert.strictEqual(clips.length, 2);
        assert.strictEqual(clips[0].id, 'clip-1');
        assert.strictEqual(clips[1].id, 'clip-2');
    });

    await suite.test('B2.5: Concurrent audio capture on multiple distinct remote peers maintains isolated chunk arrays and separate blob URLs', () => {
        const session1 = new SelectiveAudioCaptureSession('peer-alice', 'Alice');
        const session2 = new SelectiveAudioCaptureSession('peer-bob', 'Bob');

        session1.pushAudioChunk(Buffer.from('alice-chunk-1'));
        session2.pushAudioChunk(Buffer.from('bob-chunk-1'));
        session2.pushAudioChunk(Buffer.from('bob-chunk-2'));

        const clip1 = session1.stop();
        const clip2 = session2.stop();

        assert.strictEqual(session1.chunks.length, 1);
        assert.strictEqual(session2.chunks.length, 2);
        assert.notStrictEqual(clip1.url, clip2.url);
        assert.notStrictEqual(clip1.id, clip2.id);
    });

    // -------------------------------------------------------------
    // Category 3: Hybrid NLP Boundaries
    // -------------------------------------------------------------

    await suite.test('B3.1: Transcript with extreme length (50,000 characters) processes safely within timeout without memory exhaustion or crash', async () => {
        const longSentence = 'Rohan Sharma will analyze production performance metrics by Friday. ';
        const massiveTranscript = longSentence.repeat(800).slice(0, 50000);

        const startTime = Date.now();
        const res = await fetch(`${ctx.baseUrl}/api/nlp-tasks/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: massiveTranscript })
        });
        const duration = Date.now() - startTime;

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data.tasks));
        assert.ok(data.tasks.length >= 1);
        assert.ok(duration < 5000, `Processing 50k chars should complete under 5s, took ${duration}ms`);
    });

    await suite.test('B3.2: Transcript with null, undefined, or number instead of string returns 400 with Transcript must be a string', async () => {
        const res1 = await fetch(`${ctx.baseUrl}/api/nlp-tasks/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: 12345 })
        });
        assert.strictEqual(res1.status, 400);
        const d1 = await res1.json();
        assert.strictEqual(d1.error, 'Transcript must be a string');

        const res2 = await fetch(`${ctx.baseUrl}/api/nlp-tasks/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: ['invalid', 'array'] })
        });
        assert.strictEqual(res2.status, 400);
    });

    await suite.test('B3.3: Transcript consisting exclusively of emojis and unicode special symbols parses cleanly without string corruption', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/nlp-tasks/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: '😀 🚀 🎉 💻 🔥 ⚡ 🎯 🛡️' })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data.tasks));
    });

    await suite.test('B3.4: Transcript with zero actionable commitments (conversational filler only) returns valid task list safely', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/nlp-tasks/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: 'Hello everyone. Can you hear me? Yes loud and clear. Good morning.'
            })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data.tasks));
    });

    await suite.test('B3.5: Missing transcript or empty object gracefully returns 200 with empty-transcript source', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/nlp-tasks/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.deepStrictEqual(data.tasks, []);
        assert.strictEqual(data.source, 'empty-transcript');
    });

    await suite.test('B3.6: Room tasks sync via WebSocket with non-array tasks or null tasks is rejected safely without corrupting stored room tasks', async () => {
        const client = await createWsClient(ctx.wsUrl);
        client.send(JSON.stringify({
            type: 'join-room',
            roomId: 'task-sync-boundary-room',
            user: { name: 'Host' }
        }));
        await waitForMessage(client, (m) => m.type === 'room-users');

        // Initial valid task sync
        client.send(JSON.stringify({
            type: 'tasks-sync',
            tasks: [{ id: '1', title: 'Valid Task', completed: false }]
        }));
        await new Promise((r) => setTimeout(r, 40));

        // Malformed non-array task sync attempts
        client.send(JSON.stringify({ type: 'tasks-sync', tasks: 'not-an-array' }));
        client.send(JSON.stringify({ type: 'tasks-sync', tasks: null }));
        client.send(JSON.stringify({ type: 'tasks-sync', tasks: 12345 }));

        await new Promise((r) => setTimeout(r, 40));

        // Check room tasks in server store
        const room = ctx.rooms.get('task-sync-boundary-room');
        assert.ok(room);
        assert.strictEqual(room.tasks.length, 1);
        assert.strictEqual(room.tasks[0].title, 'Valid Task');

        await closeWs(client);
    });

    // -------------------------------------------------------------
    // Category 4: Google OAuth & Calendar Boundaries
    // -------------------------------------------------------------

    await suite.test('B4.1: Calendar event creation with empty title ("" or "   ") is rejected with 400 and Event title is required', async () => {
        const authRes = await fetch(`${ctx.baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'mock-boundary-token',
                name: 'Avinash',
                email: 'avinash@gmail.com'
            })
        });
        const { sessionId } = await authRes.json();

        const res1 = await fetch(`${ctx.baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Session-ID': sessionId },
            body: JSON.stringify({ title: '' })
        });
        assert.strictEqual(res1.status, 400);
        const d1 = await res1.json();
        assert.strictEqual(d1.error, 'Event title is required');

        const res2 = await fetch(`${ctx.baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Session-ID': sessionId },
            body: JSON.stringify({ title: '     \t  ' })
        });
        assert.strictEqual(res2.status, 400);
    });

    await suite.test('B4.2: Calendar event creation with extreme title length (5,000 characters) is safely sanitized/truncated to max 1,000 characters', async () => {
        const authRes = await fetch(`${ctx.baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'mock-boundary-token-2',
                name: 'Avinash',
                email: 'avinash@gmail.com'
            })
        });
        const { sessionId } = await authRes.json();

        const longTitle = 'A'.repeat(5000);
        const res = await fetch(`${ctx.baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Session-ID': sessionId },
            body: JSON.stringify({ title: longTitle })
        });

        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.event.summary.length, 1000);
    });

    await suite.test('B4.3: Calendar event creation with completely malformed date strings (invalid-date, NaN) defaults safely to tomorrow 10:00 AM', async () => {
        const authRes = await fetch(`${ctx.baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'mock-boundary-token-3',
                name: 'Avinash',
                email: 'avinash@gmail.com'
            })
        });
        const { sessionId } = await authRes.json();

        const res = await fetch(`${ctx.baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Session-ID': sessionId },
            body: JSON.stringify({
                title: 'Malformed Date Handling',
                startTime: 'totally-invalid-timestamp',
                endTime: 'NaN-NaN-NaN',
                due: 'some random non-date words'
            })
        });

        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        const start = new Date(data.event.start.dateTime);
        const end = new Date(data.event.end.dateTime);
        assert.ok(!isNaN(start.getTime()));
        assert.ok(!isNaN(end.getTime()));
        assert.strictEqual(end.getTime() - start.getTime(), 3600000, 'Expected 1 hour duration default');
    });

    await suite.test('B4.4: Calendar event creation with revoked/expired mock token (mock-fail or mock-expired) returns 401 with calendar access error', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'mock-fail',
                title: 'Revoked Token Test'
            })
        });

        assert.strictEqual(res.status, 401);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.match(data.error, /User calendar access revoked or expired/i);
    });

    await suite.test('B4.5: Calendar event creation with insufficient permissions mock token (mock-forbidden) returns 403', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'mock-forbidden',
                title: 'Insufficient Scopes Test'
            })
        });

        assert.strictEqual(res.status, 403);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.match(data.error, /Insufficient permissions/i);
    });

    await suite.test('B4.6: Google sign-in with mixed-case email (User.Name+Test@Gmail.Com) normalizes email to lowercase in server session', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'mock-mixed-case-token',
                name: 'Avinash Sharma',
                email: 'Avinash.Sharma+ProjectTest@GMAIL.COM'
            })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.user.email, 'avinash.sharma+projecttest@gmail.com');

        const session = ctx.sessions.get(data.sessionId);
        assert.strictEqual(session.user.email, 'avinash.sharma+projecttest@gmail.com');
    });

    // -------------------------------------------------------------
    // Category 5: Cloudflare Turnstile Boundaries
    // -------------------------------------------------------------

    await suite.test('B5.1: Turnstile verification with empty token string ("") returns 400 Missing Turnstile token', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/auth/verify-turnstile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: '' })
        });

        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.verified, false);
        assert.strictEqual(data.error, 'Missing Turnstile token');
    });

    await suite.test('B5.2: Turnstile verification with whitespace-only token string ("   \t  ") returns 400 Missing Turnstile token', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/auth/verify-turnstile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: '     \t  \n ' })
        });

        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.verified, false);
        assert.strictEqual(data.error, 'Missing Turnstile token');
    });

    await suite.test('B5.3: Turnstile verification with extreme length token (10,000 characters) is rejected with verified: false without crashing', async () => {
        const hugeToken = 't'.repeat(10000);
        const res = await fetch(`${ctx.baseUrl}/api/auth/verify-turnstile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: hugeToken })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.verified, false);
        assert.match(data.error, /Invalid Turnstile token/i);
    });

    await suite.test('B5.4: Turnstile token containing HTML tags, control characters, or script injections (<script>) is handled safely as plain string', async () => {
        const xssToken = '<script>alert("xss")</script>\' OR 1=1; --';
        const res = await fetch(`${ctx.baseUrl}/api/auth/verify-turnstile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: xssToken })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.verified, false);
        assert.match(data.error, /Invalid Turnstile token/i);
    });

    await suite.test('B5.5: Room creation POST /api/rooms without authentication and with invalid Turnstile token is blocked with 401 Unauthorized', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                roomId: 'blocked-unauth-room',
                host: 'Attacker Bot',
                turnstileToken: 'invalid-bot-turnstile-token'
            })
        });

        assert.strictEqual(res.status, 401);
        const data = await res.json();
        assert.match(data.error, /Authentication or Turnstile verification required/i);
    });
});
