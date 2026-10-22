/**
 * Tests for the JSON store: persistence, atomic writes, corrupt file recovery.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { Store } from "../src/store/store.js";

const TEST_DIR = path.resolve("test-data-" + process.pid);
const TEST_FILE = path.join(TEST_DIR, "test-store.json");

beforeEach(() => {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
});

afterEach(() => {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
});

describe("Store", () => {
  it("creates the data directory if missing", async () => {
    const store = new Store(TEST_FILE);
    await store.load();
    expect(fs.existsSync(TEST_DIR)).toBe(true);
  });

  it("loads seed data when no file exists", async () => {
    const store = new Store(TEST_FILE);
    await store.load();
    const decks = store.getDecks();
    expect(decks.length).toBeGreaterThanOrEqual(1);
    expect(decks[0].name).toBe("Networking Basics");
    const cards = store.getCards();
    expect(cards.length).toBe(10);
  });

  it("writes data to disk atomically", async () => {
    const store = new Store(TEST_FILE);
    await store.load();
    store.addDeck({ name: "New Deck", createdAt: Date.now() });
    await store.waitForWrites();

    // Read file directly
    const raw = fs.readFileSync(TEST_FILE, "utf-8");
    const data = JSON.parse(raw);
    expect(data.decks.some((d: { name: string }) => d.name === "New Deck")).toBe(true);
  });

  it("recovers from corrupt file with seed data", async () => {
    // Write a corrupt file
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.writeFileSync(TEST_FILE, "this is not json{{{");

    const store = new Store(TEST_FILE);
    await store.load();

    // Should have loaded seed data
    const decks = store.getDecks();
    expect(decks.length).toBeGreaterThanOrEqual(1);
    expect(decks[0].name).toBe("Networking Basics");

    // Should have created a backup
    const files = fs.readdirSync(TEST_DIR);
    const backups = files.filter((f) => f.includes(".bak."));
    expect(backups.length).toBe(1);
  });

  it("recovers from structurally invalid JSON", async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.writeFileSync(TEST_FILE, JSON.stringify({ notValid: true }));

    const store = new Store(TEST_FILE);
    await store.load();

    // Should have loaded seed data due to invalid structure
    const decks = store.getDecks();
    expect(decks.length).toBeGreaterThanOrEqual(1);
  });

  it("persists and retrieves cards", async () => {
    const store = new Store(TEST_FILE);
    await store.load();

    const card = {
      id: "test-1",
      deckName: "Test Deck",
      front: "Q",
      back: "A",
      box: 1,
      due: 0,
      lastReviewed: null,
      createdAt: Date.now(),
    };

    store.addDeck({ name: "Test Deck", createdAt: Date.now() });
    store.addCards([card]);
    await store.waitForWrites();

    const found = store.getCardById("test-1");
    expect(found).toBeDefined();
    expect(found!.front).toBe("Q");
  });

  it("updates a card in place", async () => {
    const store = new Store(TEST_FILE);
    await store.load();

    const card = {
      id: "upd-1",
      deckName: "Test",
      front: "Q",
      back: "A",
      box: 1,
      due: 0,
      lastReviewed: null,
      createdAt: Date.now(),
    };
    store.addDeck({ name: "Test", createdAt: Date.now() });
    store.addCards([card]);

    store.updateCard({ ...card, box: 3, due: 999 });
    await store.waitForWrites();

    const found = store.getCardById("upd-1");
    expect(found!.box).toBe(3);
    expect(found!.due).toBe(999);
  });

  it("getDueCards returns cards sorted by due date", async () => {
    const store = new Store(TEST_FILE);
    await store.load();

    const now = Date.now();
    store.addDeck({ name: "D", createdAt: now });
    store.addCards([
      { id: "c1", deckName: "D", front: "Q1", back: "A1", box: 1, due: now - 200, lastReviewed: null, createdAt: now },
      { id: "c2", deckName: "D", front: "Q2", back: "A2", box: 1, due: now - 100, lastReviewed: null, createdAt: now },
      { id: "c3", deckName: "D", front: "Q3", back: "A3", box: 1, due: now + 9999, lastReviewed: null, createdAt: now },
    ]);

    const due = store.getDueCards(now);
    // c3 is in the future, seed cards are due at 0 which is < now, so they appear too
    expect(due.find((c) => c.id === "c3")).toBeUndefined();
    // c1 should come before c2 (earlier due)
    const c1idx = due.findIndex((c) => c.id === "c1");
    const c2idx = due.findIndex((c) => c.id === "c2");
    expect(c1idx).toBeLessThan(c2idx);
  });

  it("getDueCards filters by deck name case-insensitively", async () => {
    const store = new Store(TEST_FILE);
    await store.load();

    const now = Date.now();
    store.addDeck({ name: "MyDeck", createdAt: now });
    store.addCards([
      { id: "md1", deckName: "MyDeck", front: "Q", back: "A", box: 1, due: now - 1, lastReviewed: null, createdAt: now },
    ]);

    const due = store.getDueCards(now, "mydeck");
    expect(due.some((c) => c.id === "md1")).toBe(true);
    // Should not include cards from other decks
    expect(due.every((c) => c.deckName.toLowerCase() === "mydeck")).toBe(true);
  });

  it("serializes concurrent writes", async () => {
    const store = new Store(TEST_FILE);
    await store.load();

    // Fire multiple writes in parallel
    for (let i = 0; i < 10; i++) {
      store.addDeck({ name: `Deck-${i}`, createdAt: Date.now() + i });
    }
    await store.waitForWrites();

    // File should be valid JSON
    const raw = fs.readFileSync(TEST_FILE, "utf-8");
    const data = JSON.parse(raw);
    expect(data.decks.length).toBeGreaterThanOrEqual(11); // 1 seed + 10 added
  });

  it("getExistingFronts returns lowercased fronts for a deck", async () => {
    const store = new Store(TEST_FILE);
    await store.load();

    const fronts = store.getExistingFronts("Networking Basics");
    expect(fronts.size).toBe(10);
    // All should be lowercase
    for (const f of fronts) {
      expect(f).toBe(f.toLowerCase());
    }
  });

  it("session persistence works", async () => {
    const store = new Store(TEST_FILE);
    await store.load();

    store.updateSession({ currentCardId: "abc", position: 3, total: 10 });
    await store.waitForWrites();

    const session = store.getSession();
    expect(session.currentCardId).toBe("abc");
    expect(session.position).toBe(3);
    expect(session.total).toBe(10);
  });
});
