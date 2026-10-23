/**
 * Ollama HTTP API implementation of LlmProvider.
 * Calls local Ollama server (default: http://127.0.0.1:11434).
 * Uses native fetch (Node 24) with timeouts and loopback safety.
 */

import type { LlmProvider, ChatMessage } from "./types.js";
import { logger } from "../logger.js";

export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

export class OllamaLlmProvider implements LlmProvider {
  readonly name = "ollama";
  readonly baseUrl: string;
  readonly model: string;

  constructor(config: OllamaConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.model = config.model;
  }

  /**
   * Health check: verify Ollama server is reachable.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(2500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Send a chat completion request to Ollama.
   */
  async chat(
    messages: readonly ChatMessage[],
    options?: { jsonFormat?: boolean; timeoutMs?: number },
  ): Promise<string> {
    const timeoutMs = options?.timeoutMs ?? 45_000;
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    };

    if (options?.jsonFormat) {
      body.format = "json";
    }

    logger.debug("Ollama chat request", {
      model: this.model,
      messageCount: messages.length,
      jsonFormat: options?.jsonFormat,
    });

    const startTime = Date.now();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      logger.warn("Ollama request failed", {
        model: this.model,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error(
        `Ollama connection error (${this.baseUrl}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      logger.warn("Ollama HTTP error response", {
        status: res.status,
        error: errText,
      });
      throw new Error(`Ollama returned HTTP ${res.status}: ${errText}`);
    }

    const json = (await res.json()) as { message?: { content?: string } };
    const content = json.message?.content ?? "";

    logger.debug("Ollama chat response received", {
      model: this.model,
      durationMs: Date.now() - startTime,
      responseLength: content.length,
    });

    return content;
  }
}
