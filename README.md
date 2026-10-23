# EchoDeck

**Voice-first flashcard coach with spaced repetition** — an Alexa+ MCP add-on server.

EchoDeck lets learners create study decks, get quizzed, and track progress entirely
by voice through Alexa+. It uses Leitner-box spaced repetition to schedule reviews
and provides a visual card UI for Echo Show devices.



## ES Module Choice

This project uses **ES modules** throughout:
- `"type": "module"` in `package.json`
- `"module": "Node16"` and `"moduleResolution": "Node16"` in `tsconfig.json`
- All imports use explicit `.js` extensions (TypeScript resolves these to `.ts` at
  compile time)
- The UI is bundled by Vite (ESM native)

---

## Prerequisites

- **Node.js 24** or newer (`node --version`)
- **npm** (comes with Node.js)

## Install

```bash
cd server

npm install @modelcontextprotocol/sdk @modelcontextprotocol/ext-apps express zod
npm install -D typescript tsx vitest vite vite-plugin-singlefile @types/node @types/express
```

After installing, verify:
```bash
node --version        # Must be >= 24.0.0
npm ls --depth=0      # All packages should be listed without ERR
```

Also check that the installed `zod` version satisfies the MCP SDK's peer dependencies:
```bash
cat node_modules/@modelcontextprotocol/sdk/package.json | grep -A5 peerDependencies
```
If `zod` is listed and the installed version does not match, install the required version.

## Run (Development)

```bash
cd server
npm run dev
```

This uses `tsx watch` for hot-reloading. The server starts at `http://localhost:3000`.

## Run (Production)

```bash
cd server
npm run build     # Builds both the UI and the server
npm start         # Runs the compiled dist/index.js
```

## Build the UI

The UI must be built before the server can serve it:

```bash
cd server
npm run build:ui
```

This creates `server/dist-ui/card.html` — a single self-contained HTML file.
If you skip this step, the server logs an error and serves a fallback page.

## Environment Variables

| Variable | Default | Meaning |
|---|---|---|
| `MODE` | `alexa` | Server mode: `alexa` (MCP only), `local` (offline open-source AI & UI), or `both` |
| `HOST` | `127.0.0.1` (local) / `0.0.0.0` (alexa/both) | Network bind host |
| `PORT` | `3000` | HTTP port |
| `DATA_FILE` | `./data/echodeck.json` | Path to the JSON data file |
| `TZ` | `UTC` | IANA timezone for streak calculation |
| `DEMO_MODE` | `false` | Set to `true` to make one SRS interval unit = 1 minute |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `MAX_CARDS_PER_CALL` | `50` | Max cards per call / generation chunk |
| `MAX_TEXT_LENGTH` | `500` | Max characters per card side |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama HTTP API endpoint |
| `OLLAMA_MODEL` | `llama3.2` | Open-weight model name (e.g. `llama3.2`, `qwen2.5-coder:3b`, `mistral`) |
| `STT_URL` | *(none)* | Optional local whisper.cpp server endpoint (`/inference`) |
| `TTS_URL` | *(none)* | Optional local Piper TTS HTTP server endpoint |

Copy `.env.example` and adjust as needed. The server reads `process.env` directly
(no dotenv dependency).

---

## Local Mode (Open-Source AI)

EchoDeck includes a **second, fully local mode** built for Hacktoberfest's *"Open-Source AI, Slow and Steady"* challenge. In this mode, EchoDeck runs completely offline with zero hosted or paid APIs, using open-weight models to power flashcard generation and answer grading while reusing the exact same deterministic Leitner scheduling engine.

### Prerequisites

