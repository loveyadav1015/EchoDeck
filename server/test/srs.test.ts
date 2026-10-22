/**
 * Tests for the Leitner-box spaced repetition system.
 */

import { describe, it, expect } from "vitest";
import { intervalForBox, computeNewBox, applyRating, DAY_MS, MINUTE_MS } from "../src/domain/srs.js";
import type { Card, Rating } from "../src/domain/types.js";

function makeCard(overrides?: Partial<Card>): Card {
  return {
    id: "test-card-1",
    deckName: "Test Deck",
    front: "Q",
    back: "A",
    box: 1,
    due: 0,
    lastReviewed: null,
    createdAt: 0,
    ...overrides,
  };
}

describe("intervalForBox", () => {
  it("returns correct intervals for each box", () => {
    expect(intervalForBox(1)).toBe(0);
    expect(intervalForBox(2)).toBe(1);
    expect(intervalForBox(3)).toBe(3);
    expect(intervalForBox(4)).toBe(7);
    expect(intervalForBox(5)).toBe(14);
  });

  it("clamps out-of-range boxes", () => {
    expect(intervalForBox(0)).toBe(0);   // clamped to box 1
    expect(intervalForBox(6)).toBe(14);  // clamped to box 5
    expect(intervalForBox(-1)).toBe(0);  // clamped to box 1
  });
});

describe("computeNewBox", () => {
  it("again always resets to box 1", () => {
    expect(computeNewBox(3, "again")).toBe(1);
    expect(computeNewBox(5, "again")).toBe(1);
    expect(computeNewBox(1, "again")).toBe(1);
  });

  it("hard keeps the same box", () => {
    expect(computeNewBox(1, "hard")).toBe(1);
    expect(computeNewBox(3, "hard")).toBe(3);
    expect(computeNewBox(5, "hard")).toBe(5);
  });

  it("good adds 1", () => {
    expect(computeNewBox(1, "good")).toBe(2);
    expect(computeNewBox(4, "good")).toBe(5);
  });

  it("easy adds 2", () => {
    expect(computeNewBox(1, "easy")).toBe(3);
    expect(computeNewBox(3, "easy")).toBe(5);
  });

  it("clamps to 5 maximum", () => {
    expect(computeNewBox(5, "good")).toBe(5);
    expect(computeNewBox(5, "easy")).toBe(5);
    expect(computeNewBox(4, "easy")).toBe(5);
  });
});

describe("applyRating", () => {
  const now = 1_000_000_000;

  it("applies 'again' rating correctly", () => {
    const card = makeCard({ box: 3 });
    const result = applyRating(card, "again", now, DAY_MS);
    expect(result.box).toBe(1);
    expect(result.due).toBe(now + 0 * DAY_MS); // box 1 interval is 0
    expect(result.lastReviewed).toBe(now);
  });

  it("applies 'good' rating correctly", () => {
    const card = makeCard({ box: 2 });
    const result = applyRating(card, "good", now, DAY_MS);
    expect(result.box).toBe(3);
    expect(result.due).toBe(now + 3 * DAY_MS); // box 3 interval is 3
    expect(result.lastReviewed).toBe(now);
  });

  it("applies 'easy' rating correctly", () => {
    const card = makeCard({ box: 1 });
    const result = applyRating(card, "easy", now, DAY_MS);
    expect(result.box).toBe(3);
    expect(result.due).toBe(now + 3 * DAY_MS);
  });

  it("applies 'hard' rating correctly", () => {
    const card = makeCard({ box: 3 });
    const result = applyRating(card, "hard", now, DAY_MS);
    expect(result.box).toBe(3);
    expect(result.due).toBe(now + 3 * DAY_MS);
  });

  it("uses minute units in demo mode", () => {
    const card = makeCard({ box: 2 });
    const result = applyRating(card, "good", now, MINUTE_MS);
    expect(result.box).toBe(3);
    expect(result.due).toBe(now + 3 * MINUTE_MS);
  });

  it("does not mutate the original card", () => {
    const card = makeCard({ box: 2 });
    const result = applyRating(card, "good", now, DAY_MS);
    expect(card.box).toBe(2);
    expect(card.due).toBe(0);
    expect(result).not.toBe(card);
  });

  it("preserves all other card fields", () => {
    const card = makeCard({ id: "keep-me", front: "F", back: "B", deckName: "D" });
    const result = applyRating(card, "good", now, DAY_MS);
    expect(result.id).toBe("keep-me");
    expect(result.front).toBe("F");
    expect(result.back).toBe("B");
    expect(result.deckName).toBe("D");
  });

  it("handles all ratings from every box correctly", () => {
    const ratings: Rating[] = ["again", "hard", "good", "easy"];
    for (let box = 1; box <= 5; box++) {
      for (const rating of ratings) {
        const card = makeCard({ box });
        const result = applyRating(card, rating, now, DAY_MS);
        expect(result.box).toBeGreaterThanOrEqual(1);
        expect(result.box).toBeLessThanOrEqual(5);
        expect(result.due).toBeGreaterThanOrEqual(now);
        expect(result.lastReviewed).toBe(now);
      }
    }
  });
});
