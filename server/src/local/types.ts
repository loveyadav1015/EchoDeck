/**
 * Type definitions and interfaces for local open-source AI providers.
 *
 * Core domain logic (domain/, store/) does NOT depend on this module.
 */

import { z } from "zod";
import type { Rating } from "../domain/types.js";

export const RATING_VALUES = ["again", "hard", "good", "easy"] as const;

export const JudgeResponseSchema = z.object({
  rating: z.enum(RATING_VALUES),
  reasoning: z.string().optional(),
});
export type JudgeResponse = z.infer<typeof JudgeResponseSchema>;

export const GeneratedCardsSchema = z.array(
  z.object({
    front: z.string(),
    back: z.string(),
  }),
);

export interface JudgeEvaluation {
  rating: Rating | null;
  reasoning?: string;
  fallback: boolean;
  error?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  isAvailable(): Promise<boolean>;
  chat(
    messages: readonly ChatMessage[],
    options?: { jsonFormat?: boolean; timeoutMs?: number },
  ): Promise<string>;
}

export interface SttProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  transcribe(audio: Buffer | Uint8Array, mimeType?: string): Promise<string>;
}

export interface TtsProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  synthesize(text: string): Promise<Buffer | null>;
}
