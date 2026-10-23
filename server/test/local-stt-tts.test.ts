/**
 * Unit tests for local STT (whisper) and TTS (piper) adapters.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { WhisperSttProvider } from "../src/local/whisper-stt.js";
import { PiperTtsProvider } from "../src/local/piper-tts.js";

describe("WhisperSttProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns isAvailable false when baseUrl is unset", async () => {
    const provider = new WhisperSttProvider();
    expect(await provider.isAvailable()).toBe(false);
  });

  it("returns isAvailable true when endpoint is reachable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));
    const provider = new WhisperSttProvider({ baseUrl: "http://127.0.0.1:8080" });
    expect(await provider.isAvailable()).toBe(true);
  });

  it("throws clear error when transcribing without configured baseUrl", async () => {
    const provider = new WhisperSttProvider();
    await expect(provider.transcribe(Buffer.from("dummy audio"))).rejects.toThrow(
      "Whisper STT endpoint is not configured",
    );
  });

  it("transcribes audio buffer and returns parsed text", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 200 })) // isAvailable check
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "Transmission Control Protocol" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const provider = new WhisperSttProvider({ baseUrl: "http://127.0.0.1:8080" });
    const text = await provider.transcribe(Buffer.from([0, 1, 2, 3]), "audio/wav");
    expect(text).toBe("Transmission Control Protocol");
  });
});

describe("PiperTtsProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns isAvailable false when baseUrl is unset", async () => {
    const provider = new PiperTtsProvider();
    expect(await provider.isAvailable()).toBe(false);
  });

  it("returns null gracefully when baseUrl is unset (allowing UI fallback)", async () => {
    const provider = new PiperTtsProvider();
    const result = await provider.synthesize("Hello world");
    expect(result).toBeNull();
  });

  it("synthesizes audio when Piper server returns 200", async () => {
    const fakeAudio = new Uint8Array([82, 73, 70, 70]); // "RIFF"
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(fakeAudio, {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      }),
    );

    const provider = new PiperTtsProvider({ baseUrl: "http://127.0.0.1:5000" });
    const buffer = await provider.synthesize("What is DNS?");
    expect(buffer).not.toBeNull();
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer!.length).toBe(4);
  });

  it("returns null gracefully if Piper server returns non-200 or fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server error", { status: 500 }),
    );

    const provider = new PiperTtsProvider({ baseUrl: "http://127.0.0.1:5000" });
    const buffer = await provider.synthesize("Test");
    expect(buffer).toBeNull();
  });
});
