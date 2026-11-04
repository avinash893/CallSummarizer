# E2E Test Infra: CallSummarizer

## Test Philosophy
- Opaque-box, requirement-driven derived from `ORIGINAL_REQUEST.md`.
- Methodology: Category-Partition + BVA + Pairwise + Real-World Workload Testing across Tiers 1-4.
- High test resilience: Offline-safe mocks for third-party APIs (Google Calendar, Gemini, Cloudflare Turnstile).

## Feature Inventory & Target Coverage
| # | Feature | Source | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Cross-feature) |
|---|---------|--------|:-----------------:|:-----------------:|:----------------------:|
| 1 | WebRTC Multi-peer Mesh & CSS Grid | R1 | 5 | 5 | ✓ |
| 2 | Selective Audio Capture (Zero Leak) | R1 | 5 | 5 | ✓ |
| 3 | Hybrid NLP Extraction (4s Fallback) | R1 | 5 | 5 | ✓ |
| 4 | Google OAuth 2.0 & Calendar Integration | R1, R2 | 5 | 5 | ✓ |
| 5 | Cloudflare Turnstile Bot Gating | R1, R2 | 5 | 5 | ✓ |

## Test Architecture
- Test Runner: Node test runner / Vitest runner integrated in root `npm test` or `npm run test:e2e`.
- Directory Layout: `tests/e2e/` (Tier 1: `feature_coverage.test.js`, Tier 2: `boundary_corner.test.js`, Tier 3: `cross_feature.test.js`, Tier 4: `scenarios.test.js`).
- Pass/Fail semantics: Exit code 0, all assertions pass.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Multi-participant meeting with Turnstile, join, chat, task extraction | F1, F3, F5 | High |
| 2 | Meeting with action items confirmed to Google Calendar with 15m reminder | F3, F4 | High |
| 3 | Selective private recording of single speaker with offline export | F1, F2 | Medium |
| 4 | Slow NLP API response triggers seamless 4s timeout fallback | F3 | Medium |
| 5 | Unauthenticated or invalid Turnstile token blocked from joining/creating | F4, F5 | Medium |

## Coverage Thresholds
- Tier 1: ≥25 test cases (5 per feature)
- Tier 2: ≥25 test cases (5 per feature)
- Tier 3: ≥5 cross-feature interaction cases
- Tier 4: ≥5 realistic end-to-end workload cases
- Total: ≥60 E2E test cases
