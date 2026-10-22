/**
 * Pure, timezone-aware streak calculation.
 * No SDK imports. Does NOT use toISOString() (that is UTC).
 */

/**
 * Format an epoch-ms timestamp as a YYYY-MM-DD string in the given IANA timezone.
 * Uses Intl.DateTimeFormat with 'en-CA' locale which produces YYYY-MM-DD natively.
 */
export function toLocalDateString(epochMs: number, tz: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(epochMs));
}

/**
 * Get today's date string in the given timezone.
 */
export function todayInTz(now: number, tz: string): string {
  return toLocalDateString(now, tz);
}

/**
 * Subtract one calendar day from a YYYY-MM-DD string.
 */
function previousDay(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Compute the streak from a list of review timestamps.
 *
 * Streak = consecutive calendar days (in the configured timezone)
 * with at least one review, counted back from today.
 *
 * If there is no review today but there was one yesterday,
 * the streak is still alive and counts back from yesterday.
 * Otherwise the streak is 0.
 *
 * @param reviewTimestamps - Array of epoch-ms timestamps of graded reviews.
 * @param now - Current epoch-ms.
 * @param tz - IANA timezone string.
 * @returns The current streak count (number of consecutive days).
 */
export function computeStreak(
  reviewTimestamps: readonly number[],
  now: number,
  tz: string,
): number {
  if (reviewTimestamps.length === 0) {
    return 0;
  }

  // Build a set of unique review dates
  const dateSet = new Set<string>();
  for (const ts of reviewTimestamps) {
    dateSet.add(toLocalDateString(ts, tz));
  }

  const today = todayInTz(now, tz);
  const yesterday = previousDay(today);

  let current: string;
  if (dateSet.has(today)) {
    current = today;
  } else if (dateSet.has(yesterday)) {
    current = yesterday;
  } else {
    return 0;
  }

  let streak = 0;
  while (dateSet.has(current)) {
    streak++;
    current = previousDay(current);
  }

  return streak;
}
