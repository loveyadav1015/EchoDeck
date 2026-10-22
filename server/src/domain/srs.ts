/**
 * Pure Leitner-box spaced repetition scheduling.
 * No SDK imports. All functions are pure (accept `now` and `unitMs`).
 */

import type { Card, Rating } from "./types.js";

/**
 * Interval in units for each box (0-indexed by box-1).
 * Box 1 = 0 units (due immediately), box 5 = 14 units.
 */
const INTERVALS: readonly number[] = [0, 1, 3, 7, 14];

/**
 * Returns the interval in units for a given box number (1..5).
 */
export function intervalForBox(box: number): number {
  const clamped = Math.max(1, Math.min(5, box));
  return INTERVALS[clamped - 1];
}

/**
 * Compute the new box after a rating is applied.
 * again → 1, hard → same, good → +1, easy → +2. Clamped to 1..5.
 */
export function computeNewBox(currentBox: number, rating: Rating): number {
  let newBox: number;
  switch (rating) {
    case "again":
      newBox = 1;
      break;
    case "hard":
      newBox = currentBox;
      break;
    case "good":
      newBox = currentBox + 1;
      break;
    case "easy":
      newBox = currentBox + 2;
      break;
  }
  return Math.max(1, Math.min(5, newBox));
}

/**
 * Apply a rating to a card and return a new card with updated box, due, and lastReviewed.
 * Pure function: takes `now` (epoch ms) and `unitMs` (ms per interval unit).
 */
export function applyRating(
  card: Card,
  rating: Rating,
  now: number,
  unitMs: number,
): Card {
  const newBox = computeNewBox(card.box, rating);
  const interval = intervalForBox(newBox);
  const due = now + interval * unitMs;

  return {
    ...card,
    box: newBox,
    due,
    lastReviewed: now,
  };
}

/**
 * Default unit in milliseconds: one day.
 */
export const DAY_MS = 86_400_000;

/**
 * Demo unit in milliseconds: one minute.
 */
export const MINUTE_MS = 60_000;
