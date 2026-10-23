/**
 * Card generation from notes using local LLM.
 *
 * Requirements:
 * - Chunks long input to fit model context.
 * - Extracts structured JSON array of {front, back}.
 * - Respects validation limits (MAX_CARDS_PER_CALL, MAX_TEXT_LENGTH, trimming, dedup).
 * - Never logs notes above debug level.
 */

import { type LlmProvider, type ChatMessage, GeneratedCardsSchema } from "./types.js";
import { validateCards, type ValidationResult, type ValidationConfig } from "../domain/validation.js";
import { logger } from "../logger.js";

const CHUNK_SIZE = 2500;

export function chunkText(text: string, maxChunkLength: number = CHUNK_SIZE): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxChunkLength) {
    return trimmed ? [trimmed] : [];
  }

  const chunks: string[] = [];
  const paragraphs = trimmed.split(/\n\s*\n/);
  let currentChunk = "";

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    if (currentChunk.length + trimmedPara.length + 2 <= maxChunkLength) {
      currentChunk = currentChunk ? `${currentChunk}\n\n${trimmedPara}` : trimmedPara;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      // If a single paragraph is larger than maxChunkLength, split by sentences or hard break
      if (trimmedPara.length > maxChunkLength) {
        let remaining = trimmedPara;
        while (remaining.length > maxChunkLength) {
          // Try to break at sentence boundary
          let breakIdx = remaining.lastIndexOf(". ", maxChunkLength);
          if (breakIdx === -1 || breakIdx < maxChunkLength * 0.4) {
            breakIdx = remaining.lastIndexOf(" ", maxChunkLength);
          }
          if (breakIdx === -1) {
            breakIdx = maxChunkLength;
          } else {
            breakIdx += 1;
          }
          chunks.push(remaining.slice(0, breakIdx).trim());
          remaining = remaining.slice(breakIdx).trim();
        }
        currentChunk = remaining;
      } else {
        currentChunk = trimmedPara;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

const GENERATE_SYSTEM_PROMPT = `You are a study card generator.
Read the provided notes and extract clear, concise flashcard question-and-answer pairs.
Guidelines:
- Each card must have a specific "front" (question/prompt) and an accurate "back" (answer).
- Focus on key concepts, definitions, and facts.
- Output a JSON object with a "cards" array containing { "front": "...", "back": "..." } objects.
Example format:
{
  "cards": [
    {"front": "What does DNS stand for?", "back": "Domain Name System"},
    {"front": "What is the function of ARP?", "back": "Resolves IP addresses to MAC addresses on a local network"}
  ]
}`;

export function extractJsonCardsString(raw: string): string {
  const trimmed = raw.trim();
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");

  // Determine whether an array or an object opens first
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    if (lastBracket > firstBracket) {
      return trimmed.slice(firstBracket, lastBracket + 1);
    }
  }

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

export function parseCardsJson(raw: string): Array<{ front: string; back: string }> {
  try {
    const jsonStr = extractJsonCardsString(raw);
    const parsed = JSON.parse(jsonStr);

    if (Array.isArray(parsed)) {
      const validated = GeneratedCardsSchema.safeParse(parsed);
      if (validated.success) return validated.data;
    } else if (parsed && typeof parsed === "object") {
      if (Array.isArray((parsed as any).cards)) {
        const validated = GeneratedCardsSchema.safeParse((parsed as any).cards);
        if (validated.success) return validated.data;
      }
      if (Array.isArray((parsed as any).flashcards)) {
        const validated = GeneratedCardsSchema.safeParse((parsed as any).flashcards);
        if (validated.success) return validated.data;
      }
      if (
        typeof (parsed as any).front === "string" &&
        typeof (parsed as any).back === "string"
      ) {
        return [{ front: (parsed as any).front, back: (parsed as any).back }];
      }
    }
  } catch {
    // Malformed JSON
  }
  return [];
}

export class CardGenerator {
  private readonly llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  /**
   * Generate and validate cards from raw notes text.
   */
  async generateFromNotes(
    notes: string,
    existingFronts: ReadonlySet<string>,
    validationConfig: ValidationConfig,
  ): Promise<ValidationResult> {
    logger.debug("Generating cards from notes", {
      notesLength: notes.length,
      existingCount: existingFronts.size,
    });

    const chunks = chunkText(notes);
    if (chunks.length === 0) {
      return {
        valid: [],
        skippedEmpty: 0,
        skippedDuplicate: 0,
        skippedOverLimit: 0,
        truncated: 0,
      };
    }

    const rawCards: Array<{ front: string; back: string }> = [];

    for (const chunk of chunks) {
      // Don't generate more if we already reached limit
      if (rawCards.length >= validationConfig.maxCardsPerCall) {
        break;
      }

      const messages: ChatMessage[] = [
        { role: "system", content: GENERATE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Extract flashcards from this text:\n\n${chunk}`,
        },
      ];

      try {
        const rawOutput = await this.llm.chat(messages, { jsonFormat: true });
        const cards = parseCardsJson(rawOutput);
        rawCards.push(...cards);
      } catch (err) {
        logger.warn("Card generation chunk failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Pass through domain validation (trim, truncate, skip empty, dedup, limit)
    return validateCards(rawCards, existingFronts, validationConfig);
  }
}
