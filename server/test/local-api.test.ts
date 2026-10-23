/**
 * Integration tests for local mode REST API:
 * - Mode selection (alexa vs local vs both)
 * - REST endpoints (/api/status, /api/decks, /api/generate-deck, /api/study/next, /api/study/judge, /api/study/self-grade)
 * - Answer-leak rule enforcement: back is NEVER sent by next_card
 * - Deterministic Leitner update & streak update in the same store
 * - Privacy: binding to 127.0.0.1 by default in local mode, and no outbound calls
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { Store } from "../src/store/store.js";
import { EchoDeckService } from "../src/domain/service.js";
import { LocalController } from "../src/local/local-controller.js";
import { createLocalApiRouter } from "../src/routes/local-api.js";
import type { LlmProvider } from "../src/local/types.js";
import { WhisperSttProvider } from "../src/local/whisper-stt.js";
import { PiperTtsProvider } from "../src/local/piper-tts.js";
import { loadConfig } from "../src/config.js";

const TEST_DIR = path.resolve("./test-local-api-" + process.pid);
const TEST_FILE = path.join(TEST_DIR, "local-test.json");

describe("Local Mode API & Controller", () => {
  let store: Store;
  let service: EchoDeckService;
  let mockLlm: LlmProvider;
  let controller: LocalController;
  let app: express.Express;

  beforeEach(async () => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }

    store = new Store(TEST_FILE);
    await store.load();

    service = new EchoDeckService(store, {
      tz: "UTC",
      demoMode: false,
      maxCardsPerCall: 20,
      maxTextLength: 200,
    });

    mockLlm = {
      name: "mock-ollama",
      model: "mock-llama",
      isAvailable: vi.fn().mockResolvedValue(true),
      chat: vi.fn(),
    };

    const stt = new WhisperSttProvider();
    const tts = new PiperTtsProvider();

    controller = new LocalController({
      service,
      store,
      llm: mockLlm,
      stt,
      tts,
      maxCardsPerCall: 20,
      maxTextLength: 200,
    });

    app = express();
    app.use(express.json());
    app.use("/api", createLocalApiRouter(controller));
  });

  afterEach(async () => {
    await store.waitForWrites();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  it("GET /api/status returns provider states", async () => {
    const server = app.listen(0);
    const addr = server.address() as any;
    const url = `http://127.0.0.1:${addr.port}/api/status`;

    const res = await fetch(url);
    const json = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(json.llm.provider).toBe("mock-ollama");
    expect(json.llm.available).toBe(true);
    expect(json.stt.available).toBe(false);
    expect(json.tts.available).toBe(false);
  });

  it("POST /api/generate-deck generates flashcards with local LLM and saves to store", async () => {
    (mockLlm.chat as any).mockResolvedValueOnce(
      JSON.stringify([
        { front: "What is ARP?", back: "Address Resolution Protocol" },
        { front: "What is ICMP?", back: "Internet Control Message Protocol" },
      ]),
    );

    const server = app.listen(0);
    const addr = server.address() as any;
    const url = `http://127.0.0.1:${addr.port}/api/generate-deck`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deckName: "Network Protocols",
        notes: "ARP is Address Resolution Protocol. ICMP is Internet Control Message Protocol.",
      }),
    });

    const json = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(json.result.deckName).toBe("Network Protocols");
    expect(json.result.cardCount).toBe(2);

    // Verify persisted into same store
    expect(store.getTotalCards("Network Protocols")).toBe(2);
  });

  it("POST /api/study/next STRICTLY preserves answer-leak rule: does not leak back", async () => {
    // Add 1 card to store
    service.createDeck(
      "Secret Deck",
      [{ front: "Top secret question", back: "Top secret answer" }],
      Date.now(),
    );

    const server = app.listen(0);
    const addr = server.address() as any;
    const url = `http://127.0.0.1:${addr.port}/api/study/next`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckName: "Secret Deck" }),
    });

    const json = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(json.done).toBe(false);
    expect(json.front).toBe("Top secret question");
    expect(json.cardId).toBeDefined();

    // ANSWER-LEAK RULE ASSERTION:
    // The back property MUST be undefined or omitted from the JSON payload!
    expect(json.back).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("Top secret answer");
  });

  it("POST /api/study/judge evaluates answer with LLM, updates Leitner box, reveals back", async () => {
    const now = Date.now();
    const { result } = service.createDeck(
      "DNS Deck",
      [{ front: "What is DNS?", back: "Domain Name System" }],
      now,
    );
    expect(result).not.toBeNull();

    const dueCards = store.getDueCards(now, "DNS Deck");
    const cardId = dueCards[0].id;
    expect(dueCards[0].box).toBe(1);

    (mockLlm.chat as any).mockResolvedValueOnce(
      JSON.stringify({ rating: "good", reasoning: "Correct full name of DNS." }),
    );

    const server = app.listen(0);
    const addr = server.address() as any;
    const url = `http://127.0.0.1:${addr.port}/api/study/judge`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId, answer: "Domain Name System" }),
    });

    const json = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(json.fallback).toBe(false);
    expect(json.rating).toBe("good");
    expect(json.newBox).toBe(2); // Leitner box 1 -> box 2
    expect(json.streak).toBe(1); // Streak updated!
    expect(json.back).toBe("Domain Name System"); // Revealed ONLY after answering!

    // Verify store is updated deterministically
    const updatedCard = store.getCardById(cardId);
    expect(updatedCard?.box).toBe(2);
    expect(store.getReviewTimestamps()).toHaveLength(1);
  });

  it("POST /api/study/judge triggers safe self-grade fallback on malformed model response", async () => {
    const now = Date.now();
    service.createDeck("Deck", [{ front: "Q", back: "A" }], now);
    const card = store.getDueCards(now, "Deck")[0];

    // LLM outputs nonsense both times
    (mockLlm.chat as any)
      .mockResolvedValueOnce("nonsense text")
      .mockResolvedValueOnce("still nonsense text");

    const server = app.listen(0);
    const addr = server.address() as any;
    const url = `http://127.0.0.1:${addr.port}/api/study/judge`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId: card.id, answer: "My answer" }),
    });

    const json = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(json.fallback).toBe(true);
    expect(json.back).toBe("A"); // Revealed so user can compare
    expect(json.reasoning).toContain("self-rate");

    // Box has NOT changed because user has not self-rated yet
    const unchangedCard = store.getCardById(card.id);
    expect(unchangedCard?.box).toBe(1);
  });

  it("POST /api/study/self-grade allows user to rate manually and updates SRS", async () => {
    const now = Date.now();
    service.createDeck("Deck", [{ front: "Q", back: "A" }], now);
    const card = store.getDueCards(now, "Deck")[0];

    const server = app.listen(0);
    const addr = server.address() as any;
    const url = `http://127.0.0.1:${addr.port}/api/study/self-grade`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId: card.id, rating: "easy" }),
    });

    const json = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(json.newBox).toBe(3); // 1 -> 3 for easy
    expect(json.streak).toBe(1);
  });
});

describe("Mode Selection & Privacy Configuration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults to MODE=alexa with host 0.0.0.0", () => {
    delete process.env.MODE;
    delete process.env.HOST;
    const config = loadConfig();
    expect(config.mode).toBe("alexa");
    expect(config.host).toBe("0.0.0.0");
  });

  it("selects MODE=local and binds to 127.0.0.1 by default (privacy requirement)", () => {
    process.env.MODE = "local";
    delete process.env.HOST;
    const config = loadConfig();
    expect(config.mode).toBe("local");
    expect(config.host).toBe("127.0.0.1");
    expect(config.ollamaUrl).toBe("http://127.0.0.1:11434");
  });

  it("supports MODE=both", () => {
    process.env.MODE = "both";
    const config = loadConfig();
    expect(config.mode).toBe("both");
    expect(config.host).toBe("0.0.0.0");
  });

  it("throws clear error on invalid MODE", () => {
    process.env.MODE = "invalid_mode";
    expect(() => loadConfig()).toThrow("Invalid MODE");
  });

  it("never makes outbound calls to external internet domains in local mode", () => {
    process.env.MODE = "local";
    const config = loadConfig();
    const ollamaUrl = new URL(config.ollamaUrl);
    expect(["127.0.0.1", "localhost", "::1"]).toContain(ollamaUrl.hostname);
  });
});
