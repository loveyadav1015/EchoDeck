/**
 * Tests for timezone-aware streak calculation.
 * Proves the date changes at local midnight, not UTC midnight.
 */

import { describe, it, expect } from "vitest";
import { computeStreak, toLocalDateString, todayInTz } from "../src/domain/streak.js";

describe("toLocalDateString", () => {
  it("formats a date in UTC", () => {
    // 2024-01-15 12:00:00 UTC
    const ts = Date.parse("2024-01-15T12:00:00Z");
    expect(toLocalDateString(ts, "UTC")).toBe("2024-01-15");
  });

  it("formats a date in a positive-offset timezone", () => {
    // 2024-01-15 23:30:00 UTC → 2024-01-16 05:00:00 IST (UTC+5:30)
    const ts = Date.parse("2024-01-15T23:30:00Z");
    expect(toLocalDateString(ts, "Asia/Kolkata")).toBe("2024-01-16");
  });

  it("formats a date in a negative-offset timezone", () => {
    // 2024-01-16 03:00:00 UTC → 2024-01-15 22:00:00 EST (UTC-5)
    const ts = Date.parse("2024-01-16T03:00:00Z");
    expect(toLocalDateString(ts, "America/New_York")).toBe("2024-01-15");
  });
});

describe("computeStreak", () => {
  const tz = "UTC";

  it("returns 0 for empty review history", () => {
    expect(computeStreak([], Date.now(), tz)).toBe(0);
  });

  it("returns 1 when only today has a review", () => {
    const now = Date.parse("2024-06-10T15:00:00Z");
    expect(computeStreak([now], now, tz)).toBe(1);
  });

  it("returns 1 when only yesterday has a review (streak still alive)", () => {
    const yesterday = Date.parse("2024-06-09T15:00:00Z");
    const now = Date.parse("2024-06-10T15:00:00Z");
    expect(computeStreak([yesterday], now, tz)).toBe(1);
  });

  it("counts consecutive days back from today", () => {
    const day1 = Date.parse("2024-06-08T10:00:00Z");
    const day2 = Date.parse("2024-06-09T14:00:00Z");
    const day3 = Date.parse("2024-06-10T09:00:00Z");
    const now = Date.parse("2024-06-10T20:00:00Z");
    expect(computeStreak([day1, day2, day3], now, tz)).toBe(3);
  });

  it("counts consecutive days back from yesterday when no review today", () => {
    const day1 = Date.parse("2024-06-08T10:00:00Z");
    const day2 = Date.parse("2024-06-09T14:00:00Z");
    const now = Date.parse("2024-06-10T09:00:00Z");
    // No review on June 10, but June 8-9 are consecutive
    expect(computeStreak([day1, day2], now, tz)).toBe(2);
  });

  it("returns 0 when last review was 2+ days ago", () => {
    const oldReview = Date.parse("2024-06-07T10:00:00Z");
    const now = Date.parse("2024-06-10T10:00:00Z");
    expect(computeStreak([oldReview], now, tz)).toBe(0);
  });

  it("handles gap in the middle", () => {
    // Reviews on June 6, 7, then gap on 8, then 9 and 10
    const reviews = [
      Date.parse("2024-06-06T10:00:00Z"),
      Date.parse("2024-06-07T10:00:00Z"),
      // gap on June 8
      Date.parse("2024-06-09T10:00:00Z"),
      Date.parse("2024-06-10T10:00:00Z"),
    ];
    const now = Date.parse("2024-06-10T20:00:00Z");
    // Streak should be 2 (June 9, 10) not 4
    expect(computeStreak(reviews, now, tz)).toBe(2);
  });

  it("multiple reviews on the same day count as one", () => {
    const morning = Date.parse("2024-06-10T08:00:00Z");
    const noon = Date.parse("2024-06-10T12:00:00Z");
    const evening = Date.parse("2024-06-10T20:00:00Z");
    const now = Date.parse("2024-06-10T23:00:00Z");
    expect(computeStreak([morning, noon, evening], now, tz)).toBe(1);
  });

  // ── Midnight boundary test (proves timezone awareness) ──

  it("uses local midnight, not UTC midnight", () => {
    // Timezone: America/New_York (UTC-5 in January, no DST)
    const nyTz = "America/New_York";

    // Review at 2024-01-10 23:30 NY time = 2024-01-11 04:30 UTC
    // This is still Jan 10 in NY
    const review1 = Date.parse("2024-01-11T04:30:00Z");

    // "Now" is 2024-01-11 00:30 NY time = 2024-01-11 05:30 UTC
    // This is Jan 11 in NY
    const now = Date.parse("2024-01-11T05:30:00Z");

    // In UTC, both are Jan 11 → same day → streak 1
    // In NY, review is Jan 10 and now is Jan 11 → yesterday → streak 1
    // Either way streak is 1, but the date strings differ:
    expect(toLocalDateString(review1, nyTz)).toBe("2024-01-10");
    expect(todayInTz(now, nyTz)).toBe("2024-01-11");
    // review is yesterday in NY → streak alive
    expect(computeStreak([review1], now, nyTz)).toBe(1);

    // In UTC both are Jan 11 → same day
    expect(toLocalDateString(review1, "UTC")).toBe("2024-01-11");
    expect(todayInTz(now, "UTC")).toBe("2024-01-11");
    // In UTC, review is today → streak 1
    expect(computeStreak([review1], now, "UTC")).toBe(1);
  });

  it("proves date changes at local midnight, not UTC midnight", () => {
    // Timezone: Asia/Tokyo (UTC+9)
    const tokyoTz = "Asia/Tokyo";

    // Time: 2024-03-15 00:30 Tokyo time = 2024-03-14 15:30 UTC
    // In Tokyo this is March 15; in UTC this is March 14
    const justPastTokyoMidnight = Date.parse("2024-03-14T15:30:00Z");

    // Review at 2024-03-14 23:30 Tokyo time = 2024-03-14 14:30 UTC
    // In Tokyo this is March 14
    const justBeforeTokyoMidnight = Date.parse("2024-03-14T14:30:00Z");

    // In Tokyo: review is yesterday (Mar 14), now is today (Mar 15)
    expect(toLocalDateString(justBeforeTokyoMidnight, tokyoTz)).toBe("2024-03-14");
    expect(toLocalDateString(justPastTokyoMidnight, tokyoTz)).toBe("2024-03-15");

    // In UTC: both are March 14 — same day!
    expect(toLocalDateString(justBeforeTokyoMidnight, "UTC")).toBe("2024-03-14");
    expect(toLocalDateString(justPastTokyoMidnight, "UTC")).toBe("2024-03-14");

    // Streak in Tokyo: review yesterday, now today → alive
    expect(computeStreak([justBeforeTokyoMidnight], justPastTokyoMidnight, tokyoTz)).toBe(1);
  });
});
