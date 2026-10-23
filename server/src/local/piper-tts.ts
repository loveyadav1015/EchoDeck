/**
 * Piper text-to-speech adapter.
 * Connects to a local Piper HTTP server or stream.
 * Falls back gracefully to null when unavailable, allowing client-side Web Speech fallback.
 */

import type { TtsProvider } from "./types.js";
import { logger } from "../logger.js";

export interface PiperConfig {
  baseUrl?: string;
}

export class PiperTtsProvider implements TtsProvider {
  readonly name = "piper";
  readonly baseUrl: string | undefined;

  constructor(config: PiperConfig = {}) {
    this.baseUrl = config.baseUrl?.replace(/\/+$/, "");
  }

  async isAvailable(): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      const res = await fetch(`${this.baseUrl}/`, {
        method: "GET",
        signal: AbortSignal.timeout(1500),
      });
      return res.status < 500;
    } catch {
      return false;
    }
  }

  async synthesize(text: string): Promise<Buffer | null> {
    if (!this.baseUrl) {
      return null;
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        logger.warn("Piper TTS returned non-200", { status: res.status });
        return null;
      }

      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      logger.warn("Piper TTS synthesis failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
