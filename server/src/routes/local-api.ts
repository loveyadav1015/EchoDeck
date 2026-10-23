/**
 * REST routes for EchoDeck local mode.
 * Exposes endpoints for local deck generation, study flow, answer judging, STT, and TTS.
 */

import { Router, type Request, type Response, raw } from "express";
import type { LocalController } from "../local/local-controller.js";
import { RATING_VALUES } from "../local/types.js";
import { logger } from "../logger.js";

export function createLocalApiRouter(controller: LocalController): Router {
  const router = Router();

  // ── GET /api/status ──────────────────────────────────────────
  router.get("/status", async (_req: Request, res: Response) => {
    try {
      const status = await controller.getStatus();
      res.json(status);
    } catch (err) {
      res.status(500).json({ error: "Failed to query provider status" });
    }
  });

  // ── GET /api/decks ───────────────────────────────────────────
  router.get("/decks", (_req: Request, res: Response) => {
    const now = Date.now();
    const data = controller.getDecksAndProgress(now);
    res.json(data);
  });

  // ── POST /api/generate-deck ──────────────────────────────────
  router.post("/generate-deck", async (req: Request, res: Response) => {
    const { deckName, notes } = req.body ?? {};
    if (!deckName || typeof deckName !== "string") {
      res.status(400).json({ error: "invalid_deck_name", message: "Deck name is required." });
      return;
    }
    if (!notes || typeof notes !== "string") {
      res.status(400).json({ error: "empty_notes", message: "Notes text is required." });
      return;
    }

    try {
      const now = Date.now();
      const result = await controller.generateDeck(deckName, notes, now);
      if (result.error) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } catch (err) {
      logger.error("Deck generation failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({
        error: "generation_failed",
        message: err instanceof Error ? err.message : "Failed to generate deck.",
      });
    }
  });

  // ── POST /api/study/next ─────────────────────────────────────
  // ANSWER-LEAK RULE: Card back is NEVER returned here.
  router.post("/study/next", (req: Request, res: Response) => {
    const { deckName } = req.body ?? {};
    const now = Date.now();
    const next = controller.getNextCard(deckName, now);
    res.json(next);
  });

  // ── POST /api/study/judge ────────────────────────────────────
  router.post("/study/judge", async (req: Request, res: Response) => {
    const { cardId, answer } = req.body ?? {};
    if (!cardId || typeof cardId !== "string") {
      res.status(400).json({ error: "invalid_card_id", message: "cardId is required." });
      return;
    }

    try {
      const now = Date.now();
      const result = await controller.judgeAndGradeAnswer(cardId, String(answer ?? ""), now);
      if ("error" in result && result.error === "not_found") {
        res.status(404).json(result);
        return;
      }
      res.json(result);
    } catch (err) {
      logger.error("Answer judging failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({
        fallback: true,
        error: "judge_error",
        message: "Answer judging encountered an unexpected error. Please self-rate.",
      });
    }
  });

  // ── POST /api/study/self-grade ───────────────────────────────
  router.post("/study/self-grade", (req: Request, res: Response) => {
    const { cardId, rating } = req.body ?? {};
    if (!cardId || typeof cardId !== "string") {
      res.status(400).json({ error: "invalid_card_id", message: "cardId is required." });
      return;
    }
    if (!rating || !RATING_VALUES.includes(rating)) {
      res.status(400).json({
        error: "invalid_rating",
        message: `rating must be one of: ${RATING_VALUES.join(", ")}.`,
      });
      return;
    }

    const now = Date.now();
    const result = controller.selfGrade(cardId, rating, now);
    if (result.error) {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  });

  // ── POST /api/stt ────────────────────────────────────────────
  router.post(
    "/stt",
    raw({ type: ["audio/*", "application/octet-stream"], limit: "15mb" }),
    async (req: Request, res: Response) => {
      const isAvailable = await controller.stt.isAvailable();
      if (!isAvailable) {
        res.status(503).json({
          error: "stt_unavailable",
          message: "Local Speech-to-Text service (Whisper) is not available.",
        });
        return;
      }

      if (!req.body || (req.body as Buffer).length === 0) {
        res.status(400).json({ error: "empty_audio", message: "No audio data received." });
        return;
      }

      try {
        const mimeType = req.headers["content-type"] || "audio/wav";
        const text = await controller.stt.transcribe(req.body as Buffer, mimeType);
        res.json({ text });
      } catch (err) {
        logger.warn("STT transcription failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        res.status(500).json({
          error: "stt_error",
          message: err instanceof Error ? err.message : "Transcription failed.",
        });
      }
    },
  );

  // ── POST /api/tts ────────────────────────────────────────────
  router.post("/tts", async (req: Request, res: Response) => {
    const { text } = req.body ?? {};
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "empty_text", message: "Text is required for TTS." });
      return;
    }

    const isAvailable = await controller.tts.isAvailable();
    if (!isAvailable) {
      res.status(503).json({
        fallback: true,
        error: "tts_unavailable",
        message: "Local Text-to-Speech service (Piper) is not available.",
      });
      return;
    }

    try {
      const audioBuffer = await controller.tts.synthesize(text);
      if (!audioBuffer) {
        res.status(503).json({
          fallback: true,
          error: "tts_unavailable",
          message: "Piper TTS returned no audio.",
        });
        return;
      }
      res.setHeader("Content-Type", "audio/wav");
      res.send(audioBuffer);
    } catch (err) {
      logger.warn("TTS synthesis error", {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({
        fallback: true,
        error: "tts_error",
        message: "Failed to synthesize speech.",
      });
    }
  });

  return router;
}