1. **Ollama**:
   - Install: [ollama.com/download](https://ollama.com/download) (or `curl -fsSL https://ollama.com/install.sh | sh` on Linux)
   - Pull a small, laptop-friendly open model:
     ```bash
     ollama pull llama3.2          # 3B parameter model (recommended)
     # or:
     ollama pull qwen2.5-coder:3b
     ollama pull mistral
     ```
   - Ensure Ollama is running (`ollama serve` or system service at `http://127.0.0.1:11434`).

2. **(Optional) Local Speech-to-Text with whisper.cpp**:
   - Run whisper.cpp's server:
     ```bash
     ./server -m models/ggml-base.en.bin --port 8080
     ```
   - Set `STT_URL=http://127.0.0.1:8080`.
   - *Fallback:* If unset, EchoDeck uses browser Speech Recognition or typed input.

3. **(Optional) Local Text-to-Speech with Piper**:
   - Run Piper's HTTP server with an ONNX voice model:
     ```bash
     python3 -m piper.http_server --model en_US-lessac-medium.onnx --port 5000
     ```
   - Set `TTS_URL=http://127.0.0.1:5000`.
   - *Fallback:* If unset, EchoDeck uses the browser's built-in Web Speech synthesis (`window.speechSynthesis`).

### Running Local Mode

```bash
cd server
npm run build     # Builds single-file UI and compiles TypeScript

# Run in local mode
MODE=local npm start
```

Open **`http://127.0.0.1:3000/`** in your browser to access the local study dashboard:
- **New Deck from Notes**: Paste raw notes or book excerpts, and the local model extracts high-yield flashcard pairs into your deck.
- **Voice or Typed Study**: Cards are read aloud, you speak or type your answer, and the local model evaluates accuracy and assigns an SRS rating (`again`, `hard`, `good`, `easy`).
- **Answer-Leak Guarantee**: The card's back is never delivered over the network or displayed until your answer has been submitted and judged.
- **Graceful Self-Rate Fallback**: If the local model returns unparseable JSON (after 1 retry) or is offline, EchoDeck asks you to self-rate rather than crashing or guessing a wrong rating.

### Docker & Docker Compose Option

To run EchoDeck connected to a local Ollama instance on the host:

```yaml
# docker-compose.yml
services:
  echodeck:
    build: ./server
    ports:
      - "3000:3000"
    environment:
      - MODE=local
      - HOST=0.0.0.0
      - OLLAMA_URL=http://host.docker.internal:11434
      - OLLAMA_MODEL=llama3.2
      - DATA_FILE=/app/data/echodeck.json
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - ./data:/app/data
```

```bash
docker compose up
```

---

## Architecture: Dual-Mode Operation

EchoDeck operates in three distinct modes controlled by `MODE`:

| Feature | `MODE=alexa` (default) | `MODE=local` (open-source) | `MODE=both` |
|---|---|---|---|
| **Primary Interface** | Alexa+ Voice / Echo Show | Local Web UI (`/`) & REST | Both |
| **Card Generation** | Alexa's AI | Local Ollama LLM | Both |
| **Answer Judging** | Alexa's AI | Local Ollama LLM | Both |
| **Spoken Input** | Alexa STT | whisper.cpp / Web Speech | Both |
| **Spoken Output** | Alexa TTS | Piper / Web Speech | Both |
| **MCP Tool Server** | Mounted on `/mcp` | Mounted on `/mcp` + `generate_deck_from_notes` | Both |
| **Spaced Repetition** | Deterministic Leitner | Deterministic Leitner | Deterministic Leitner |
| **Data Persistence** | Atomic JSON file | Same Atomic JSON file | Same Atomic JSON file |

### Where AI Is and Is NOT Used

- **AI IS used for**:
  1. Extracting `{ front, back }` cards from unstructured notes.
  2. Judging a learner's answer against the card back and returning an objective rating (`again`, `hard`, `good`, `easy`).
- **AI is NEVER used for scheduling**:
  - Leitner box intervals (1, 3, 7, 14 days), due date math, review history, and streaks are computed strictly with deterministic algorithms in `domain/srs.ts` and `domain/streak.ts`.
  - An LLM hallucination cannot corrupt review intervals or streak counts.

## Smoke Tests

### Alexa+ MCP Smoke Test
```bash
chmod +x scripts/smoke-test.sh
./scripts/smoke-test.sh http://localhost:3000
```
Runs `curl` checks for `/health` and all four MCP tools.

### Local Open-Model Smoke Test
```bash
chmod +x scripts/local-smoke-test.sh
./scripts/local-smoke-test.sh 3456
```
Automatically detects if local Ollama is running at `http://127.0.0.1:11434`, tests card generation, verifies the answer-leak rule, tests answer judging against open-weight models, and cleanly skips if Ollama is absent.

## Run Tests

```bash
cd server
npm test
```

Tests cover:
- **srs.test.ts** — Leitner box scheduling for all rating/box combinations
- **streak.test.ts** — Timezone-aware streak with midnight boundary proofs
- **validation.test.ts** — Trimming, dedup, limits
- **store.test.ts** — Persistence, atomic writes, corrupt file recovery
- **service.test.ts** — All tool paths (empty deck, unknown deck, unknown card, etc.)
- **latency.test.ts** — p95 latency for each service function
- **local-llm.test.ts** — Mocked Ollama provider, card generation (valid, malformed, over-limit, empty, duplicate), answer judging (correct, wrong, malformed JSON, retry then fallback)
- **local-stt-tts.test.ts** — Mocked whisper.cpp STT and Piper TTS adapters with graceful fallbacks
- **local-api.test.ts** — REST API endpoints, mode selection, answer-leak prevention, and loopback privacy validation

Type-check without emitting:
```bash
npm run typecheck
```

## Docker

```bash
cd server
docker build -t echodeck .
docker run -p 3000:3000 -v ./data:/app/data echodeck
```

- The `DATA_FILE` env var defaults to `/app/data/echodeck.json` inside the container.
- Mount a volume at `/app/data` for persistent storage.
- The container runs as a non-root `echodeck` user.
- A `HEALTHCHECK` on `/health` is built in.

## Answer-Leak Design Decision

`next_card`'s **text content** (what Alexa reads aloud) intentionally does **not**
contain the card's back (answer). The back is included only in `structuredContent`,
which Alexa's AI uses to judge the learner's spoken answer. The tool description
explicitly tells Alexa:

> *Read ONLY the front aloud. Do not reveal the back until the learner has answered.*

This prevents Alexa from accidentally reading the answer before the learner has
tried to recall it.

## Shared-Demo-User Limitation

This server has **no authentication**. All requests share a single data file and
session. This means:

- Only one user can study at a time.
- If multiple people use the same server, they see each other's decks and progress.
- This is acceptable for a personal demo or single-household setup.

## RUN TEST

<img width="1913" height="315" alt="image" src="https://github.com/user-attachments/assets/0aeba744-5ee4-4039-b891-1293f0c83984" />

<img width="1281" height="796" alt="image" src="https://github.com/user-attachments/assets/d6ecf318-e47e-412f-a3a5-1330015e8148" />

<img width="1920" height="515" alt="image" src="https://github.com/user-attachments/assets/3014fd1a-cbef-466b-86a1-b71259070958" />

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Blank UI on Echo Show | UI was not built, or the `ui://` resource was not read before the tool call | Run `npm run build:ui` and restart the server |
| Tool calls take > 500 ms | Data file is very large or disk is slow | Check file size; consider resetting data |
| Tool metadata not updating after code change | Alexa caches tool descriptions | Redeploy the add-on; the MCP client may need to re-discover tools |
| "The deck name cannot be empty" | Alexa sent an empty or whitespace-only deck name | Ask the learner to repeat the deck name clearly |
| `STARTUP ERROR: Invalid TZ` | The `TZ` env var is not a valid IANA timezone | Use a valid name like `America/New_York` or `UTC` |
| Data file corruption | Process killed during a write (unlikely with atomic writes) | The server auto-recovers from seed data and backs up the corrupt file |
