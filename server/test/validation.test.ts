/**
 * Tests for input validation, trimming, deduplication.
 */

import { describe, it, expect } from "vitest";
import { validateCards, validateDeckName, deckNameMatch, type ValidationConfig } from "../src/domain/validation.js";

const config: ValidationConfig = {
  maxCardsPerCall: 50,
  maxTextLength: 500,
};

describe("validateDeckName", () => {
  it("trims whitespace", () => {
    expect(validateDeckName("  My Deck  ")).toBe("My Deck");
  });

  it("returns null for empty string", () => {
    expect(validateDeckName("")).toBeNull();
  });

  it("returns null for whitespace-only", () => {
    expect(validateDeckName("   ")).toBeNull();
  });

  it("returns the trimmed name for valid input", () => {
    expect(validateDeckName("Test")).toBe("Test");
  });
});

describe("deckNameMatch", () => {
  it("matches case-insensitively", () => {
    expect(deckNameMatch("hello", "HELLO")).toBe(true);
    expect(deckNameMatch("Hello", "hello")).toBe(true);
  });

  it("does not match different names", () => {
    expect(deckNameMatch("hello", "world")).toBe(false);
  });
});

describe("validateCards", () => {
  it("accepts valid cards", () => {
    const result = validateCards(
      [{ front: "Q1", back: "A1" }, { front: "Q2", back: "A2" }],
      new Set(),
      config,
    );
    expect(result.valid).toHaveLength(2);
    expect(result.skippedEmpty).toBe(0);
    expect(result.skippedDuplicate).toBe(0);
  });

  it("trims whitespace from front and back", () => {
    const result = validateCards(
      [{ front: "  Q1  ", back: "  A1  " }],
      new Set(),
      config,
    );
    expect(result.valid[0].front).toBe("Q1");
    expect(result.valid[0].back).toBe("A1");
  });

  it("skips cards with empty front after trimming", () => {
    const result = validateCards(
      [{ front: "   ", back: "A1" }],
      new Set(),
      config,
    );
    expect(result.valid).toHaveLength(0);
    expect(result.skippedEmpty).toBe(1);
  });

  it("skips cards with empty back after trimming", () => {
    const result = validateCards(
      [{ front: "Q1", back: "" }],
      new Set(),
      config,
    );
    expect(result.valid).toHaveLength(0);
    expect(result.skippedEmpty).toBe(1);
  });

  it("skips duplicate fronts that exist in the deck (case-insensitive)", () => {
    const existing = new Set(["existing question"]);
    const result = validateCards(
      [{ front: "Existing Question", back: "A" }],
      existing,
      config,
    );
    expect(result.valid).toHaveLength(0);
    expect(result.skippedDuplicate).toBe(1);
  });

  it("skips duplicate fronts within the same batch", () => {
    const result = validateCards(
      [
        { front: "Q1", back: "A1" },
        { front: "q1", back: "A2" },
      ],
      new Set(),
      config,
    );
    expect(result.valid).toHaveLength(1);
    expect(result.skippedDuplicate).toBe(1);
  });

  it("enforces maxCardsPerCall", () => {
    const smallConfig: ValidationConfig = { maxCardsPerCall: 2, maxTextLength: 500 };
    const cards = [
      { front: "Q1", back: "A1" },
      { front: "Q2", back: "A2" },
      { front: "Q3", back: "A3" },
    ];
    const result = validateCards(cards, new Set(), smallConfig);
    expect(result.valid).toHaveLength(2);
    expect(result.skippedOverLimit).toBeGreaterThan(0);
  });

  it("truncates long text and tracks truncation count", () => {
    const shortConfig: ValidationConfig = { maxCardsPerCall: 50, maxTextLength: 10 };
    const result = validateCards(
      [{ front: "A very long question text here", back: "Short" }],
      new Set(),
      shortConfig,
    );
    expect(result.valid[0].front).toBe("A very lon"); // 10 chars
    expect(result.truncated).toBe(1);
  });

  it("returns empty valid array when all cards are invalid", () => {
    const result = validateCards(
      [
        { front: "", back: "" },
        { front: "   ", back: "A" },
      ],
      new Set(),
      config,
    );
    expect(result.valid).toHaveLength(0);
    expect(result.skippedEmpty).toBe(2);
  });
});
