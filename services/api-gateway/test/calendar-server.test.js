const test = require('node:test');
const assert = require('node:assert');
const { app, sessions } = require('../../../server');

test('CallSummarizer Unified Server - Google Auth Session & Calendar API', async (t) => {
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

    let testSessionId = null;

    await t.test('POST /api/auth/google securely stores OAuth token on server session', async () => {
        const res = await fetch(`${baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'mock-test-access-token-12345',
                name: 'Avinash Sharma',
                email: 'avinash.sharma@gmail.com'
            })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.authenticated, true);
        assert.strictEqual(data.provider, 'google-oauth');
        assert.ok(data.sessionId);
        assert.strictEqual(data.user.name, 'Avinash Sharma');
        assert.strictEqual(data.user.email, 'avinash.sharma@gmail.com');

        testSessionId = data.sessionId;

        // Verify session holds required tokens and Google Calendar scope
        const storedSession = sessions.get(testSessionId);
        assert.ok(storedSession);
        assert.strictEqual(storedSession.tokens.accessToken, 'mock-test-access-token-12345');
        assert.ok(storedSession.tokens.scope.includes('https://www.googleapis.com/auth/calendar.events'));
    });

    await t.test('GET /api/auth/session returns active session with calendar access', async () => {
        const res = await fetch(`${baseUrl}/api/auth/session`, {
            headers: { 'X-Session-ID': testSessionId }
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.authenticated, true);
        assert.strictEqual(data.hasCalendarAccess, true);
        assert.strictEqual(data.user.email, 'avinash.sharma@gmail.com');
    });

    await t.test('POST /api/calendar/events blocks unauthenticated requests without session', async () => {
        const res = await fetch(`${baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Review production deployment checklist'
            })
        });

        assert.strictEqual(res.status, 401);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.match(data.error, /Google Calendar authorization required/i);
    });

    await t.test('POST /api/calendar/events validates title is required', async () => {
        const res = await fetch(`${baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': testSessionId
            },
            body: JSON.stringify({ title: '' })
        });

        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.match(data.error, /title is required/i);
    });

    await t.test('POST /api/calendar/events creates event with 5-minute popup notification reminder', async () => {
        const res = await fetch(`${baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': testSessionId
            },
            body: JSON.stringify({
                title: 'Finalize quarterly deliverables and architecture documentation at 2 pm',
                description: 'Assigned to Rohan Sharma. Due: Tomorrow at 2 pm',
                due: 'Tomorrow at 2 pm'
            })
        });

        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.ok(data.event);
        // Verify 5-minute popup alarm reminder
        assert.ok(data.event.reminders);
        assert.strictEqual(data.event.reminders.useDefault, false);
        assert.deepStrictEqual(data.event.reminders.overrides, [
            { method: 'popup', minutes: 5 }
        ]);
        // Verify exact time parsed (14:00 local)
        const eventStartDate = new Date(data.event.start.dateTime);
        assert.strictEqual(eventStartDate.getHours(), 14);
        assert.strictEqual(eventStartDate.getMinutes(), 0);
    });

    await t.test('POST /api/calendar/events rejects event creation when requireTime is true and no time is specified', async () => {
        const res = await fetch(`${baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': testSessionId
            },
            body: JSON.stringify({
                title: 'Review team deliverables without time',
                due: 'Tomorrow',
                requireTime: true
            })
        });

        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.match(data.error, /no time specified/i);
    });

    await t.test('POST /api/calendar/events handles invalid date strings safely without crashing', async () => {
        const res = await fetch(`${baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': testSessionId
            },
            body: JSON.stringify({
                title: 'Review resilience against malformed date parameters',
                startTime: 'invalid-date-string-123',
                endTime: 'another-invalid-date',
                due: 'some text'
            })
        });

        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.ok(data.event);
        assert.ok(data.event.start.dateTime);
        assert.ok(data.event.end.dateTime);
        // Verify valid ISO date was created
        assert.doesNotThrow(() => new Date(data.event.start.dateTime).toISOString());
    });

    await t.test('POST /api/auth/google rejects invalid/unauthorized access token with 401', async () => {
        const res = await fetch(`${baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: 'unauthorized-token-revoked'
            })
        });

        assert.strictEqual(res.status, 401);
        const data = await res.json();
        assert.strictEqual(data.authenticated, false);
    });

    await t.test('POST /api/auth/google rejects invalid email format with 400', async () => {
        const res = await fetch(`${baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Bad Email',
                email: 'not-an-email'
            })
        });

        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.authenticated, false);
        assert.match(data.error, /invalid.*email/i);
    });

    await t.test('POST /api/auth/google preserves existing OAuth tokens and calendar access during user update', async () => {
        // Initial token set in testSessionId
        assert.ok(sessions.get(testSessionId)?.tokens?.accessToken);

        // Update profile with JWT while passing sessionId
        const fakePayload = Buffer.from(JSON.stringify({
            sub: 'google-sub-789',
            name: 'Avinash Updated',
            email: 'avinash.sharma@gmail.com'
        })).toString('base64url');
        const fakeJwt = 'header.' + fakePayload + '.signature';

        const updateRes = await fetch(`${baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': testSessionId
            },
            body: JSON.stringify({
                credential: fakeJwt,
                sessionId: testSessionId
            })
        });

        assert.strictEqual(updateRes.status, 200);
        const updateData = await updateRes.json();
        assert.strictEqual(updateData.sessionId, testSessionId);
        assert.strictEqual(updateData.user.name, 'Avinash Updated');

        // Check that session retained calendar accessToken
        const sessionCheckRes = await fetch(`${baseUrl}/api/auth/session`, {
            headers: { 'X-Session-ID': testSessionId }
        });
        const sessionData = await sessionCheckRes.json();
        assert.strictEqual(sessionData.hasCalendarAccess, true);
    });

    await t.test('POST /api/auth/logout deletes active session', async () => {
        const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
            method: 'POST',
            headers: { 'X-Session-ID': testSessionId }
        });

        assert.strictEqual(logoutRes.status, 200);
        const logoutData = await logoutRes.json();
        assert.strictEqual(logoutData.success, true);

        // Session should now be 401
        const checkRes = await fetch(`${baseUrl}/api/auth/session`, {
            headers: { 'X-Session-ID': testSessionId }
        });
        assert.strictEqual(checkRes.status, 401);
    });

    await t.test('POST /api/calendar/events safely corrects endTime when endTime is before or equal to startTime', async () => {
        const createSessionRes = await fetch(`${baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Time Tester',
                email: 'time.tester@gmail.com'
            })
        });
        const createSessionData = await createSessionRes.json();
        const sid = createSessionData.sessionId;

        const startTime = '2026-11-05T14:00:00.000Z';
        const invalidEndTime = '2026-11-05T13:00:00.000Z'; // Earlier than startTime

        const res = await fetch(`${baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': sid
            },
            body: JSON.stringify({
                title: 'Time range safety verification',
                startTime,
                endTime: invalidEndTime,
                timeZone: 'Asia/Kolkata'
            })
        });

        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.ok(data.event);
        assert.strictEqual(data.event.start.timeZone, 'Asia/Kolkata');
        const startMs = new Date(data.event.start.dateTime).getTime();
        const endMs = new Date(data.event.end.dateTime).getTime();
        assert.ok(endMs > startMs, 'endDateTime must be strictly greater than startDateTime');
    });

    await t.test('POST /api/calendar/events returns 401 on mock-fail token without throwing uncaught exceptions', async () => {
        const res = await fetch(`${baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Check mock-fail error path',
                accessToken: 'mock-fail'
            })
        });

        assert.strictEqual(res.status, 401);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.match(data.error, /Google Calendar API error/i);
    });

    await t.test('GET /api/auth/google/url returns authorization URL with calendar scope', async () => {
        const res = await fetch(`${baseUrl}/api/auth/google/url`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(data.url);
        assert.ok(data.url.includes('https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events') || data.url.includes('calendar.events'));
        assert.ok(data.url.includes('access_type=offline'));
    });

    await t.test('POST /api/auth/logout deletes session when sessionId is provided in request body', async () => {
        const regRes = await fetch(`${baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Body Logout User',
                email: 'body.logout@gmail.com'
            })
        });
        const regData = await regRes.json();
        const sid = regData.sessionId;

        const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sid })
        });
        assert.strictEqual(logoutRes.status, 200);

        const checkRes = await fetch(`${baseUrl}/api/auth/session`, {
            headers: { 'X-Session-ID': sid }
        });
        assert.strictEqual(checkRes.status, 401);
    });

    await t.test('POST /api/calendar/events parses natural due string "Friday" and "Today" cleanly', async () => {
        const authRes = await fetch(`${baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Date Tester',
                email: 'date.tester@gmail.com'
            })
        });
        const authData = await authRes.json();
        const sid = authData.sessionId;

        const fridayRes = await fetch(`${baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': sid
            },
            body: JSON.stringify({
                title: 'Review Friday sprint deliverables',
                due: 'Friday'
            })
        });
        assert.strictEqual(fridayRes.status, 201);
        const fridayData = await fridayRes.json();
        assert.strictEqual(fridayData.success, true);
        const fridayDate = new Date(fridayData.event.start.dateTime);
        assert.strictEqual(isNaN(fridayDate.getTime()), false);
        assert.strictEqual(fridayDate.getDay(), 5, 'Date must be Friday');

        const todayRes = await fetch(`${baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': sid
            },
            body: JSON.stringify({
                title: 'Emergency bugfix review',
                due: 'Today'
            })
        });
        assert.strictEqual(todayRes.status, 201);
        const todayData = await todayRes.json();
        assert.strictEqual(todayData.success, true);
        const todayDate = new Date(todayData.event.start.dateTime);
        assert.strictEqual(isNaN(todayDate.getTime()), false);
    });

    await t.test('POST /api/calendar/events falls back safely to UTC when invalid timezone is supplied', async () => {
        const authRes = await fetch(`${baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'TZ Tester',
                email: 'tz.tester@gmail.com'
            })
        });
        const authData = await authRes.json();
        const sid = authData.sessionId;

        const res = await fetch(`${baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': sid
            },
            body: JSON.stringify({
                title: 'Timezone safety check',
                timeZone: 'Invalid/Malformed_Zone_123'
            })
        });
        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.event.start.timeZone, 'UTC');
    });

    await t.test('POST /api/calendar/events handles mock-forbidden with 403 status', async () => {
        const res = await fetch(`${baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Check 403 forbidden path',
                accessToken: 'mock-forbidden'
            })
        });
        assert.strictEqual(res.status, 403);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.match(data.error, /insufficient permissions/i);
    });

    await t.test('POST /api/calendar/events supports direct Authorization Bearer token header', async () => {
        const res = await fetch(`${baseUrl}/api/calendar/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer mock-direct-bearer-token'
            },
            body: JSON.stringify({
                title: 'Direct bearer auth check'
            })
        });
        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.mode, 'simulated');
    });

    await t.test('POST /api/auth/google normalizes mixed-case emails to lowercase', async () => {
        const res = await fetch(`${baseUrl}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Mixed Case',
                email: 'Avinash.Sharma@GMAIL.COM'
            })
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.user.email, 'avinash.sharma@gmail.com');
    });

    await t.test('POST /api/transcribe-audio rejects missing audioData with 400', async () => {
        const res = await fetch(`${baseUrl}/api/transcribe-audio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.error, 'Missing audioData base64 string');
    });

    await t.test('POST /api/transcribe-audio transcribes speech snippet and attributes speaker', async () => {
        const res = await fetch(`${baseUrl}/api/transcribe-audio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audioData: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwE=',
                mimeType: 'audio/webm',
                speakerName: 'Rohan Sharma'
            })
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.speaker, 'Rohan Sharma');
        assert.strictEqual(typeof data.transcript, 'string');
    });

    await t.test('GET /api/rooms/:id returns session notes and actions while active', async () => {
        // Create a room
        const roomCode = `test-room-${Date.now()}`;
        const createRes = await fetch(`${baseUrl}/api/rooms`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                roomId: roomCode,
                host: 'Tester',
                turnstileToken: 'turnstile_fallback_token'
            })
        });
        assert.strictEqual(createRes.status, 201);

        // Fetch room
        const getRes = await fetch(`${baseUrl}/api/rooms/${roomCode}`);
        assert.strictEqual(getRes.status, 200);
        const data = await getRes.json();
        assert.strictEqual(data.roomId, roomCode);
        assert.ok(Array.isArray(data.transcript));
        assert.ok(Array.isArray(data.tasks));
    });
});
