# Architecture — EchoDeck

## Overview

EchoDeck is a voice-first flashcard coach that runs as an **MCP add-on server**
for Alexa+. Alexa acts as the MCP client: it handles speech recognition, language
understanding, and UI rendering. EchoDeck handles data storage, spaced repetition
scheduling, streak tracking, and returns structured results that Alexa reads aloud.

## Flow Diagram

```
┌────────────┐         ┌──────────────┐          ┌───────────────────────────┐
│   User     │  voice  │   Alexa+     │  HTTP     │    EchoDeck MCP Server    │
│  (speaks)  │────────▶│  (MCP client)│─────────▶ │                           │
│            │◀────────│              │◀───────── │  POST /mcp (Streamable)   │
│            │  speech │  Picks tool, │  JSON-RPC │                           │
│            │         │  judges      │           │  ┌───────────────────────┐ │
│            │         │  answers     │           │  │  mcp/server.ts        │ │
│            │         │              │           │  │  (tool handlers)      │ │
│            │         │              │           │  └───────┬───────────────┘ │
│            │         │              │           │          │ calls           │
│            │         │              │           │  ┌───────▼───────────────┐ │
│            │         │              │           │  │  domain/service.ts    │ │
│            │         │              │           │  │  (business logic)     │ │
│            │         │              │           │  └───────┬───────────────┘ │
│            │         │              │           │          │ uses            │
│            │         │              │           │  ┌───────▼───────────────┐ │
│            │         │              │           │  │  domain/srs.ts        │ │
│            │         │              │           │  │  domain/streak.ts     │ │
│            │         │              │           │  │  domain/validation.ts │ │
│            │         │              │           │  │  store/store.ts       │ │
│            │         │              │           │  └───────────────────────┘ │
│            │         │              │           │                           │
│  ┌─────────┴──┐      │              │           │  UI resource served at    │
│  │ Echo Show  │◀─────│  Renders UI  │◀──────────│  ui://echodeck/card.html  │
│  │ (display)  │      │  from        │  HTML     │                           │
│  └────────────┘      │  _meta.ui    │           └───────────────────────────┘
│                      └──────────────┘
└────────────┘
```

## SDK Isolation Rule

All `@modelcontextprotocol/sdk` and `@modelcontextprotocol/ext-apps` imports are
confined to **two locations only**:

| Location | Purpose |
|---|---|
| `server/src/mcp/` | MCP server, transport, UI resource |
| `server/ui/src/main.ts` | ext-apps client for the UI |

The rest of the codebase (`domain/`, `store/`, `config.ts`, `logger.ts`) is pure
TypeScript with zero SDK dependencies. This means:

- If an SDK API changes or a `TODO(VERIFY)` turns out to be wrong, the fix is in
  one of two files (`mcp/server.ts` or `mcp/transport.ts`).
- All business logic is unit-testable without mocking SDK classes.
- The domain layer can be reused with a different transport or client.

## Dual Architecture: Alexa+ Mode & Local Open-Model Mode

