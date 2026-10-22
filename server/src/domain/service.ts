/**
 * Business logic layer used by tool handlers.
 * No SDK imports — this module depends only on domain/ and store/.
 */

import { randomUUID } from "node:crypto";
import type {
  Card,
  Rating,
  CreateDeckResult,
  NextCardResult,
  GradeAnswerResult,
  ProgressResult,
} from "./types.js";
import { applyRating, DAY_MS, MINUTE_MS } from "./srs.js";
import { computeStreak } from "./streak.js";
import {
  validateCards,
  validateDeckName,
  type ValidationConfig,
} from "./validation.js";
import type { Store } from "../store/store.js";

export interface ServiceConfig {
  tz: string;
  demoMode: boolean;
  maxCardsPerCall: number;
  maxTextLength: number;
}

function getUnitMs(demoMode: boolean): number {
  return demoMode ? MINUTE_MS : DAY_MS;
}

/**
 * Format a next-review date/time as a friendly human string.
 */
function formatNextReview(dueMs: number, now: number, demoMode: boolean): string {
  const diffMs = dueMs - now;
  if (diffMs <= 0) return "now";

  if (demoMode) {
    const minutes = Math.round(diffMs / MINUTE_MS);
    if (minutes <= 1) return "in about 1 minute";
    return `in about ${minutes} minutes`;
  }

  const days = Math.round(diffMs / DAY_MS);
  if (days <= 0) return "later today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export class EchoDeckService {
  private readonly store: Store;
  private readonly config: ServiceConfig;

  constructor(store: Store, config: ServiceConfig) {
    this.store = store;
    this.config = config;
  }

  private getStreak(now: number): number {
    const timestamps = this.store.getReviewTimestamps();
    return computeStreak(timestamps, now, this.config.tz);
  }

  // ── create_deck ──────────────────────────────────────────

  createDeck(
    deckNameRaw: string,
    cardsInput: readonly { front: string; back: string }[],
    now: number,
  ): { result: CreateDeckResult | null; error: string | null; message: string } {
    const deckName = validateDeckName(deckNameRaw);
    if (!deckName) {
      return {
        result: null,
        error: "invalid_deck_name",
        message: "The deck name cannot be empty.",
      };
    }

    const validationConfig: ValidationConfig = {
      maxCardsPerCall: this.config.maxCardsPerCall,
      maxTextLength: this.config.maxTextLength,
    };

    const existingFronts = this.store.getExistingFronts(deckName);
    const validation = validateCards(cardsInput, existingFronts, validationConfig);

    if (validation.valid.length === 0) {
      const parts: string[] = [];
      if (validation.skippedEmpty > 0) {
        parts.push(`${validation.skippedEmpty} had empty text`);
      }
      if (validation.skippedDuplicate > 0) {
        parts.push(`${validation.skippedDuplicate} were duplicates`);
      }
      if (validation.skippedOverLimit > 0) {
        parts.push(`${validation.skippedOverLimit} exceeded the limit of ${this.config.maxCardsPerCall} cards per call`);
      }
      const reason = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      return {
        result: null,
        error: "no_valid_cards",
        message: `No valid cards to add${reason}. Check that each card has both a front and a back, and that no cards are duplicates.`,
      };
    }

    // Create or find the deck
    const existingDeck = this.store.getDeckByName(deckName);
    if (!existingDeck) {
      this.store.addDeck({ name: deckName, createdAt: now });
    }

    // Use the canonical deck name (preserving original case if deck already exists)
    const canonicalName = existingDeck ? existingDeck.name : deckName;

    const newCards: Card[] = validation.valid.map((v) => ({
      id: randomUUID(),
      deckName: canonicalName,
      front: v.front,
      back: v.back,
      box: 1,
      due: now,
      lastReviewed: null,
      createdAt: now,
    }));

    this.store.addCards(newCards);

    const totalInDeck = this.store.getTotalCards(canonicalName);

    return {
      result: {
        deckName: canonicalName,
        cardCount: newCards.length,
        totalInDeck,
      },
      error: null,
      message: `Added ${newCards.length} card${newCards.length === 1 ? "" : "s"} to "${canonicalName}". The deck now has ${totalInDeck} card${totalInDeck === 1 ? "" : "s"}.`,
    };
  }

  // ── next_card ────────────────────────────────────────────

  nextCard(deckNameRaw: string | undefined, now: number): NextCardResult {
    // Resolve deck name if provided
    if (deckNameRaw !== undefined && deckNameRaw !== "") {
      const trimmed = validateDeckName(deckNameRaw);
      if (!trimmed) {
        return {
          done: true,
          error: "invalid_deck_name",
          message: "The deck name cannot be empty.",
          streak: this.getStreak(now),
          dueCount: 0,
        };
      }
      const deck = this.store.getDeckByName(trimmed);
      if (!deck) {
        const available = this.store.getDeckNames();
        const listText =
          available.length > 0
            ? `Available decks: ${available.join(", ")}.`
            : "There are no decks yet.";
        return {
          done: true,
          error: "deck_not_found",
          message: `I could not find a deck named "${trimmed}". ${listText}`,
          streak: this.getStreak(now),
          dueCount: 0,
        };
      }
    }

    const dueCards = this.store.getDueCards(now, deckNameRaw?.trim());
    const streak = this.getStreak(now);

    if (dueCards.length === 0) {
      // Reset session
      this.store.updateSession({ currentCardId: null, position: 0, total: 0 });
      return {
        done: true,
        streak,
        dueCount: 0,
        message: "No cards are due. You are all caught up.",
      };
    }

    const session = this.store.getSession();

    // Start a new session if needed (position 0 or total 0 means no active session)
    let total = session.total;
    let position = session.position;

    if (total === 0) {
      // New session
      total = dueCards.length;
      position = 1;
    } else {
      position = position + 1;
    }

    const card = dueCards[0];

    this.store.updateSession({
      currentCardId: card.id,
      position,
      total,
    });

    return {
      done: false,
      cardId: card.id,
      deckName: card.deckName,
      front: card.front,
      back: card.back,
      position,
      total,
      dueCount: dueCards.length,
      streak,
    };
  }

  // ── grade_answer ─────────────────────────────────────────

  gradeAnswer(cardId: string, rating: Rating, now: number): GradeAnswerResult {
    const card = this.store.getCardById(cardId);
    if (!card) {
      return {
        error: "not_found",
        message: "I could not find that card.",
      };
    }

    const unitMs = getUnitMs(this.config.demoMode);
    const previousBox = card.box;
    const updated = applyRating(card, rating, now, unitMs);
    this.store.updateCard(updated);

    this.store.addReview({
      cardId: card.id,
      rating,
      timestamp: now,
      previousBox,
      newBox: updated.box,
    });

    const streak = this.getStreak(now);
    const dueCards = this.store.getDueCards(now);
    const nextReview = formatNextReview(updated.due, now, this.config.demoMode);

    return {
      cardId: card.id,
      rating,
      newBox: updated.box,
      nextReview,
      streak,
      cardsLeft: dueCards.length,
      front: card.front,
      back: card.back,
    };
  }

  // ── get_progress ─────────────────────────────────────────

  getProgress(deckNameRaw: string | undefined, now: number): ProgressResult {
    let deckName: string | undefined;
    if (deckNameRaw !== undefined && deckNameRaw.trim() !== "") {
      deckName = deckNameRaw.trim();
    }

    const streak = this.getStreak(now);
    const dueToday = this.store.getDueCards(now, deckName).length;
    const mastered = this.store.getMasteredCount(deckName);
    const totalCards = this.store.getTotalCards(deckName);

    return { streak, dueToday, mastered, totalCards };
  }
}
