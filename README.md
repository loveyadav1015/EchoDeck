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
| `PORT` | `3000` | HTTP port |
| `DATA_FILE` | `./data/echodeck.json` | Path to the JSON data file |
| `TZ` | `UTC` | IANA timezone for streak calculation |
| `DEMO_MODE` | `false` | Set to `true` to make one SRS interval unit = 1 minute |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `MAX_CARDS_PER_CALL` | `50` | Max cards per `create_deck` call |
| `MAX_TEXT_LENGTH` | `500` | Max characters per card side |

Copy `.env.example` and adjust as needed. The server reads `process.env` directly
(no dotenv dependency).

## Smoke Test

```bash
chmod +x scripts/smoke-test.sh
./scripts/smoke-test.sh http://localhost:3000
```

Runs `curl` checks for `/health` and all four MCP tools.

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

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Blank UI on Echo Show | UI was not built, or the `ui://` resource was not read before the tool call | Run `npm run build:ui` and restart the server |
| Tool calls take > 500 ms | Data file is very large or disk is slow | Check file size; consider resetting data |
| Tool metadata not updating after code change | Alexa caches tool descriptions | Redeploy the add-on; the MCP client may need to re-discover tools |
| "The deck name cannot be empty" | Alexa sent an empty or whitespace-only deck name | Ask the learner to repeat the deck name clearly |
| `STARTUP ERROR: Invalid TZ` | The `TZ` env var is not a valid IANA timezone | Use a valid name like `America/New_York` or `UTC` |
| Data file corruption | Process killed during a write (unlikely with atomic writes) | The server auto-recovers from seed data and backs up the corrupt file |
