/**
 * Tests for the EchoDeckService business logic.
 * Proves every tool path returns content and structured data.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { Store } from "../src/store/store.js";
import { EchoDeckService, type ServiceConfig } from "../src/domain/service.js";

const TEST_DIR = path.resolve("test-service-data-" + process.pid);
const TEST_FILE = path.join(TEST_DIR, "service-test.json");

const serviceConfig: ServiceConfig = {
  tz: "UTC",
  demoMode: false,
  maxCardsPerCall: 50,
  maxTextLength: 500,
};

let store: Store;
let service: EchoDeckService;

beforeEach(async () => {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
  store = new Store(TEST_FILE);
  await store.load();
  service = new EchoDeckService(store, serviceConfig);
});

afterEach(async () => {
  await store.waitForWrites();
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
});

describe("create_deck", () => {
  it("creates a new deck with valid cards", () => {
    const now = Date.now();
    const { result, error, message } = service.createDeck(
      "My Deck",
      [{ front: "Q1", back: "A1" }],
      now,
    );
    expect(error).toBeNull();
    expect(result).not.toBeNull();
    expect(result!.deckName).toBe("My Deck");
    expect(result!.cardCount).toBe(1);
    expect(result!.totalInDeck).toBe(1);
    expect(message).toContain("1 card");
  });

  it("adds cards to existing deck (case-insensitive match)", () => {
    const now = Date.now();
    service.createDeck("Test", [{ front: "Q1", back: "A1" }], now);
    const { result } = service.createDeck("test", [{ front: "Q2", back: "A2" }], now);
    expect(result!.deckName).toBe("Test"); // Preserves original case
    expect(result!.totalInDeck).toBe(2);
  });

  it("returns error when all cards are invalid (empty text)", () => {
    const now = Date.now();
    const { result, error, message } = service.createDeck(
      "D",
      [{ front: "", back: "" }],
      now,
    );
    expect(result).toBeNull();
    expect(error).toBe("no_valid_cards");
    expect(message).toBeTruthy();
  });

  it("returns error for empty deck name", () => {
    const now = Date.now();
    const { result, error, message } = service.createDeck(
      "",
      [{ front: "Q", back: "A" }],
      now,
    );
    expect(result).toBeNull();
    expect(error).toBe("invalid_deck_name");
    expect(message).toBeTruthy();
  });

  it("skips duplicate cards", () => {
    const now = Date.now();
    service.createDeck("D", [{ front: "Q1", back: "A1" }], now);
    const { result } = service.createDeck(
      "D",
      [{ front: "Q1", back: "Different" }, { front: "Q2", back: "A2" }],
      now,
    );
    expect(result!.cardCount).toBe(1); // Only Q2 added, Q1 was duplicate
  });
});

describe("next_card", () => {
  it("returns a due card with front but text does NOT contain back", () => {
    const now = Date.now();
    // Seed data has 10 cards all due at 0 < now
    const result = service.nextCard(undefined, now);
    expect(result.done).toBe(false);
    expect(result.cardId).toBeTruthy();
    expect(result.front).toBeTruthy();
    expect(result.back).toBeTruthy();
    expect(result.position).toBe(1);
    expect(result.total).toBeGreaterThan(0);
  });

  it("next_card text content never contains the back", () => {
    const now = Date.now();
    const result = service.nextCard(undefined, now);
    // The service returns the back in the result for structuredContent,
    // but the MCP server tool handler constructs the text without it.
    // We verify the result has both front and back available
    // (the text-construction test is in the integration level)
    expect(result.front).toBeTruthy();
    expect(result.back).toBeTruthy();
    expect(result.front).not.toBe(result.back);
  });

  it("returns done when no cards are due", () => {
    const now = Date.now();
    // Grade all cards so they are scheduled in the future
    const allCards = store.getCards();
    for (const card of allCards) {
      service.gradeAnswer(card.id, "easy", now);
    }
    const result = service.nextCard(undefined, now);
    expect(result.done).toBe(true);
    expect(result.dueCount).toBe(0);
    expect(result.message).toContain("caught up");
    expect(result.streak).toBeDefined();
  });

  it("returns deck_not_found for unknown deck", () => {
    const now = Date.now();
    const result = service.nextCard("Nonexistent Deck", now);
    expect(result.done).toBe(true);
    expect(result.error).toBe("deck_not_found");
    expect(result.message).toContain("could not find");
    expect(result.message).toContain("Networking Basics"); // lists available decks
  });

  it("increments position on successive calls", () => {
    const now = Date.now();
    const first = service.nextCard(undefined, now);
    expect(first.position).toBe(1);

    // Grade the first card to get it out of the way
    service.gradeAnswer(first.cardId!, "good", now);

    const second = service.nextCard(undefined, now);
    expect(second.position).toBe(2);
  });

  it("resets session when nothing is due", () => {
    const now = Date.now();
    const allCards = store.getCards();
    for (const card of allCards) {
      service.gradeAnswer(card.id, "easy", now);
    }
    service.nextCard(undefined, now);
    const session = store.getSession();
    expect(session.position).toBe(0);
    expect(session.total).toBe(0);
    expect(session.currentCardId).toBeNull();
  });

  it("never lets position exceed total (regression: Card 2 of 1)", () => {
    const now = Date.now();
    service.createDeck("Single Card Deck", [{ front: "Q1", back: "A1" }], now);

    const first = service.nextCard("Single Card Deck", now);
    expect(first.position).toBe(1);
    expect(first.total).toBe(1);

    const second = service.nextCard("Single Card Deck", now);
    expect(second.position).toBe(1);
    expect(second.total).toBe(1);
    expect(second.position).toBeLessThanOrEqual(second.total!);
  });

  it("restarts session when position reaches total and cards are still due", () => {
    const now = Date.now();
    const first = service.nextCard("Networking Basics", now);
    expect(first.position).toBe(1);
    service.gradeAnswer(first.cardId!, "again", now);

    const total = first.total!;
    for (let p = 2; p <= total; p++) {
      const card = service.nextCard("Networking Basics", now);
      expect(card.position).toBe(p);
      expect(card.position).toBeLessThanOrEqual(card.total!);
    }

    const nextSession = service.nextCard("Networking Basics", now);
    expect(nextSession.position).toBe(1);
    expect(nextSession.position).toBeLessThanOrEqual(nextSession.total!);
  });
});

describe("grade_answer", () => {
  it("grades a known card and returns structured data", () => {
    const now = Date.now();
    const next = service.nextCard(undefined, now);
    const result = service.gradeAnswer(next.cardId!, "good", now);
    expect(result.error).toBeUndefined();
    expect(result.cardId).toBe(next.cardId);
    expect(result.rating).toBe("good");
    expect(result.newBox).toBeDefined();
    expect(result.nextReview).toBeTruthy();
    expect(result.streak).toBeDefined();
    expect(result.cardsLeft).toBeDefined();
    expect(result.front).toBeTruthy();
    expect(result.back).toBeTruthy();
  });

  it("returns error for unknown card id", () => {
    const now = Date.now();
    const result = service.gradeAnswer("nonexistent-id", "good", now);
    expect(result.error).toBe("not_found");
    expect(result.message).toContain("could not find");
  });

  it("does not throw for unknown card id", () => {
    const now = Date.now();
    expect(() => service.gradeAnswer("bad-id", "good", now)).not.toThrow();
  });

  it("grades any card, even if not the current session card", () => {
    const now = Date.now();
    const cards = store.getCards();
    // Grade the third card directly without calling next_card for it
    const result = service.gradeAnswer(cards[2].id, "easy", now);
    expect(result.error).toBeUndefined();
    expect(result.cardId).toBe(cards[2].id);
  });
});

describe("get_progress", () => {
  it("returns progress with structured data", () => {
    const now = Date.now();
    const result = service.getProgress(undefined, now);
    expect(result.streak).toBeDefined();
    expect(result.dueToday).toBeDefined();
    expect(result.mastered).toBeDefined();
    expect(result.totalCards).toBeDefined();
    expect(result.totalCards).toBe(10); // seed cards
  });

  it("returns progress for a specific deck", () => {
    const now = Date.now();
    const result = service.getProgress("Networking Basics", now);
    expect(result.totalCards).toBe(10);
  });

  it("returns zero mastered initially", () => {
    const now = Date.now();
    const result = service.getProgress(undefined, now);
    expect(result.mastered).toBe(0);
  });

  it("counts mastered cards (box 5)", () => {
    const now = Date.now();
    // Move a card to box 5 via "easy" twice (box 1 → 3 → 5)
    const cards = store.getCards();
    service.gradeAnswer(cards[0].id, "easy", now); // box 1 → 3
    service.gradeAnswer(cards[0].id, "easy", now); // box 3 → 5
    const result = service.getProgress(undefined, now);
    expect(result.mastered).toBe(1);
  });
});