EchoDeck operates in two parallel, non-conflicting modes (or combined via `MODE=both`):

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              Dual Entry Points                                         │
├──────────────────────────────────────────┬─────────────────────────────────────────────┤
│  1. Alexa+ Mode (MODE=alexa)             │  2. Local Mode (MODE=local)                 │
│  - Cloud-powered Alexa+ MCP client       │  - 100% offline open-source AI              │
│  - Alexa handles STT, TTS, & evaluation  │  - Ollama (LLM) + whisper.cpp (STT) + Piper │
│  - Talks via Streamable HTTP POST /mcp   │  - Talks via REST /api/* & Web UI (/)       │
└──────────────────────────────────────────┴─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                           EchoDeck Core Service Layer                                  │
│   - Pure Leitner Box Scheduling (domain/srs.ts)                                        │
│   - Timezone-Aware Streaks (domain/streak.ts)                                          │
│   - Atomic JSON Persistence (store/store.ts)                                           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## SDK and Provider Isolation Rule

- All `@modelcontextprotocol/sdk` and `@modelcontextprotocol/ext-apps` imports are confined to:
  - `server/src/mcp/`
  - `server/ui/src/main.ts` (when connected inside MCP iframe)
- All Local Open-Source AI provider logic is confined to:
  - `server/src/local/` (`LlmProvider`, `SttProvider`, `TtsProvider`)
  - `server/src/routes/` (`local-api.ts`)
- Core business logic (`domain/`, `store/`) remains pure TypeScript with zero external AI or SDK dependencies.

## File Responsibilities

| File | Responsibility |
|---|---|
| `src/index.ts` | Express app: `/health`, `/mcp`, `/api/*`, static UI, mode switching |
| `src/config.ts` | Reads and validates environment variables (`MODE`, `HOST`, `OLLAMA_*`, etc.) |
| `src/logger.ts` | Structured JSON logger; never logs notes/answers above debug level |
| `src/mcp/server.ts` | Builds `McpServer`, registers tools + UI resource |
| `src/mcp/transport.ts` | Streamable HTTP transport |
| `src/mcp/ui-resource.ts` | Loads built UI HTML, serves as `ui://` resource |
| `src/local/types.ts` | Provider interfaces (`LlmProvider`, `SttProvider`, `TtsProvider`) & Zod schemas |
| `src/local/ollama-llm.ts` | Native fetch adapter for local Ollama HTTP API |
| `src/local/whisper-stt.ts` | Adapter for local whisper.cpp server |
| `src/local/piper-tts.ts` | Adapter for local Piper TTS server |
| `src/local/card-generator.ts` | Note chunker, generation prompt, domain validator integration |
| `src/local/answer-judge.ts` | Evaluates learner answers into SRS ratings with retry & self-rate fallback |
| `src/local/local-controller.ts` | Orchestrates local operations and bridges to `EchoDeckService` |
| `src/routes/local-api.ts` | REST endpoints for local UI: `/api/status`, `/api/generate-deck`, `/api/study/*` |
| `src/domain/types.ts` | Type definitions: Card, Deck, Review, Session, Rating |
| `src/domain/srs.ts` | Pure Leitner-box scheduling (accepts `now`, `unitMs`) |
| `src/domain/streak.ts` | Pure, timezone-aware streak calculation |
| `src/domain/validation.ts` | Trim, limit, deduplicate card inputs |
| `src/domain/service.ts` | Business logic; called by MCP tool handlers and local controller |
| `src/store/store.ts` | JSON persistence: atomic write, serialized queue |
| `src/store/seed.json` | Networking Basics starter deck (10 cards) |
| `ui/card.html` | Dual-mode UI entry point (built by Vite) |
| `ui/src/main.ts` | UI logic: ext-apps listener (Alexa) + local interactive dashboard |
| `ui/src/styles.css` | High-contrast styles for both Echo Show and desktop/mobile browsers |

## Division of Labor

| Concern | `MODE=alexa` | `MODE=local` |
|---|---|---|
| Speech recognition | Alexa | whisper.cpp / Web Speech API |
| Card generation | Alexa | Local Ollama LLM (`CardGenerator`) |
| Answer evaluation | Alexa | Local Ollama LLM (`AnswerJudge`) |
| Fallback on model error | Handled by Alexa dialog | Safe self-rating prompt (`again`\|`hard`\|`good`\|`easy`) |
| Speech synthesis | Alexa | Piper / Web Speech API |
| Scheduling (Leitner) | EchoDeck Server (`domain/srs.ts`) | EchoDeck Server (`domain/srs.ts`) |
| Streak calculation | EchoDeck Server (`domain/streak.ts`) | EchoDeck Server (`domain/streak.ts`) |
| Data persistence | EchoDeck Server (`store/store.ts`) | EchoDeck Server (`store/store.ts`) |

### Strict Answer-Leak Rule
In both modes, the question front is presented first and the expected answer (`back`) is **never revealed** until the learner has attempted recall and submitted their answer. In local mode, `/api/study/next` omits `back` at the network level, only revealing it upon `/api/study/judge` or self-grading.
