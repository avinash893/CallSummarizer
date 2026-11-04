# Project: CallSummarizer Full Verification, Remediation & Audit

## Architecture
- **Unified Server**: `server.js` (Express + WebSocket signaling + Google OAuth/Calendar API + Turnstile verification + NLP task extraction).
- **Microservices Stack**: `services/api-gateway`, `services/meeting-service`, `services/nlp-task-service`, `services/signaling-service`.
- **Client Frontend**: React 18 + Vite (`client/src/App.jsx`, `Lobby.jsx`, `VideoCanvas.jsx`, `NotesDrawer.jsx`, `ControlDock.jsx`, `TopBar.jsx`, `ArchitectureModal.jsx`, `TurnstileWidget.jsx`).
- **Styling**: Modern CSS (`client/src/index.css`) with responsive WebRTC grid (`.count-1` through `.count-many`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Multi-peer WebRTC Mesh | PeerConnection mesh with asymmetric SDP negotiation & ICE candidate buffering | M2 | Survey 1 |
| 2 | Responsive CSS Grid | Dynamic layout `.count-1` through `.count-many` with speaker highlight | M2 | Survey 1 |
| 3 | Screen Share Track Replacement | Sender video track replacement on active peer connections | M2 | Survey 1 |
| 4 | Selective Audio Capture | Local MediaRecorder extraction of per-peer audio with zero peer leakage | M2 | Survey 1 |
| 5 | Audio Clip Memory Management | Revocation of Object URLs (`URL.revokeObjectURL`) on clip deletion/call leave | M2 | Survey 1 |
| 6 | Cloudflare Turnstile Server Verification | Robust validation against Cloudflare siteverify endpoint; proper rejection | M1 | Survey 1, 3 |
| 7 | Server Endpoint Gating | Require session authentication and Turnstile validation on `POST /api/rooms` | M1 | Survey 1, 3 |
| 8 | Room Lookup 404 Behavior | Avoid unbounded in-memory creation on unknown room queries in `GET /api/rooms/:id` | M1 | Survey 3 |
| 9 | NLP Microservice Route Compatibility | Support both `/extract-tasks` and `/api/extract-tasks` for gateway proxying | M1 | Survey 2 |
| 10 | Security Headers & Cookie Hardening | Add nosniff, frame denial, referrer policy; enforce Secure cookie on HTTPS | M1 | Survey 3 |
| 11 | Hybrid NLP Task Extraction | Gemini 1.5 Flash extraction with 4-second timeout fallback to local NLP engine | M1, M4 | Survey 2 |
| 12 | Google OAuth 2.0 & Token Isolation | Request `calendar.events` scope; isolate tokens on server session store | M1 | Survey 2, 3 |
| 13 | Google Calendar Action Items & Reminders | Add to calendar with 15-minute popup notification reminder & error banner | M1 | Survey 2 |
| 14 | Accessible Focus Indicators | Global `:focus-visible` high-contrast outline on dark backgrounds | M3 | Survey 3 |
| 15 | Touch/Tap Target Compliance | Minimum 24x24px (recommended 48x48px) for mini buttons and modal close | M3 | Survey 1, 3 |
| 16 | Accessible Form Labels & Landmarks | Explicit `aria-label` on form inputs and `<main>` landmark | M3 | Survey 3 |
| 17 | Modal Dialog Accessibility | `role="dialog"`, `aria-modal="true"`, focus trap, and Escape key listener | M3 | Survey 3 |
| 18 | WAI-ARIA Tab Pattern | Proper `role="tab"`, `aria-selected`, `role="tabpanel"` in NotesDrawer | M3 | Survey 3 |
| 19 | CodeRabbit Clean Code Standards | Clean error handling; eliminate empty/swallowed catch blocks | M4 | Survey 3 |
| 20 | Backend Automated Test Expansion | Tests for Turnstile, room management, NLP fallback, and signaling | M4 | Survey 1, 2, 3 |
| 21 | Client Automated Test Expansion | Tests for a11y keyboard interactions, modal Escape, and zero-leak audio | M4 | Survey 1, 3 |
| 22 | Full E2E Test Suite (Tiers 1-4) & Tier 5 Hardening | Requirement-driven 4-tier E2E tests + white-box adversarial verification | M5 | Prompt |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Security Posture & Backend Gating | Turnstile verification, server endpoint gating, security headers, route alignment | none | IN_PROGRESS |
| M2 | WebRTC Screen Sharing & Media Lifecycle | Screen share track replacement, audio blob memory cleanup | none | IN_PROGRESS |
| M3 | Accessibility (a11y) Remediation | Focus rings, tap target sizing, ARIA labels, modal dialog focus & Escape | none | IN_PROGRESS |
| M4 | CodeRabbit Quality & Test Suite Expansion | Robust error handling, comprehensive tests for new and edge behaviors | M1, M2, M3 | PLANNED |
| M5 | E2E Test Suite Pass (100%) & Adversarial Hardening | 100% pass across all pre-existing (74) and new tests, plus Tier 5 coverage audit | M4 | PLANNED |

## Interface Contracts
### Server Auth & Security Endpoints
- `POST /api/auth/verify-turnstile`: Accepts `{ token }`. Returns `{ verified: true/false, mode: string, error?: string }`. Returns 400 for missing token; returns `{ verified: false }` for rejected tokens.
- `POST /api/rooms`: Requires active session (or Turnstile token). Returns 401/403 if unauthenticated. Returns `{ roomId, host, status: 'created', ... }` (201).
- `GET /api/rooms/:id`: Returns 200 with room details if room exists; returns 404 if room does not exist.
- `POST /api/nlp-tasks/extract-tasks`: Requires transcript. Returns `{ tasks: Array, source: 'gemini-1.5-flash' | 'render-server-nlp' | 'empty-transcript' }`.

### Client WebRTC & Media Contracts
- `toggleScreenShare`: When active, replaces video track in each active `RTCRtpSender` in `peerConnectionsRef`. Reverts to camera video track when screen sharing stops.
- `handleDeleteClip(clipId)`: Revokes Object URL via `URL.revokeObjectURL(clip.url)` before removing from state.
- `handleLeaveCall`: Iterates through all recorded clips and revokes their URLs if needed; stops all active `MediaRecorder` instances.

### Code Layout
- `server.js`: Unified backend server (Auth, Calendar, Rooms, NLP, Signaling).
- `services/api-gateway/`: Gateway service and test suites (`calendar-server.test.js`, `gateway.test.js`).
- `services/nlp-task-service/`: Microservice for heuristic NLP task extraction.
- `services/meeting-service/`: Microservice for room management.
- `services/signaling-service/`: Microservice for WebRTC signaling.
- `client/src/`: React frontend application.
- `client/src/components/`: Modular UI components (`Lobby.jsx`, `VideoCanvas.jsx`, `NotesDrawer.jsx`, `ControlDock.jsx`, `TopBar.jsx`, `ArchitectureModal.jsx`, `TurnstileWidget.jsx`).
- `client/src/index.css`: Application styles and CSS grid.
