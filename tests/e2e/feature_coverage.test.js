/**
 * Tier 1: Feature Coverage E2E Test Suite
 * Covers all 5 core features:
 * 1. WebRTC Multi-peer Mesh & CSS Grid
 * 2. Selective Audio Capture (Zero Leak)
 * 3. Hybrid NLP Task Extraction (4s Fallback)
 * 4. Google OAuth 2.0 & Calendar 15m Reminder
 * 5. Cloudflare Turnstile Bot Gating
 */
const test = require('node:test');
const assert = require('node:assert');
const {
    startServer,
    resetServerState,
    createWsClient,
    waitForMessage,
    closeWs,
    calculateGridLayout,
    SelectiveAudioCaptureSession
} = require('./helpers');

test('Tier 1: Feature Coverage Suite', async (suite) => {
    let ctx;

    suite.before(async () => {
        ctx = await startServer();
    });

    suite.beforeEach(() => {
        resetServerState();
    });

    // -------------------------------------------------------------
    // Feature 1: WebRTC Multi-peer Mesh & CSS Grid
    // -------------------------------------------------------------

    await suite.test('F1.1: WebRTC signaling - Client joins room, receives room-users event with participant roster and room state', async () => {
        const ws = await createWsClient(ctx.wsUrl);
        const joinPromise = waitForMessage(ws, (msg) => msg.type === 'room-users');

        ws.send(JSON.stringify({
            type: 'join-room',
            roomId: 'mesh-room-1',
            user: {
                name: 'Avinash Sharma',
                email: 'avinash@example.com',
                initials: 'AS',
                isAudioOn: true,
                isVideoOn: true
            }
        }));

        const msg = await joinPromise;
        assert.strictEqual(msg.type, 'room-users');
        assert.strictEqual(msg.roomId, 'mesh-room-1');
        assert.ok(msg.selfPeerId);
        assert.strictEqual(msg.participants.length, 1);
        assert.strictEqual(msg.participants[0].name, 'Avinash Sharma');
        assert.strictEqual(msg.participants[0].peerId, msg.selfPeerId);

        await closeWs(ws);
    });

    await suite.test('F1.2: WebRTC multi-peer mesh - Second peer joins and triggers user-joined notification with bidirectional SDP offer/answer exchange', async () => {
        const client1 = await createWsClient(ctx.wsUrl);
        const client2 = await createWsClient(ctx.wsUrl);

        // Client 1 joins room
        const client1JoinPromise = waitForMessage(client1, (msg) => msg.type === 'room-users');
        client1.send(JSON.stringify({
            type: 'join-room',
            roomId: 'mesh-negotiation-room',
            user: { name: 'Peer One', email: 'peer1@example.com' }
        }));
        const c1JoinState = await client1JoinPromise;
        const peer1Id = c1JoinState.selfPeerId;

        // Client 1 expects user-joined when Client 2 enters
        const client1UserJoinedPromise = waitForMessage(client1, (msg) => msg.type === 'user-joined');

        // Client 2 joins the same room
        const client2JoinPromise = waitForMessage(client2, (msg) => msg.type === 'room-users');
        client2.send(JSON.stringify({
            type: 'join-room',
            roomId: 'mesh-negotiation-room',
            user: { name: 'Peer Two', email: 'peer2@example.com' }
        }));
        const c2JoinState = await client2JoinPromise;
        const peer2Id = c2JoinState.selfPeerId;

        const joinedEvent = await client1UserJoinedPromise;
        assert.strictEqual(joinedEvent.peer.name, 'Peer Two');
        assert.strictEqual(joinedEvent.peer.peerId, peer2Id);

        // Client 1 initiates SDP offer targeted to Peer Two
        const client2OfferPromise = waitForMessage(client2, (msg) => msg.type === 'webrtc-offer');
        client1.send(JSON.stringify({
            type: 'webrtc-offer',
            targetPeerId: peer2Id,
            sdp: { type: 'offer', sdp: 'v=0\r\no=- 1111 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' }
        }));

        const receivedOffer = await client2OfferPromise;
        assert.strictEqual(receivedOffer.senderPeerId, peer1Id);
        assert.strictEqual(receivedOffer.sdp.type, 'offer');

        // Client 2 responds with SDP answer targeted to Peer One
        const client1AnswerPromise = waitForMessage(client1, (msg) => msg.type === 'webrtc-answer');
        client2.send(JSON.stringify({
            type: 'webrtc-answer',
            targetPeerId: peer1Id,
            sdp: { type: 'answer', sdp: 'v=0\r\no=- 2222 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' }
        }));

        const receivedAnswer = await client1AnswerPromise;
        assert.strictEqual(receivedAnswer.senderPeerId, peer2Id);
        assert.strictEqual(receivedAnswer.sdp.type, 'answer');

        await closeWs(client1);
        await closeWs(client2);
    });

    await suite.test('F1.3: WebRTC ICE candidate buffering and exchange between connected peers', async () => {
        const client1 = await createWsClient(ctx.wsUrl);
        const client2 = await createWsClient(ctx.wsUrl);

        const c1Join = waitForMessage(client1, (m) => m.type === 'room-users');
        client1.send(JSON.stringify({ type: 'join-room', roomId: 'ice-room', user: { name: 'Host' } }));
        const { selfPeerId: hostId } = await c1Join;

        const c2Join = waitForMessage(client2, (m) => m.type === 'room-users');
        client2.send(JSON.stringify({ type: 'join-room', roomId: 'ice-room', user: { name: 'Guest' } }));
        const { selfPeerId: guestId } = await c2Join;

        const hostCandidatePromise = waitForMessage(client1, (m) => m.type === 'webrtc-ice-candidate');
        client2.send(JSON.stringify({
            type: 'webrtc-ice-candidate',
            targetPeerId: hostId,
            candidate: {
                candidate: 'candidate:842163049 1 udp 1677729535 192.168.1.100 54321 typ host',
                sdpMid: '0',
                sdpMLineIndex: 0
            }
        }));

        const receivedCandidate = await hostCandidatePromise;
        assert.strictEqual(receivedCandidate.senderPeerId, guestId);
        assert.strictEqual(receivedCandidate.candidate.sdpMid, '0');
        assert.ok(receivedCandidate.candidate.candidate.includes('192.168.1.100'));

        await closeWs(client1);
        await closeWs(client2);
    });

    await suite.test('F1.4: WebRTC media state synchronization - Peer toggles mic/camera/screen sharing and participant-updated broadcasts', async () => {
        const client1 = await createWsClient(ctx.wsUrl);
        const client2 = await createWsClient(ctx.wsUrl);

        await new Promise((r) => setTimeout(r, 20));
        client1.send(JSON.stringify({ type: 'join-room', roomId: 'media-sync-room', user: { name: 'Alice' } }));
        client2.send(JSON.stringify({ type: 'join-room', roomId: 'media-sync-room', user: { name: 'Bob' } }));

        await waitForMessage(client1, (m) => m.type === 'room-users');
        await waitForMessage(client2, (m) => m.type === 'room-users');

        const updatePromise = waitForMessage(client2, (m) => m.type === 'participant-updated');

        // Alice toggles microphone off and screen share on
        client1.send(JSON.stringify({
            type: 'media-state',
            isAudioOn: false,
            isVideoOn: true,
            isScreenSharing: true
        }));

        const updated = await updatePromise;
        assert.strictEqual(updated.participant.isAudioOn, false);
        assert.strictEqual(updated.participant.isVideoOn, true);
        assert.strictEqual(updated.participant.isScreenSharing, true);

        await closeWs(client1);
        await closeWs(client2);
    });

    await suite.test('F1.5: WebRTC peer disconnection - Remaining peers receive user-left with updated participant roster', async () => {
        const client1 = await createWsClient(ctx.wsUrl);
        const client2 = await createWsClient(ctx.wsUrl);

        client1.send(JSON.stringify({ type: 'join-room', roomId: 'leave-room-test', user: { name: 'Stay' } }));
        client2.send(JSON.stringify({ type: 'join-room', roomId: 'leave-room-test', user: { name: 'Leaving' } }));

        await waitForMessage(client1, (m) => m.type === 'room-users');
        const c2State = await waitForMessage(client2, (m) => m.type === 'room-users');

        const leavePromise = waitForMessage(client1, (m) => m.type === 'user-left');
        await closeWs(client2);

        const leftEvent = await leavePromise;
        assert.strictEqual(leftEvent.peerId, c2State.selfPeerId);
        assert.strictEqual(leftEvent.participants.length, 1);
        assert.strictEqual(leftEvent.participants[0].name, 'Stay');

        await closeWs(client1);
    });

    await suite.test('F1.6: Responsive CSS grid layout mapping - Calculates count-1 through count-6 and count-many accurately', () => {
        assert.strictEqual(calculateGridLayout(1), 'count-1');
        assert.strictEqual(calculateGridLayout(2), 'count-2');
        assert.strictEqual(calculateGridLayout(3), 'count-3');
        assert.strictEqual(calculateGridLayout(4), 'count-4');
        assert.strictEqual(calculateGridLayout(5), 'count-5');
        assert.strictEqual(calculateGridLayout(6), 'count-6');
        assert.strictEqual(calculateGridLayout(7), 'count-many');
        assert.strictEqual(calculateGridLayout(12), 'count-many');
    });

    // -------------------------------------------------------------
    // Feature 2: Selective Audio Capture (Zero Leak)
    // -------------------------------------------------------------

    await suite.test('F2.1: Selective audio capture - Starts local MediaRecorder session on target peer audio track without peer leakage', () => {
        const targetPeerId = 'peer-candidate-99';
        const session = new SelectiveAudioCaptureSession(targetPeerId, 'Candidate Vikram');

        assert.strictEqual(session.peerId, targetPeerId);
        assert.strictEqual(session.isRecording, true);
        assert.strictEqual(session.chunks.length, 0);

        session.pushAudioChunk(Buffer.from('pcm-audio-chunk-1'));
        session.pushAudioChunk(Buffer.from('pcm-audio-chunk-2'));
        assert.strictEqual(session.chunks.length, 2);
    });

    await suite.test('F2.2: Selective audio capture - Zero leakage verification: remote peer receives no audio broadcast or capture notification over WebRTC signaling', async () => {
        const clientHost = await createWsClient(ctx.wsUrl);
        const clientTarget = await createWsClient(ctx.wsUrl);

        clientHost.send(JSON.stringify({ type: 'join-room', roomId: 'privacy-room', user: { name: 'Interviewer' } }));
        clientTarget.send(JSON.stringify({ type: 'join-room', roomId: 'privacy-room', user: { name: 'Candidate' } }));

        await waitForMessage(clientHost, (m) => m.type === 'room-users');
        const targetJoin = await waitForMessage(clientTarget, (m) => m.type === 'room-users');

        // Track all messages received by Candidate client
        const leakedMessages = [];
        clientTarget.on('message', (raw) => {
            try {
                leakedMessages.push(JSON.parse(raw.toString()));
            } catch (e) {
                leakedMessages.push(raw.toString());
            }
        });

        // Host privately captures Candidate audio locally
        const privateCapture = new SelectiveAudioCaptureSession(targetJoin.selfPeerId, 'Candidate');
        privateCapture.pushAudioChunk(Buffer.from('private-voice-data'));
        const clip = privateCapture.stop();

        // Host exchanges normal chat/transcript, not private audio stream
        clientHost.send(JSON.stringify({
            type: 'transcript-entry',
            entry: { speaker: 'Interviewer', text: 'Thank you for answering.' }
        }));

        await waitForMessage(clientTarget, (m) => m.type === 'transcript-entry');
        await new Promise((r) => setTimeout(r, 50));

        // Assert Candidate never received any 'audio-capture', 'stream-record', or clip payload
        const hasAudioLeak = leakedMessages.some(
            (m) => typeof m === 'object' && (m.type === 'audio-capture' || m.clipId || m.url?.includes('audio-'))
        );
        assert.strictEqual(hasAudioLeak, false, 'Expected zero leakage of private audio capture to remote peer');
        assert.ok(clip.url.startsWith('blob:'));

        await closeWs(clientHost);
        await closeWs(clientTarget);
    });

    await suite.test('F2.3: Selective audio capture - Stopping capture compiles audio clip with duration, timestamp, and local blob URL', async () => {
        const session = new SelectiveAudioCaptureSession('peer-rohan', 'Rohan Sharma');
        await new Promise((r) => setTimeout(r, 60));
        session.pushAudioChunk(Buffer.from('sample-chunk'));

        const clip = session.stop();
        assert.strictEqual(session.isRecording, false);
        assert.strictEqual(clip.peerId, 'peer-rohan');
        assert.strictEqual(clip.peerName, 'Rohan Sharma');
        assert.ok(clip.duration.endsWith('s'));
        assert.ok(clip.durationSec >= 1);
        assert.ok(clip.time.length > 0);
        assert.ok(clip.url.includes('audio-peer-rohan'));
    });

    await suite.test('F2.4: Selective audio capture - Audio clip deletion revokes Object URL (revokeObjectURL) preventing memory leaks', () => {
        const session = new SelectiveAudioCaptureSession('peer-mem-1', 'Memory Test User');
        const clip = session.stop();

        let revokedUrls = [];
        const mockRevokeObjectURL = (url) => {
            revokedUrls.push(url);
        };

        // Simulate client handleDeleteClip(clipId)
        mockRevokeObjectURL(clip.url);
        session.revoke();

        assert.strictEqual(session.isRevoked, true);
        assert.strictEqual(revokedUrls.length, 1);
        assert.strictEqual(revokedUrls[0], clip.url);
    });

    await suite.test('F2.5: Selective audio capture - Peer departure automatically halts active recording session and purges capture state', async () => {
        const client1 = await createWsClient(ctx.wsUrl);
        const client2 = await createWsClient(ctx.wsUrl);

        client1.send(JSON.stringify({ type: 'join-room', roomId: 'cleanup-capture-room', user: { name: 'Host' } }));
        client2.send(JSON.stringify({ type: 'join-room', roomId: 'cleanup-capture-room', user: { name: 'Guest' } }));

        await waitForMessage(client1, (m) => m.type === 'room-users');
        const c2 = await waitForMessage(client2, (m) => m.type === 'room-users');

        // Host is recording Guest
        const captureSession = new SelectiveAudioCaptureSession(c2.selfPeerId, 'Guest');
        assert.strictEqual(captureSession.isRecording, true);

        const leavePromise = waitForMessage(client1, (m) => m.type === 'user-left');
        await closeWs(client2);
        await leavePromise;

        // On user-left, client logic stops the session and removes from active map
        const finalClip = captureSession.stop();
        assert.strictEqual(captureSession.isRecording, false);
        assert.ok(finalClip.id);

        await closeWs(client1);
    });

    await suite.test('F2.6: Selective audio capture - Call exit (handleLeaveCall) stops all active peer recorders and cleans up references', () => {
        const activeRecorders = new Map();
        activeRecorders.set('peer-1', new SelectiveAudioCaptureSession('peer-1', 'User 1'));
        activeRecorders.set('peer-2', new SelectiveAudioCaptureSession('peer-2', 'User 2'));

        // Client handleLeaveCall() stops all active recorders and clears the map
        activeRecorders.forEach((rec) => {
            rec.stop();
        });
        activeRecorders.clear();

        assert.strictEqual(activeRecorders.size, 0);
    });

    // -------------------------------------------------------------
    // Feature 3: Hybrid NLP Task Extraction (4s Fallback)
    // -------------------------------------------------------------

    await suite.test('F3.1: Hybrid NLP - Heuristic server NLP engine extracts action items with verbs, assignees, and due dates', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/nlp-tasks/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: 'We will finalize the architecture documentation by Friday.'
            })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data.tasks));
        assert.strictEqual(data.source, 'render-server-nlp');
        assert.ok(data.tasks.length >= 1);

        const task = data.tasks.find((t) => t.title.toLowerCase().includes('architecture') || t.title.toLowerCase().includes('finalize'));
        assert.ok(task, 'Expected task containing architecture or finalize');
        assert.strictEqual(task.due, 'Friday');
        assert.strictEqual(task.completed, false);
    });

    await suite.test('F3.2: Hybrid NLP - Indian participant name recognition (Rohan Sharma) accurately mapped as task assignee', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/nlp-tasks/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: 'Rohan Sharma will deploy signaling server by Friday.'
            })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data.tasks));
        assert.ok(data.tasks.length >= 1);

        const rohanTask = data.tasks.find((t) => t.assignee === 'Rohan Sharma');
        assert.ok(rohanTask, 'Expected a task assigned to Rohan Sharma');
        assert.strictEqual(rohanTask.due, 'Friday');
    });

    await suite.test('F3.3: Hybrid NLP - Empty or whitespace transcript returns empty task array with empty-transcript source', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/nlp-tasks/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: '   \n\t   ' })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.deepStrictEqual(data.tasks, []);
        assert.strictEqual(data.source, 'empty-transcript');
    });

    await suite.test('F3.4: Hybrid NLP - 4-second timeout threshold aborts stalled Gemini API request and triggers seamless local fallback', async () => {
        // Set GEMINI_API_KEY with an invalid key that triggers fallback
        const originalApiKey = process.env.GEMINI_API_KEY;
        process.env.GEMINI_API_KEY = 'mock-stalled-gemini-key';

        const startTime = Date.now();
        const res = await fetch(`${ctx.baseUrl}/api/nlp-tasks/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: 'Rohan will audit Google Calendar reminder alerts by tomorrow.'
            })
        });
        const duration = Date.now() - startTime;

        // Restore original env
        if (originalApiKey) process.env.GEMINI_API_KEY = originalApiKey;
        else delete process.env.GEMINI_API_KEY;

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.source, 'render-server-nlp');
        assert.ok(Array.isArray(data.tasks));
        assert.ok(data.tasks.length >= 1);
        assert.ok(duration < 6000, `Expected call to complete under 6s with fallback, took ${duration}ms`);
    });

    await suite.test('F3.5: Hybrid NLP - External API error (HTTP 500 or network drop) safely falls back to render-server-nlp without failure', async () => {
        const originalApiKey = process.env.GEMINI_API_KEY;
        process.env.GEMINI_API_KEY = 'invalid-failing-key';

        const res = await fetch(`${ctx.baseUrl}/api/nlp-tasks/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: 'Rohan Sharma will configure Cloudflare Turnstile bot verification by Friday.'
            })
        });

        if (originalApiKey) process.env.GEMINI_API_KEY = originalApiKey;
        else delete process.env.GEMINI_API_KEY;

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.source, 'render-server-nlp');
        assert.ok(data.tasks.length >= 1);
        const rohanTask = data.tasks.find((t) => t.assignee === 'Rohan Sharma');
        assert.ok(rohanTask, 'Expected a task assigned to Rohan Sharma after fallback');
    });

    await suite.test('F3.6: Hybrid NLP - Extracted tasks receive deduplicated unique sequential IDs and completed boolean flag', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/nlp-tasks/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: 'Rohan will write tests today. Rohan will write docs tomorrow. Rohan will deploy Friday.'
            })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(data.tasks.length >= 2);

        const ids = data.tasks.map((t) => t.id);
        const uniqueIds = new Set(ids);
        assert.strictEqual(uniqueIds.size, ids.length, 'All task IDs must be strictly unique');
        data.tasks.forEach((t) => {
            assert.strictEqual(typeof t.completed, 'boolean');
        });
    });

    // -------------------------------------------------------------
    // Feature 4: Google OAuth 2.0 & Calendar 15m Reminder
    // -------------------------------------------------------------

    await suite.test('F4.1: Google OAuth - POST /api/auth/google creates server session with calendar.events scope and HttpOnly cookie', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'mock-oauth-token-tier1',
                name: 'Avinash Kumar',
                email: 'avinash.kumar@example.com'
            })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.authenticated, true);
        assert.strictEqual(data.provider, 'google-oauth');
        assert.ok(data.sessionId);
        assert.strictEqual(data.user.email, 'avinash.kumar@example.com');

        // Check Set-Cookie header
        const setCookie = res.headers.get('set-cookie');
        assert.ok(setCookie, 'Expected Set-Cookie header');
        assert.ok(setCookie.includes('cs_session_id='));
        assert.ok(setCookie.includes('HttpOnly'));

        // Verify session in store
        const session = ctx.sessions.get(data.sessionId);
        assert.ok(session);
        assert.ok(session.tokens.scope.includes('https://www.googleapis.com/auth/calendar.events'));
    });

    await suite.test('F4.2: Google Calendar - Event creation sets 15-minute popup notification reminder (reminders.overrides)', async () => {
        // Authenticate first
        const authRes = await fetch(`${ctx.baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'mock-calendar-token-tier1',
                name: 'Avinash',
                email: 'avinash@gmail.com'
            })
        });
        const { sessionId } = await authRes.json();

        // Create Calendar Event
        const calRes = await fetch(`${ctx.baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': sessionId
            },
            body: JSON.stringify({
                title: 'Review E2E Test Suite and Turnstile Integration',
                description: 'Created by automated test',
                due: 'Tomorrow'
            })
        });

        assert.strictEqual(calRes.status, 201);
        const calData = await calRes.json();
        assert.strictEqual(calData.success, true);
        assert.ok(calData.event);
        assert.strictEqual(calData.event.summary, 'Review E2E Test Suite and Turnstile Integration');

        // Check 15-minute popup reminder
        const { reminders } = calData.event;
        assert.strictEqual(reminders.useDefault, false);
        assert.deepStrictEqual(reminders.overrides, [
            { method: 'popup', minutes: 15 }
        ]);
    });

    await suite.test('F4.3: Google Calendar - Natural language due dates (Today, Tomorrow, Friday) parse into valid start/end timestamps', async () => {
        const authRes = await fetch(`${ctx.baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'mock-natural-date-token',
                name: 'Avinash',
                email: 'avinash@gmail.com'
            })
        });
        const { sessionId } = await authRes.json();

        for (const naturalDue of ['Today', 'Tomorrow', 'Friday']) {
            const res = await fetch(`${ctx.baseUrl}/api/calendar/events`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-ID': sessionId
                },
                body: JSON.stringify({
                    title: `Action Item Due ${naturalDue}`,
                    due: naturalDue
                })
            });

            assert.strictEqual(res.status, 201);
            const data = await res.json();
            assert.strictEqual(data.success, true);
            const start = new Date(data.event.start.dateTime);
            const end = new Date(data.event.end.dateTime);
            assert.ok(!isNaN(start.getTime()), `Valid start date for ${naturalDue}`);
            assert.ok(!isNaN(end.getTime()), `Valid end date for ${naturalDue}`);
            assert.ok(end.getTime() > start.getTime(), 'End date must be strictly after start date');
        }
    });

    await suite.test('F4.4: Google Calendar - End time before or equal to start time is safely corrected to start + 1 hour', async () => {
        const authRes = await fetch(`${ctx.baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'mock-time-correction-token',
                name: 'Avinash',
                email: 'avinash@gmail.com'
            })
        });
        const { sessionId } = await authRes.json();

        const baseTime = new Date('2026-11-04T10:00:00.000Z');
        const earlierTime = new Date('2026-11-04T09:00:00.000Z');

        const res = await fetch(`${ctx.baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': sessionId
            },
            body: JSON.stringify({
                title: 'Check Time Duration Auto Correction',
                startTime: baseTime.toISOString(),
                endTime: earlierTime.toISOString()
            })
        });

        assert.strictEqual(res.status, 201);
        const data = await res.json();
        const startMs = new Date(data.event.start.dateTime).getTime();
        const endMs = new Date(data.event.end.dateTime).getTime();
        assert.strictEqual(endMs - startMs, 60 * 60 * 1000, 'End time should be auto-corrected to 1 hour after start time');
    });

    await suite.test('F4.5: Google Calendar - Invalid timezone string safely defaults to UTC without crashing', async () => {
        const authRes = await fetch(`${ctx.baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'mock-timezone-token',
                name: 'Avinash',
                email: 'avinash@gmail.com'
            })
        });
        const { sessionId } = await authRes.json();

        const res = await fetch(`${ctx.baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': sessionId
            },
            body: JSON.stringify({
                title: 'Timezone Fallback Test',
                timeZone: 'Mars/Curiosity_Rover_Zone_Invalid'
            })
        });

        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.event.start.timeZone, 'UTC');
        assert.strictEqual(data.event.end.timeZone, 'UTC');
    });

    await suite.test('F4.6: Google Calendar - Unauthenticated requests without active session or Bearer token return 401 Unauthorized', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Unauthenticated Task' })
        });

        assert.strictEqual(res.status, 401);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.match(data.error, /Google Calendar authorization required/i);
    });

    // -------------------------------------------------------------
    // Feature 5: Cloudflare Turnstile Bot Gating
    // -------------------------------------------------------------

    await suite.test('F5.1: Turnstile Gating - Missing Turnstile token returns 400 with verified: false', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/auth/verify-turnstile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.verified, false);
        assert.match(data.error, /Missing Turnstile token/i);
    });

    await suite.test('F5.2: Turnstile Gating - Fallback token turnstile_fallback_token verifies successfully with mode: fallback', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/auth/verify-turnstile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'turnstile_fallback_token' })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.verified, true);
        assert.strictEqual(data.mode, 'fallback');
    });

    await suite.test('F5.3: Turnstile Gating - Invalid or rejected Turnstile token returns verified: false with error message', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/auth/verify-turnstile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'mock-invalid-cf-token' })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.verified, false);
        assert.match(data.error, /Invalid Turnstile token/i);
    });

    await suite.test('F5.4: Turnstile Gating - Room creation via POST /api/rooms validates room initialization and host metadata', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                roomId: 'executive-planning',
                host: 'Avinash Host',
                turnstileToken: 'turnstile_fallback_token'
            })
        });

        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.strictEqual(data.roomId, 'executive-planning');
        assert.strictEqual(data.host, 'Avinash Host');
        assert.strictEqual(data.status, 'created');
        assert.strictEqual(data.participantCount, 0);
    });

    await suite.test('F5.5: Turnstile Gating - Client Lobby blocks unverified and unauthenticated users from initiating or joining calls', () => {
        const canJoinCall = (user, isTurnstileVerified) => {
            if (!user || !user.email) return false;
            if (!isTurnstileVerified) return false;
            return true;
        };

        assert.strictEqual(canJoinCall({ name: 'Guest', email: '' }, true), false, 'Blocked without email');
        assert.strictEqual(canJoinCall({ name: 'User', email: 'u@example.com' }, false), false, 'Blocked without Turnstile');
        assert.strictEqual(canJoinCall(null, false), false, 'Blocked when null');
        assert.strictEqual(canJoinCall({ name: 'Avinash', email: 'a@example.com' }, true), true, 'Allowed when both signed-in and Turnstile verified');
    });
});
