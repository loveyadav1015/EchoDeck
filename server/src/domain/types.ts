/**
 * Core domain types for EchoDeck.
 * No SDK imports allowed in this file.
 */

export type Rating = "again" | "hard" | "good" | "easy";

export interface Card {
  readonly id: string;
  readonly deckName: string;
  readonly front: string;
  readonly back: string;
  readonly box: number;
  readonly due: number;
  readonly lastReviewed: number | null;
  readonly createdAt: number;
}

export interface Deck {
  readonly name: string;
  readonly createdAt: number;
}

export interface Review {
  readonly cardId: string;
  readonly rating: Rating;
  readonly timestamp: number;
  readonly previousBox: number;
  readonly newBox: number;
}

export interface Session {
  currentCardId: string | null;
  position: number;
  total: number;
}

export interface StoreData {
  decks: Deck[];
  cards: Card[];
  reviews: Review[];
  session: Session;
}

export interface CreateDeckResult {
  deckName: string;
  cardCount: number;
  totalInDeck: number;
}

export interface NextCardResult {
  done: boolean;
  cardId?: string;
  deckName?: string;
  front?: string;
  back?: string;
  position?: number;
  total?: number;
  dueCount?: number;
  streak?: number;
  message?: string;
  error?: string;
}

export interface GradeAnswerResult {
  cardId?: string;
  rating?: Rating;
  newBox?: number;
  nextReview?: string;
  streak?: number;
  cardsLeft?: number;
  front?: string;
  back?: string;
  error?: string;
  message?: string;
}

export interface ProgressResult {
  streak: number;
  dueToday: number;
  mastered: number;
  totalCards: number;
}
