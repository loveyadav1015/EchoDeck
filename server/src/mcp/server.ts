/**
 * MCP server: builds the McpServer, registers all four tools and the UI resource.
 *
 * This is the SDK isolation boundary. All @modelcontextprotocol imports live here.
 * Tool handlers are thin: validate → call service → shape the response.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import type { EchoDeckService } from "../domain/service.js";
import type { Rating } from "../domain/types.js";
import { loadUiHtml } from "./ui-resource.js";

const UI_RESOURCE_URI = "ui://echodeck/card.html";

/**
 * Shape a standard tool result with both text content and structured data.
 * Every code path must return both, per platform requirements.
 */
function toolResult(
  text: string,
  structuredContent: Record<string, unknown>,
  options?: { includeUi?: boolean },
): CallToolResult {
  const result: CallToolResult = {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };

  if (options?.includeUi) {
    result._meta = {
      ui: {
        resourceUri: UI_RESOURCE_URI,
      },
    };
  }

  return result;
}

export interface McpServerOptions {
  localController?: {
    generateDeck: (
      deckName: string,
      notes: string,
      now: number,
    ) => Promise<{
      result: unknown;
      error: string | null;
      message: string;
    }>;
  };
}

export function createMcpServer(
  service: EchoDeckService,
  options?: McpServerOptions,
): McpServer {
  const server = new McpServer({
    name: "echodeck",
    version: "1.0.0",
  });

  // ── UI resource ──────────────────────────────────────────

  const uiHtml = loadUiHtml();

  registerAppResource(
    server,
    "card-ui",
    UI_RESOURCE_URI,
    {},
    async () => {
      return {
        contents: [
          {
            uri: UI_RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: uiHtml,
          },
        ],
      };
    },
  );

  // ── Tool: create_deck ────────────────────────────────────
  // Using registerTool (non-deprecated API with config object)

  server.registerTool(
    "create_deck",
    {
      description: "Call when the learner wants to create a study deck or add notes. Provide a deck name and a list of question and answer cards derived from what the learner said.",
      inputSchema: {
        deckName: z.string().min(1).describe("Name of the deck to create or add to"),
        cards: z.array(
          z.object({
            front: z.string().describe("The question or front of the card"),
            back: z.string().describe("The answer or back of the card"),
          }),
        ).min(1).describe("List of cards with front (question) and back (answer)"),
      },
    },
    async ({ deckName, cards }) => {
      const now = Date.now();
      const { result, error, message } = service.createDeck(deckName, cards, now);

      if (error) {
        return toolResult(message, { error });
      }

      return toolResult(message, { ...result! });
    },
  );

  // ── Tool: next_card (has UI) ─────────────────────────────

  registerAppTool(
    server,
    "next_card",
    {
      description: "Call when the learner asks to be quizzed or wants the next card. Returns one due card. Read ONLY the front aloud. Do not reveal the back until the learner has answered.",
      inputSchema: z.object({
        deckName: z.string().optional().describe("Optional deck name to quiz from"),
      }),
      _meta: {
        ui: {
          resourceUri: UI_RESOURCE_URI,
        },
      },
    },
    async ({ deckName }: { deckName?: string }) => {
      const now = Date.now();
      const result = service.nextCard(deckName, now);

      if (result.done) {
        // Nothing due, deck not found, or error
        const structured: Record<string, unknown> = {
          done: true,
          streak: result.streak ?? 0,
          dueCount: result.dueCount ?? 0,
        };
        if (result.error) structured.error = result.error;
        if (result.message) structured.message = result.message;
        return toolResult(result.message ?? "No cards are due.", structured, { includeUi: true });
      }

      // Card found — text MUST NOT contain the back
      const text = `Card ${result.position} of ${result.total} from "${result.deckName}": ${result.front}`;

      return toolResult(text, {
        done: false,
        cardId: result.cardId,
        deckName: result.deckName,
        front: result.front,
        back: result.back,
        position: result.position,
        total: result.total,
        dueCount: result.dueCount,
        streak: result.streak,
      }, { includeUi: true });
    },
  );

  // ── Tool: grade_answer (has UI) ──────────────────────────

  registerAppTool(
    server,
    "grade_answer",
    {
      description: "Call after the learner answers a card. Compare the spoken answer with the back of the card and choose a rating: again (wrong), hard (barely right), good (right), easy (instant and confident).",
      inputSchema: z.object({
        cardId: z.string().describe("ID of the card being graded"),
        rating: z.enum(["again", "hard", "good", "easy"]).describe("How well the learner answered"),
      }),
      _meta: {
        ui: {
          resourceUri: UI_RESOURCE_URI,
        },
      },
    },
    async ({
      cardId,
      rating,
    }: {
      cardId: string;
      rating: "again" | "hard" | "good" | "easy";
    }) => {
      const now = Date.now();
      const result = service.gradeAnswer(cardId, rating as Rating, now);

      if (result.error) {
        return toolResult(
          result.message ?? "I could not find that card.",
          { error: result.error },
          { includeUi: true },
        );
      }

      const text = `Rated "${rating}". This card moves to box ${result.newBox} and is due ${result.nextReview}. You have ${result.cardsLeft} card${result.cardsLeft === 1 ? "" : "s"} left. Your streak is ${result.streak} day${result.streak === 1 ? "" : "s"}.`;

      return toolResult(text, {
        cardId: result.cardId,
        rating: result.rating,
        newBox: result.newBox,
        nextReview: result.nextReview,
        streak: result.streak,
        cardsLeft: result.cardsLeft,
        front: result.front,
        back: result.back,
      }, { includeUi: true });
    },
  );

  // ── Tool: get_progress ───────────────────────────────────

  server.registerTool(
    "get_progress",
    {
      description: "Call when the learner asks how they are doing, about their streak, or what is due.",
      inputSchema: {
        deckName: z.string().optional().describe("Optional deck to get progress for"),
      },
    },
    async ({ deckName }) => {
      const now = Date.now();
      const result = service.getProgress(deckName, now);

      const deckLabel = deckName ? ` in "${deckName}"` : "";
      const text = `You have a ${result.streak} day streak. ${result.dueToday} card${result.dueToday === 1 ? " is" : "s are"} due today${deckLabel}. ${result.mastered} of ${result.totalCards} card${result.totalCards === 1 ? " is" : "s are"} mastered.`;

      return toolResult(text, { ...result });
    },
  );

  // ── Tool: generate_deck_from_notes (optional local AI) ───

  if (options?.localController) {
    const controller = options.localController;
    server.registerTool(
      "generate_deck_from_notes",
      {
        description: "Call when the learner provides notes or text and wants to automatically generate flashcards using local AI.",
        inputSchema: {
          deckName: z.string().min(1).describe("Name of the deck to create or add to"),
          notes: z.string().min(1).describe("Notes or text content to generate flashcards from"),
        },
      },
      async ({ deckName, notes }) => {
        const now = Date.now();
        const { result, error, message } = await controller.generateDeck(deckName, notes, now);
        if (error) {
          return toolResult(message, { error });
        }
        return toolResult(message, { ...(result as Record<string, unknown>) });
      },
    );
  }

  return server;
}
