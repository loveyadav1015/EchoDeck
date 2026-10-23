/**
 * Whisper.cpp speech-to-text adapter.
 * Connects to a local whisper.cpp HTTP server (default: http://127.0.0.1:8080/inference).
 * Falls back gracefully when the server is not running.
 */

import type { SttProvider } from "./types.js";
import { logger } from "../logger.js";

export interface WhisperConfig {
  baseUrl?: string;
}

export class WhisperSttProvider implements SttProvider {
  readonly name = "whisper";
  readonly baseUrl: string | undefined;

  constructor(config: WhisperConfig = {}) {
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

  async transcribe(audio: Buffer | Uint8Array, mimeType: string = "audio/wav"): Promise<string> {
    if (!this.baseUrl) {
      throw new Error("Whisper STT endpoint is not configured (STT_URL).");
    }

    const available = await this.isAvailable();
    if (!available) {
      throw new Error("Whisper STT server is not reachable.");
    }

    const formData = new FormData();
    const audioBlob = new Blob([new Uint8Array(audio)], { type: mimeType });
    formData.append("file", audioBlob, "audio.wav");

    const endpoint = `${this.baseUrl}/inference`;
    const res = await fetch(endpoint, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Whisper STT error (HTTP ${res.status}): ${errText}`);
    }

    const result = (await res.json()) as { text?: string };
    const transcribedText = (result.text ?? "").trim();
    logger.debug("Whisper transcription completed", {
      textLength: transcribedText.length,
    });

    return transcribedText;
  }
}
