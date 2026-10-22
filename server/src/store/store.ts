/**
 * JSON file persistence with atomic writes and serialized mutations.
 * No SDK imports.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "../logger.js";
import type { StoreData, Card, Deck, Review, Session } from "../domain/types.js";

// Use import with assert for JSON in ESM
import seedData from "./seed.json" with { type: "json" };

function defaultData(): StoreData {
  return structuredClone(seedData) as StoreData;
}

function isValidStoreData(data: unknown): data is StoreData {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    Array.isArray(d.decks) &&
    Array.isArray(d.cards) &&
    Array.isArray(d.reviews) &&
    typeof d.session === "object" &&
    d.session !== null
  );
}

export class Store {
  private data: StoreData;
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
    this.data = defaultData();
  }

  /**
   * Load data from disk. If the file is missing, use seed data.
   * If the file is corrupt, back it up and use seed data.
   */
  async load(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info("Created data directory", { dir });
    }

    if (!fs.existsSync(this.filePath)) {
      logger.info("No data file found, using seed data", { path: this.filePath });
      this.data = defaultData();
      await this.flush();
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (!isValidStoreData(parsed)) {
        throw new Error("Data file has invalid structure");
      }
      this.data = parsed;
      logger.info("Loaded data from file", { path: this.filePath, cards: this.data.cards.length });
    } catch (err) {
      const backupPath = `${this.filePath}.bak.${Date.now()}`;
      logger.warn("Corrupt data file, backing up and using seed data", {
        path: this.filePath,
        backup: backupPath,
        error: err instanceof Error ? err.message : String(err),
      });
      try {
        fs.copyFileSync(this.filePath, backupPath);
      } catch {
        logger.warn("Could not create backup of corrupt file");
      }
      this.data = defaultData();
      await this.flush();
    }
  }

  /**
   * Atomic write: write to temp file then rename.
   * Serialized via promise queue so concurrent calls do not corrupt.
   */
  private async flush(): Promise<void> {
    const dir = path.dirname(this.filePath);
    const tmpPath = path.join(dir, `.echodeck-tmp-${randomUUID()}.json`);
    const json = JSON.stringify(this.data, null, 2);

    try {
      fs.writeFileSync(tmpPath, json, "utf-8");
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      // Clean up temp file if rename fails
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // Best effort cleanup
      }
      throw err;
    }
  }

  /**
   * Enqueue a write operation so writes are serialized.
   */
  private enqueueWrite(): void {
    this.writeQueue = this.writeQueue
      .then(() => this.flush())
      .catch((err) => {
        logger.error("Failed to write data file", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  /**
   * Wait for all pending writes to complete (useful for tests).
   */
  async waitForWrites(): Promise<void> {
    await this.writeQueue;
  }

  // ── Read methods ──────────────────────────────────────────

  getDecks(): readonly Deck[] {
    return this.data.decks;
  }

  getDeckByName(name: string): Deck | undefined {
    const lower = name.toLowerCase();
    return this.data.decks.find((d) => d.name.toLowerCase() === lower);
  }

  getCards(): readonly Card[] {
    return this.data.cards;
  }

  getCardsByDeck(deckName: string): readonly Card[] {
    const lower = deckName.toLowerCase();
    return this.data.cards.filter((c) => c.deckName.toLowerCase() === lower);
  }

  getCardById(id: string): Card | undefined {
    return this.data.cards.find((c) => c.id === id);
  }

  getReviews(): readonly Review[] {
    return this.data.reviews;
  }

  getReviewTimestamps(): readonly number[] {
    return this.data.reviews.map((r) => r.timestamp);
  }

  getSession(): Session {
    return { ...this.data.session };
  }

  getDeckNames(): string[] {
    return this.data.decks.map((d) => d.name);
  }

  /**
   * Get the set of existing front texts (lowercased) for a deck.
   */
  getExistingFronts(deckName: string): Set<string> {
    const lower = deckName.toLowerCase();
    const fronts = new Set<string>();
    for (const card of this.data.cards) {
      if (card.deckName.toLowerCase() === lower) {
        fronts.add(card.front.toLowerCase());
      }
    }
    return fronts;
  }

  // ── Write methods ─────────────────────────────────────────

  addDeck(deck: Deck): void {
    this.data.decks.push(deck);
    this.enqueueWrite();
  }

  addCards(cards: Card[]): void {
    this.data.cards.push(...cards);
    this.enqueueWrite();
  }

  updateCard(updated: Card): void {
    const idx = this.data.cards.findIndex((c) => c.id === updated.id);
    if (idx !== -1) {
      this.data.cards[idx] = updated;
      this.enqueueWrite();
    }
  }

  addReview(review: Review): void {
    this.data.reviews.push(review);
    this.enqueueWrite();
  }

  updateSession(session: Session): void {
    this.data.session = { ...session };
    this.enqueueWrite();
  }

  /**
   * Get all due cards (due <= now), optionally filtered by deck.
   */
  getDueCards(now: number, deckName?: string): Card[] {
    let cards = this.data.cards.filter((c) => c.due <= now);
    if (deckName) {
      const lower = deckName.toLowerCase();
      cards = cards.filter((c) => c.deckName.toLowerCase() === lower);
    }
    // Sort by due date ascending (earliest first)
    cards.sort((a, b) => a.due - b.due);
    return cards;
  }

  /**
   * Count cards in box 5 (mastered), optionally by deck.
   */
  getMasteredCount(deckName?: string): number {
    let cards = this.data.cards;
    if (deckName) {
      const lower = deckName.toLowerCase();
      cards = cards.filter((c) => c.deckName.toLowerCase() === lower);
    }
    return cards.filter((c) => c.box === 5).length;
  }

  /**
   * Total card count, optionally by deck.
   */
  getTotalCards(deckName?: string): number {
    if (deckName) {
      const lower = deckName.toLowerCase();
      return this.data.cards.filter((c) => c.deckName.toLowerCase() === lower).length;
    }
    return this.data.cards.length;
  }

  /**
   * Replace all data (for testing).
   */
  replaceData(data: StoreData): void {
    this.data = structuredClone(data);
    this.enqueueWrite();
  }

  /**
   * Get a snapshot of all data (for testing).
   */
  snapshot(): StoreData {
    return structuredClone(this.data);
  }
}
