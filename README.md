# CallSummarizer - Microservice Architecture

A real-time WebRTC video collaboration platform with automated NLP speech-to-text extraction, meeting summarization, and task formation.

## System Architecture

```
                                      +-------------------------+
                                      |   Client (Vite + React) |
                                      +------------+------------+
                                                   |
                                                   | HTTP / WS
                                                   v
                                      +-------------------------+
                                      |       API Gateway       |
                                      |       (Express.js)      |
                                      +---+--------+--------+---+
                                          |        |        |
                         +----------------+        |        +----------------+
                         |                         |                         |
                         v                         v                         v
            +------------------------+   +-------------------+   +-----------------------+
            |    Meeting Service     |   | Signaling Service |   |   NLP Task Service    |
            | (Node/Express+MongoDB) |   | (WebRTC / WS)     |   | (Text Mining & Tasks) |
            +------------------------+   +-------------------+   +-----------------------+
                         |
                         v
            +------------------------+
            |     MongoDB Database   |
            +------------------------+
```

## Repository Structure

- `client/`: Modern frontend powered by **React 18** and **Vite** with a calming, minimalist design.
- `services/api-gateway/`: Reverse proxy and unified routing layer for all client requests.
- `services/meeting-service/`: Manages meeting rooms, participant metadata, and notes persistence in MongoDB.
- `services/signaling-service/`: High-concurrency WebSocket server managing WebRTC SDP offer/answer handshakes and ICE candidates.
- `services/nlp-task-service/`: Speech transcript processing, context extraction, action item detection, and Google Calendar / task app integration.
- `docker-compose.yml`: Multi-container orchestration specification for local development and deployment.

## Getting Started (Frontend Showcase)

Navigate to the client directory:
```bash
cd client
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.
