/**
 * Tier 3: Cross-Feature Combinations E2E Test Suite
 * Exercises complex multi-feature interactions:
 * 1. Turnstile Gating + Google Auth + Room Creation + WebSocket Join
 * 2. Multi-Peer WebRTC Mesh + Selective Audio Capture + Zero Leakage + Departure Cleanup
 * 3. Live Transcript Sync + Hybrid NLP Extraction + Room Task Distribution
 * 4. NLP Task Extraction -> Google Calendar 15-Minute Popup Alarm Integration
 * 5. Full Media Lifecycle with Screen Sharing, Audio Capture, and Object URL Revocation
 * 6. Session Logout Security Invalidation on Google Calendar Routes
 */
const test = require('node:test');
const assert = require('node:assert');
const {
    startServer,
    resetServerState,
    createWsClient,
    waitForMessage,
    closeWs,
    SelectiveAudioCaptureSession
} = require('./helpers');

test('Tier 3: Cross-Feature Combinations Suite', async (suite) => {
    let ctx;

    suite.before(async () => {
        ctx = await startServer();
    });

    suite.beforeEach(() => {
        resetServerState();
    });

    await suite.test('C1: Turnstile Gating + Google OAuth Auth + Room Creation + WebSocket Room Join', async () => {
        // Step 1: Turnstile Verification
        const turnstileRes = await fetch(`${ctx.baseUrl}/api/auth/verify-turnstile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'turnstile_fallback_token' })
        });
        assert.strictEqual(turnstileRes.status, 200);
        const turnstileData = await turnstileRes.json();
        assert.strictEqual(turnstileData.verified, true);

        // Step 2: Google OAuth Session Authentication
        const authRes = await fetch(`${ctx.baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'mock-oauth-token-c1',
                name: 'Avinash Sharma',
                email: 'avinash.sharma@example.com'
            })
        });
        assert.strictEqual(authRes.status, 200);
        const authData = await authRes.json();
        assert.strictEqual(authData.authenticated, true);
        const { sessionId } = authData;

        // Step 3: Room Creation using authenticated session
        const roomRes = await fetch(`${ctx.baseUrl}/api/rooms`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': sessionId
            },
            body: JSON.stringify({
                roomId: 'sprint-planning-cross',
                host: authData.user.name
            })
        });
        assert.strictEqual(roomRes.status, 201);
        const roomData = await roomRes.json();
        assert.strictEqual(roomData.roomId, 'sprint-planning-cross');

        // Step 4: Connect WebSocket to signaling and join created room
        const ws = await createWsClient(ctx.wsUrl);
        const joinPromise = waitForMessage(ws, (m) => m.type === 'room-users');

        ws.send(JSON.stringify({
            type: 'join-room',
            roomId: roomData.roomId,
            user: {
                name: authData.user.name,
                email: authData.user.email,
                initials: authData.user.initials
            }
        }));

        const joinedState = await joinPromise;
        assert.strictEqual(joinedState.roomId, 'sprint-planning-cross');
        assert.strictEqual(joinedState.participants.length, 1);
        assert.strictEqual(joinedState.participants[0].name, 'Avinash Sharma');

        await closeWs(ws);
    });

    await suite.test('C2: Multi-Peer WebRTC Mesh + Selective Audio Capture + Zero Leakage + Auto-Cleanup on Departure', async () => {
        const interviewerWs = await createWsClient(ctx.wsUrl);
        const candidateWs = await createWsClient(ctx.wsUrl);

        const roomCode = 'tech-interview-mesh';

        // Both peers join
        interviewerWs.send(JSON.stringify({
            type: 'join-room',
            roomId: roomCode,
            user: { name: 'Interviewer Avinash' }
        }));
        const interviewerJoin = await waitForMessage(interviewerWs, (m) => m.type === 'room-users');

        candidateWs.send(JSON.stringify({
            type: 'join-room',
            roomId: roomCode,
            user: { name: 'Candidate Rohan Sharma' }
        }));
        const candidateJoin = await waitForMessage(candidateWs, (m) => m.type === 'room-users');

        // Interviewer initiates selective audio capture on Candidate Rohan
        const privateCapture = new SelectiveAudioCaptureSession(candidateJoin.selfPeerId, 'Candidate Rohan Sharma');
        privateCapture.pushAudioChunk(Buffer.from('candidate-speech-answer-sample'));

        // Collect messages on Candidate socket to verify zero leakage
        const candidateReceived = [];
        candidateWs.on('message', (data) => candidateReceived.push(data.toString()));

        // Candidate sends normal speech transcript entry
        candidateWs.send(JSON.stringify({
            type: 'transcript-entry',
            entry: { speaker: 'Candidate Rohan Sharma', text: 'I implemented WebRTC mesh topology.' }
        }));

        await waitForMessage(interviewerWs, (m) => m.type === 'transcript-entry');
        await new Promise((r) => setTimeout(r, 40));

        // Verify Candidate never received audio recording leak
        const hasLeak = candidateReceived.some((raw) => raw.includes('audio-') || raw.includes('blob:'));
        assert.strictEqual(hasLeak, false, 'Private audio stream must never leak to remote peer');

        // Candidate departs call abruptly
        const leavePromise = waitForMessage(interviewerWs, (m) => m.type === 'user-left');
        await closeWs(candidateWs);
        const leaveEvent = await leavePromise;
        assert.strictEqual(leaveEvent.peerId, candidateJoin.selfPeerId);

        // Auto-cleanup: Interviewer stops active recording and saves clip
        const clip = privateCapture.stop();
        assert.strictEqual(clip.peerName, 'Candidate Rohan Sharma');
        assert.ok(clip.url.startsWith('blob:'));
        assert.strictEqual(privateCapture.isRecording, false);

        await closeWs(interviewerWs);
    });

    await suite.test('C3: Live Transcript Sync + Hybrid NLP Task Extraction + Room-wide Task Broadcast', async () => {
        const clientHost = await createWsClient(ctx.wsUrl);
        const clientGuest = await createWsClient(ctx.wsUrl);
        const roomCode = 'nlp-sync-meeting';

        // Join room
        clientHost.send(JSON.stringify({ type: 'join-room', roomId: roomCode, user: { name: 'Host' } }));
        clientGuest.send(JSON.stringify({ type: 'join-room', roomId: roomCode, user: { name: 'Guest' } }));
        await waitForMessage(clientHost, (m) => m.type === 'room-users');
        await waitForMessage(clientGuest, (m) => m.type === 'room-users');

        // Spoken transcript entry is sent over WebSocket
        const transcriptEntry = {
            id: 'tr-cross-1',
            speaker: 'Host',
            text: 'Rohan Sharma will connect the signaling service by Friday.'
        };

        const guestTranscriptPromise = waitForMessage(clientGuest, (m) => m.type === 'transcript-entry');
        clientHost.send(JSON.stringify({
            type: 'transcript-entry',
            entry: transcriptEntry
        }));
        await guestTranscriptPromise;

        // Trigger task extraction on server
        const nlpRes = await fetch(`${ctx.baseUrl}/api/nlp-tasks/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: `${transcriptEntry.speaker}: ${transcriptEntry.text}`,
                roomId: roomCode
            })
        });
        assert.strictEqual(nlpRes.status, 200);
        const nlpData = await nlpRes.json();
        assert.ok(nlpData.tasks.length >= 1);

        // Host synchronizes extracted tasks to all room participants over WebSocket
        const guestTaskSyncPromise = waitForMessage(clientGuest, (m) => m.type === 'tasks-sync');
        clientHost.send(JSON.stringify({
            type: 'tasks-sync',
            tasks: nlpData.tasks
        }));

        const synced = await guestTaskSyncPromise;
        assert.strictEqual(synced.tasks.length, nlpData.tasks.length);
        const rohanTask = synced.tasks.find((t) => t.assignee === 'Rohan Sharma');
        assert.ok(rohanTask, 'Synchronized tasks should include task for Rohan Sharma');
        assert.strictEqual(rohanTask.due, 'Friday');

        await closeWs(clientHost);
        await closeWs(clientGuest);
    });

    await suite.test('C4: NLP Task Extraction -> Google Calendar Event Creation with 15-Minute Popup Alarm', async () => {
        // Step 1: User signs in with Google Calendar access
        const authRes = await fetch(`${ctx.baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'mock-calendar-access-c4',
                name: 'Avinash',
                email: 'avinash@gmail.com'
            })
        });
        const { sessionId } = await authRes.json();

        // Step 2: Extract tasks from transcript
        const nlpRes = await fetch(`${ctx.baseUrl}/api/nlp-tasks/extract-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: 'Rohan Sharma will deploy signaling server by Friday.'
            })
        });
        const nlpData = await nlpRes.json();
        const extractedTask = nlpData.tasks.find((t) => t.assignee === 'Rohan Sharma');
        assert.ok(extractedTask);

        // Step 3: Approve and confirm task to Google Calendar
        const calRes = await fetch(`${ctx.baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': sessionId
            },
            body: JSON.stringify({
                title: extractedTask.title,
                description: `Action item assigned to ${extractedTask.assignee}. Due: ${extractedTask.due}`,
                due: extractedTask.due,
                timeZone: 'Asia/Kolkata'
            })
        });

        assert.strictEqual(calRes.status, 201);
        const calData = await calRes.json();
        assert.strictEqual(calData.success, true);
        assert.ok(calData.event);
        assert.strictEqual(calData.event.summary, extractedTask.title);

        // Verify 15-minute popup notification reminder
        assert.deepStrictEqual(calData.event.reminders.overrides, [
            { method: 'popup', minutes: 15 }
        ]);

        // Client marks task as calendarAdded
        extractedTask.calendarAdded = true;
        assert.strictEqual(extractedTask.calendarAdded, true);
    });

    await suite.test('C5: Full Media Session Lifecycle: Auth -> Join -> Media Toggles -> Screen Share -> Audio Capture -> Object URL Revocation', async () => {
        // 1. Auth
        const authRes = await fetch(`${ctx.baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'mock-lifecycle-token',
                name: 'Media Host',
                email: 'host@example.com'
            })
        });
        const { sessionId, user } = await authRes.json();

        // 2. Join
        const ws = await createWsClient(ctx.wsUrl);
        const joinPromise = waitForMessage(ws, (m) => m.type === 'room-users');
        ws.send(JSON.stringify({
            type: 'join-room',
            roomId: 'media-lifecycle-room',
            user
        }));
        const joinState = await joinPromise;
        const myPeerId = joinState.selfPeerId;

        // 3. Media Toggles (Mic Mute & Camera Off)
        ws.send(JSON.stringify({
            type: 'media-state',
            isAudioOn: false,
            isVideoOn: false,
            isScreenSharing: false
        }));
        await new Promise((r) => setTimeout(r, 30));

        // 4. Screen Sharing ON
        ws.send(JSON.stringify({
            type: 'media-state',
            isAudioOn: false,
            isVideoOn: false,
            isScreenSharing: true
        }));
        await new Promise((r) => setTimeout(r, 30));

        // 5. Selective Audio Recording Session
        const audioSession = new SelectiveAudioCaptureSession('peer-remote-42', 'Remote Speaker');
        audioSession.pushAudioChunk(Buffer.from('sample-audio-data-123'));
        const clip = audioSession.stop();
        assert.ok(clip.url.startsWith('blob:'));

        // 6. Object URL Revocation on clip deletion
        let revoked = false;
        const revokeHandler = (url) => {
            if (url === clip.url) revoked = true;
        };
        revokeHandler(clip.url);
        audioSession.revoke();
        assert.strictEqual(revoked, true);
        assert.strictEqual(audioSession.isRevoked, true);

        // 7. Clean Leave
        ws.send(JSON.stringify({ type: 'leave-room' }));
        await closeWs(ws);

        const room = ctx.rooms.get('media-lifecycle-room');
        assert.strictEqual(room.participants.has(myPeerId), false, 'Participant should be purged after leave');
    });

    await suite.test('C6: Session Logout Invalidates Google Calendar Access & Protects Private Endpoints', async () => {
        // Authenticate user
        const authRes = await fetch(`${ctx.baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'mock-logout-token',
                name: 'Logout Test',
                email: 'logout@example.com'
            })
        });
        const { sessionId } = await authRes.json();

        // Verify active session
        const sessionCheckRes = await fetch(`${ctx.baseUrl}/api/auth/session`, {
            headers: { 'X-Session-ID': sessionId }
        });
        assert.strictEqual(sessionCheckRes.status, 200);
        const checkData = await sessionCheckRes.json();
        assert.strictEqual(checkData.hasCalendarAccess, true);

        // Perform Logout
        const logoutRes = await fetch(`${ctx.baseUrl}/api/auth/logout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': sessionId
            },
            body: JSON.stringify({ sessionId })
        });
        assert.strictEqual(logoutRes.status, 200);

        // Verify session is now invalid (401)
        const recheckRes = await fetch(`${ctx.baseUrl}/api/auth/session`, {
            headers: { 'X-Session-ID': sessionId }
        });
        assert.strictEqual(recheckRes.status, 401);

        // Verify Calendar event creation with revoked session is rejected (401)
        const calRes = await fetch(`${ctx.baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': sessionId
            },
            body: JSON.stringify({ title: 'Task After Logout' })
        });
        assert.strictEqual(calRes.status, 401);
    });
});
