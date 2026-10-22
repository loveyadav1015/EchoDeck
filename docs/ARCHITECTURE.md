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

## File Responsibilities

| File | Responsibility |
|---|---|
| `src/index.ts` | Express app: `/health`, `/mcp`, startup logging, graceful shutdown |
| `src/config.ts` | Reads and validates environment variables |
| `src/logger.ts` | Structured JSON logger; never logs card text |
| `src/mcp/server.ts` | Builds `McpServer`, registers 4 tools + UI resource |
| `src/mcp/transport.ts` | Streamable HTTP: creates fresh transport per POST |
| `src/mcp/ui-resource.ts` | Loads built UI HTML, serves as `ui://` resource |
| `src/domain/types.ts` | Type definitions: Card, Deck, Review, Session, Rating |
| `src/domain/srs.ts` | Pure Leitner-box scheduling (accepts `now`, `unitMs`) |
| `src/domain/streak.ts` | Pure, timezone-aware streak calculation |
| `src/domain/validation.ts` | Trim, limit, deduplicate card inputs |
| `src/domain/service.ts` | Business logic; called by tool handlers |
| `src/store/store.ts` | JSON persistence: atomic write, serialized queue |
| `src/store/seed.json` | Networking Basics starter deck (10 cards) |
| `ui/card.html` | UI entry point (built by Vite) |
| `ui/src/main.ts` | UI logic: renders tool results via ext-apps client |
| `ui/src/styles.css` | High-contrast styles for arm's-length reading |

## Division of Labor: Server vs. Alexa

| Concern | Who handles it |
|---|---|
| Speech recognition | Alexa |
| Understanding intent and choosing tools | Alexa |
| Converting spoken notes to `{front, back}` cards | Alexa |
| **Judging** whether a spoken answer matches the back | Alexa |
| Choosing a `rating` (`again`/`hard`/`good`/`easy`) | Alexa |
| Storing cards and decks | Server |
| Picking the next due card | Server |
| Applying the rating and scheduling | Server |
| Computing streak | Server |
| Rendering the visual card UI | Server (HTML) → Alexa (render) |

The server **never** judges answers. The `back` is included in `structuredContent`
(not in the spoken text) so Alexa's AI can compare it with the user's spoken answer
and choose the appropriate rating.
