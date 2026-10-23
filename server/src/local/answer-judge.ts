/**
 * Answer judging using local LLM with Zod validation, retry, and safe fallback.
 *
 * Requirements:
 * - Deterministic Leitner rating scale: "again" | "hard" | "good" | "easy"
 * - Validate structured JSON with zod
 * - 1 retry on malformed output
 * - Safe fallback to user self-rating on failure, never a crash or silent wrong rating
 * - Never log user answers above debug level
 */

import {
  type LlmProvider,
  type JudgeEvaluation,
  type ChatMessage,
  JudgeResponseSchema,
} from "./types.js";
import { logger } from "../logger.js";

const SYSTEM_PROMPT = `You are an objective flashcard quiz evaluator.
Compare the learner's answer to the expected answer (the back of the card) given the question (the front of the card).
Determine the learner's recall accuracy and return a JSON object with:
- "rating": one of "again", "hard", "good", "easy"
- "reasoning": a concise explanation (1-2 sentences) of why this rating was assigned

Rating guidelines:
- "again": The answer is completely incorrect, fundamentally wrong, misses the core fact, or the learner stated they do not know.
- "hard": The answer is partially correct, struggled significantly, or missed important nuances.
- "good": The answer is substantially correct and captures the essential concept, even if phrased differently.
- "easy": The answer is completely correct, precise, confident, and demonstrates effortless mastery.

Output ONLY valid JSON. Example:
{"rating":"good","reasoning":"Answer accurately identifies the main mechanism despite minor phrasing differences."}`;

export function extractJsonString(raw: string): string {
  const trimmed = raw.trim();
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

export function parseJudgeJson(raw: string): { rating: "again" | "hard" | "good" | "easy"; reasoning?: string } | null {
  try {
    const jsonStr = extractJsonString(raw);
    const parsed = JSON.parse(jsonStr);
    const validated = JudgeResponseSchema.safeParse(parsed);
    if (validated.success) {
      return validated.data;
    }
  } catch {
    // Malformed JSON
  }
  return null;
}

export class AnswerJudge {
  private readonly llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  async judge(
    front: string,
    back: string,
    userAnswer: string,
  ): Promise<JudgeEvaluation> {
    logger.debug("Judging answer", { front, back, userAnswer });

    const userPrompt = `Question (Front): ${front}
Expected Answer (Back): ${back}
Learner Answer: ${userAnswer}

Evaluate the learner's answer and return the JSON object:`;

    const initialMessages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    let firstRawOutput = "";
    try {
      firstRawOutput = await this.llm.chat(initialMessages, { jsonFormat: true });
    } catch (err) {
      logger.warn("LLM failed on first judge attempt", {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        rating: null,
        reasoning: "LLM provider is currently unavailable. Please self-rate.",
        fallback: true,
        error: "provider_unavailable",
      };
    }

    const firstParsed = parseJudgeJson(firstRawOutput);
    if (firstParsed) {
      return {
        rating: firstParsed.rating,
        reasoning: firstParsed.reasoning,
        fallback: false,
      };
    }

    logger.debug("First judge attempt yielded invalid JSON, retrying once", {
      rawOutput: firstRawOutput,
    });

    // 1 Retry with explicit correction prompt
    const retryMessages: ChatMessage[] = [
      ...initialMessages,
      { role: "assistant", content: firstRawOutput },
      {
        role: "user",
        content: `Your response was not valid JSON matching {"rating": "again"|"hard"|"good"|"easy", "reasoning": "..."}. Please output ONLY the raw JSON object now.`,
      },
    ];

    let secondRawOutput = "";
    try {
      secondRawOutput = await this.llm.chat(retryMessages, { jsonFormat: true });
    } catch (err) {
      logger.warn("LLM failed on retry judge attempt", {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        rating: null,
        reasoning: "LLM evaluation failed. Please self-rate.",
        fallback: true,
        error: "provider_error",
      };
    }

    const secondParsed = parseJudgeJson(secondRawOutput);
    if (secondParsed) {
      return {
        rating: secondParsed.rating,
        reasoning: secondParsed.reasoning,
        fallback: false,
      };
    }

    logger.warn("Judge retry also yielded invalid JSON, falling back to self-rate", {
      secondRawOutput,
    });

    return {
      rating: null,
      reasoning: "Unable to parse model grading output. Please self-rate.",
      fallback: true,
      error: "malformed_output",
    };
  }
}
