/**
 * Input validation, trimming, and deduplication helpers.
 * No SDK imports.
 */

export interface CardInput {
  front: string;
  back: string;
}

export interface ValidationConfig {
  maxCardsPerCall: number;
  maxTextLength: number;
}

export interface ValidatedCard {
  front: string;
  back: string;
}

export interface ValidationResult {
  valid: ValidatedCard[];
  skippedEmpty: number;
  skippedDuplicate: number;
  skippedOverLimit: number;
  truncated: number;
}

/**
 * Trim a card side text and truncate to the max length.
 */
function trimAndTruncate(text: string, maxLength: number): { text: string; wasTruncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length > maxLength) {
    return { text: trimmed.slice(0, maxLength), wasTruncated: true };
  }
  return { text: trimmed, wasTruncated: false };
}

/**
 * Validate and clean a batch of card inputs.
 *
 * - Trims whitespace from front and back.
 * - Truncates to maxTextLength.
 * - Skips cards where front or back is empty after trimming.
 * - Skips cards whose front (case-insensitive) already exists in `existingFronts`.
 * - Deduplicates within the batch itself (first occurrence wins).
 * - Enforces maxCardsPerCall limit.
 */
export function validateCards(
  inputs: readonly CardInput[],
  existingFronts: ReadonlySet<string>,
  config: ValidationConfig,
): ValidationResult {
  const result: ValidationResult = {
    valid: [],
    skippedEmpty: 0,
    skippedDuplicate: 0,
    skippedOverLimit: 0,
    truncated: 0,
  };

  const seenInBatch = new Set<string>();

  for (const input of inputs) {
    if (result.valid.length >= config.maxCardsPerCall) {
      result.skippedOverLimit += inputs.length - inputs.indexOf(input);
      break;
    }

    const front = trimAndTruncate(input.front ?? "", config.maxTextLength);
    const back = trimAndTruncate(input.back ?? "", config.maxTextLength);

    if (front.wasTruncated || back.wasTruncated) {
      result.truncated++;
    }

    if (front.text === "" || back.text === "") {
      result.skippedEmpty++;
      continue;
    }

    const frontLower = front.text.toLowerCase();

    if (existingFronts.has(frontLower) || seenInBatch.has(frontLower)) {
      result.skippedDuplicate++;
      continue;
    }

    seenInBatch.add(frontLower);
    result.valid.push({ front: front.text, back: back.text });
  }

  return result;
}

/**
 * Validate a deck name: trim, check non-empty.
 */
export function validateDeckName(name: string): string | null {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Case-insensitive deck name match.
 */
export function deckNameMatch(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
