/**
 * Local controller orchestrates local open-model features:
 * - Deck generation via local LLM
 * - Answer judging via local LLM
 * - Integration with EchoDeckService (pure Leitner scheduling)
 * - Answer-leak rule enforcement: back is never leaked before answering
 */

import type { EchoDeckService } from "../domain/service.js";
import type { Store } from "../store/store.js";
import type { Rating } from "../domain/types.js";
import {
  type LlmProvider,
  type SttProvider,
  type TtsProvider,
  type JudgeEvaluation,
} from "./types.js";
import { CardGenerator } from "./card-generator.js";
import { AnswerJudge } from "./answer-judge.js";
import { validateDeckName, type ValidationConfig } from "../domain/validation.js";

export interface LocalControllerOptions {
  service: EchoDeckService;
  store: Store;
  llm: LlmProvider;
  stt: SttProvider;
  tts: TtsProvider;
  maxCardsPerCall: number;
  maxTextLength: number;
}

export class LocalController {
  readonly service: EchoDeckService;
  readonly store: Store;
  readonly llm: LlmProvider;
  readonly stt: SttProvider;
  readonly tts: TtsProvider;
  readonly cardGenerator: CardGenerator;
  readonly answerJudge: AnswerJudge;
  readonly validationConfig: ValidationConfig;

  constructor(opts: LocalControllerOptions) {
    this.service = opts.service;
    this.store = opts.store;
    this.llm = opts.llm;
    this.stt = opts.stt;
    this.tts = opts.tts;
    this.cardGenerator = new CardGenerator(opts.llm);
    this.answerJudge = new AnswerJudge(opts.llm);
    this.validationConfig = {
      maxCardsPerCall: opts.maxCardsPerCall,
      maxTextLength: opts.maxTextLength,
    };
  }

  async getStatus() {
    const [llmAvailable, sttAvailable, ttsAvailable] = await Promise.all([
      this.llm.isAvailable().catch(() => false),
      this.stt.isAvailable().catch(() => false),
      this.tts.isAvailable().catch(() => false),
    ]);

    return {
      llm: {
        provider: this.llm.name,
        model: this.llm.model,
        available: llmAvailable,
      },
      stt: {
        provider: this.stt.name,
        available: sttAvailable,
      },
      tts: {
        provider: this.tts.name,
        available: ttsAvailable,
      },
    };
  }

  /**
   * Generate cards from user notes and add them to a deck.
   */
  async generateDeck(deckNameRaw: string, notesRaw: string, now: number) {
    const deckName = validateDeckName(deckNameRaw);
    if (!deckName) {
      return {
        result: null,
        error: "invalid_deck_name",
        message: "The deck name cannot be empty.",
      };
    }

    const trimmedNotes = (notesRaw ?? "").trim();
    if (!trimmedNotes) {
      return {
        result: null,
        error: "empty_notes",
        message: "Please provide notes to generate flashcards from.",
      };
    }

    const available = await this.llm.isAvailable();
    if (!available) {
      return {
        result: null,
        error: "llm_unavailable",
        message: `Local LLM provider (${this.llm.name}) is not reachable. Check that Ollama is running.`,
      };
    }

    const existingFronts = this.store.getExistingFronts(deckName);
    const validation = await this.cardGenerator.generateFromNotes(
      trimmedNotes,
      existingFronts,
      this.validationConfig,
    );

    if (validation.valid.length === 0) {
      const reasons: string[] = [];
      if (validation.skippedDuplicate > 0) reasons.push(`${validation.skippedDuplicate} duplicate(s)`);
      if (validation.skippedEmpty > 0) reasons.push(`${validation.skippedEmpty} empty`);
      const details = reasons.length > 0 ? ` (${reasons.join(", ")})` : "";
      return {
        result: null,
        error: "no_valid_cards",
        message: `No new cards could be generated from the notes${details}. Try providing more detailed or structured text.`,
      };
    }

    return this.service.createDeck(deckName, validation.valid, now);
  }

  /**
   * Get next card for study.
   * ANSWER-LEAK RULE: The `back` is deliberately NOT returned here.
   */
  getNextCard(deckNameRaw: string | undefined, now: number) {
    const res = this.service.nextCard(deckNameRaw, now);
    if (res.done) {
      return {
        done: true,
        streak: res.streak ?? 0,
        dueCount: res.dueCount ?? 0,
        message: res.message ?? "No cards are due.",
        error: res.error,
      };
    }

    return {
      done: false,
      cardId: res.cardId,
      deckName: res.deckName,
      front: res.front,
      // back is omitted!
      position: res.position,
      total: res.total,
      dueCount: res.dueCount,
      streak: res.streak,
    };
  }

  /**
   * Judge user's answer using local LLM, then apply rating using pure SRS.
   */
  async judgeAndGradeAnswer(cardId: string, userAnswerRaw: string, now: number) {
    const card = this.store.getCardById(cardId);
    if (!card) {
      return {
        error: "not_found",
        message: "Card not found.",
      };
    }

    const userAnswer = (userAnswerRaw ?? "").trim();
    const evalResult: JudgeEvaluation = await this.answerJudge.judge(
      card.front,
      card.back,
      userAnswer,
    );

    if (evalResult.fallback || !evalResult.rating) {
      return {
        fallback: true,
        cardId: card.id,
        front: card.front,
        back: card.back, // Revealed now so user can self-rate
        reasoning: evalResult.reasoning || "Could not automatically grade answer. Please self-rate.",
        error: evalResult.error,
      };
    }

    // Pass valid rating into deterministic SRS
    const graded = this.service.gradeAnswer(card.id, evalResult.rating, now);

    return {
      fallback: false,
      cardId: card.id,
      rating: evalResult.rating,
      reasoning: evalResult.reasoning,
      newBox: graded.newBox,
      nextReview: graded.nextReview,
      streak: graded.streak,
      cardsLeft: graded.cardsLeft,
      front: card.front,
      back: card.back, // Revealed after answering!
    };
  }

  /**
   * Self-grade fallback: user picked a rating directly.
   */
  selfGrade(cardId: string, rating: Rating, now: number) {
    return this.service.gradeAnswer(cardId, rating, now);
  }

  getDecksAndProgress(now: number) {
    const decks = this.store.getDeckNames();
    const progress = this.service.getProgress(undefined, now);
    return { decks, progress };
  }
}
