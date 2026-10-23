/**
 * Unit tests for local LLM integration:
 * - Card generation: valid, malformed, over-limit, empty, duplicate
 * - Answer judging: correct, wrong, malformed JSON, retry then fallback
 * - Provider-unavailable fallback
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LlmProvider, ChatMessage } from "../src/local/types.js";
import { CardGenerator, chunkText } from "../src/local/card-generator.js";
import { AnswerJudge, extractJsonString, parseJudgeJson } from "../src/local/answer-judge.js";
import { OllamaLlmProvider } from "../src/local/ollama-llm.js";

describe("chunkText helper", () => {
  it("returns single chunk for short text", () => {
    const text = "Short note about TCP and UDP.";
    const chunks = chunkText(text, 100);
    expect(chunks).toEqual([text]);
  });

  it("splits paragraphs without exceeding max chunk size", () => {
    const p1 = "A".repeat(80);
    const p2 = "B".repeat(80);
    const combined = `${p1}\n\n${p2}`;
    const chunks = chunkText(combined, 100);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(p1);
    expect(chunks[1]).toBe(p2);
  });

  it("returns empty array for empty or whitespace text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });
});

describe("AnswerJudge JSON extraction", () => {
  it("extracts clean JSON from markdown code block", () => {
    const raw = "```json\n{\"rating\":\"good\",\"reasoning\":\"Accurate definition.\"}\n```";
    expect(extractJsonString(raw)).toBe("{\"rating\":\"good\",\"reasoning\":\"Accurate definition.\"}");
    const parsed = parseJudgeJson(raw);
    expect(parsed).toEqual({ rating: "good", reasoning: "Accurate definition." });
  });

  it("extracts JSON surrounded by conversational text", () => {
    const raw = "Here is my evaluation:\n{\"rating\":\"easy\",\"reasoning\":\"Spot on\"}\nHope this helps!";
    const parsed = parseJudgeJson(raw);
    expect(parsed).toEqual({ rating: "easy", reasoning: "Spot on" });
  });

  it("returns null for malformed JSON or invalid rating", () => {
    expect(parseJudgeJson("not a json at all")).toBeNull();
    expect(parseJudgeJson("{\"rating\": \"superb\"}")).toBeNull(); // 'superb' is not a valid SRS rating
  });
});

describe("CardGenerator with mocked LlmProvider", () => {
  const validationConfig = {
    maxCardsPerCall: 5,
    maxTextLength: 100,
  };

  it("handles valid card generation", async () => {
    const mockLlm: LlmProvider = {
      name: "mock-llm",
      model: "mock-model",
      isAvailable: vi.fn().mockResolvedValue(true),
      chat: vi.fn().mockResolvedValue(
        JSON.stringify([
          { front: "What is IP?", back: "Internet Protocol" },
          { front: "What is TCP?", back: "Transmission Control Protocol" },
        ]),
      ),
    };

    const generator = new CardGenerator(mockLlm);
    const existing = new Set<string>();
    const result = await generator.generateFromNotes("Some networking notes", existing, validationConfig);

    expect(result.valid).toHaveLength(2);
    expect(result.valid[0]).toEqual({ front: "What is IP?", back: "Internet Protocol" });
    expect(result.valid[1]).toEqual({ front: "What is TCP?", back: "Transmission Control Protocol" });
    expect(result.skippedEmpty).toBe(0);
    expect(result.skippedDuplicate).toBe(0);
  });

  it("handles malformed JSON from LLM gracefully", async () => {
    const mockLlm: LlmProvider = {
      name: "mock-llm",
      model: "mock-model",
      isAvailable: vi.fn().mockResolvedValue(true),
      chat: vi.fn().mockResolvedValue("Sorry, I cannot produce cards right now."),
    };

    const generator = new CardGenerator(mockLlm);
    const existing = new Set<string>();
    const result = await generator.generateFromNotes("Some text", existing, validationConfig);

    expect(result.valid).toHaveLength(0);
    expect(result.skippedEmpty).toBe(0);
  });

  it("enforces maxCardsPerCall over-limit truncation", async () => {
    const cards = Array.from({ length: 10 }, (_, i) => ({
      front: `Question ${i + 1}`,
      back: `Answer ${i + 1}`,
    }));

    const mockLlm: LlmProvider = {
      name: "mock-llm",
      model: "mock-model",
      isAvailable: vi.fn().mockResolvedValue(true),
      chat: vi.fn().mockResolvedValue(JSON.stringify(cards)),
    };

    const generator = new CardGenerator(mockLlm);
    const result = await generator.generateFromNotes("Notes", new Set(), {
      maxCardsPerCall: 3,
      maxTextLength: 100,
    });

    expect(result.valid).toHaveLength(3);
    expect(result.skippedOverLimit).toBe(7);
  });

  it("filters empty and whitespace cards", async () => {
    const mockLlm: LlmProvider = {
      name: "mock-llm",
      model: "mock-model",
      isAvailable: vi.fn().mockResolvedValue(true),
      chat: vi.fn().mockResolvedValue(
        JSON.stringify([
          { front: "   ", back: "Valid answer" },
          { front: "Valid question", back: "" },
          { front: "Good Q", back: "Good A" },
        ]),
      ),
    };

    const generator = new CardGenerator(mockLlm);
    const result = await generator.generateFromNotes("Notes", new Set(), validationConfig);

    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].front).toBe("Good Q");
    expect(result.skippedEmpty).toBe(2);
  });

  it("deduplicates within batch and against existing deck cards", async () => {
    const existing = new Set<string>(["existing question".toLowerCase()]);
    const mockLlm: LlmProvider = {
      name: "mock-llm",
      model: "mock-model",
      isAvailable: vi.fn().mockResolvedValue(true),
      chat: vi.fn().mockResolvedValue(
        JSON.stringify([
          { front: "Existing Question", back: "Different answer" },
          { front: "New Unique Question", back: "Answer 1" },
          { front: "new unique question", back: "Duplicate in batch" },
        ]),
      ),
    };

    const generator = new CardGenerator(mockLlm);
    const result = await generator.generateFromNotes("Notes", existing, validationConfig);

    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].front).toBe("New Unique Question");
    expect(result.skippedDuplicate).toBe(2);
  });
});

describe("AnswerJudge with mocked LlmProvider", () => {
  it("judges a correct answer and returns valid rating", async () => {
    const mockLlm: LlmProvider = {
      name: "mock-llm",
      model: "mock-model",
      isAvailable: vi.fn().mockResolvedValue(true),
      chat: vi.fn().mockResolvedValue(
        JSON.stringify({ rating: "good", reasoning: "Identified the core concept." }),
      ),
    };

    const judge = new AnswerJudge(mockLlm);
    const result = await judge.judge("What is DNS?", "Domain Name System", "Domain Name System");

    expect(result.fallback).toBe(false);
    expect(result.rating).toBe("good");
    expect(result.reasoning).toContain("Identified the core concept.");
    expect(mockLlm.chat).toHaveBeenCalledTimes(1);
  });

  it("judges a wrong answer as 'again'", async () => {
    const mockLlm: LlmProvider = {
      name: "mock-llm",
      model: "mock-model",
      isAvailable: vi.fn().mockResolvedValue(true),
      chat: vi.fn().mockResolvedValue(
        JSON.stringify({ rating: "again", reasoning: "Incorrect protocol name." }),
      ),
    };

    const judge = new AnswerJudge(mockLlm);
    const result = await judge.judge("What is DNS?", "Domain Name System", "Dynamic Network Server");

    expect(result.fallback).toBe(false);
    expect(result.rating).toBe("again");
  });

  it("retries once on malformed JSON and succeeds on second attempt", async () => {
    const mockChat = vi
      .fn()
      .mockResolvedValueOnce("I think this is a good answer! (not JSON)")
      .mockResolvedValueOnce(
        JSON.stringify({ rating: "easy", reasoning: "Instant recall." }),
      );

    const mockLlm: LlmProvider = {
      name: "mock-llm",
      model: "mock-model",
      isAvailable: vi.fn().mockResolvedValue(true),
      chat: mockChat,
    };

    const judge = new AnswerJudge(mockLlm);
    const result = await judge.judge("What is HTTP?", "Hypertext Transfer Protocol", "Hypertext Transfer Protocol");

    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(result.fallback).toBe(false);
    expect(result.rating).toBe("easy");
  });

  it("falls back safely when retry also fails (never crashes)", async () => {
    const mockChat = vi
      .fn()
      .mockResolvedValueOnce("Invalid response 1")
      .mockResolvedValueOnce("Still invalid response 2");

    const mockLlm: LlmProvider = {
      name: "mock-llm",
      model: "mock-model",
      isAvailable: vi.fn().mockResolvedValue(true),
      chat: mockChat,
    };

    const judge = new AnswerJudge(mockLlm);
    const result = await judge.judge("Front", "Back", "User answer");

    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(result.fallback).toBe(true);
    expect(result.rating).toBeNull();
    expect(result.reasoning).toContain("self-rate");
    expect(result.error).toBe("malformed_output");
  });

  it("falls back safely when LLM throws an error (provider down)", async () => {
    const mockLlm: LlmProvider = {
      name: "mock-llm",
      model: "mock-model",
      isAvailable: vi.fn().mockResolvedValue(false),
      chat: vi.fn().mockRejectedValue(new Error("Connection refused to Ollama")),
    };

    const judge = new AnswerJudge(mockLlm);
    const result = await judge.judge("Front", "Back", "User answer");

    expect(result.fallback).toBe(true);
    expect(result.rating).toBeNull();
    expect(result.error).toBe("provider_unavailable");
  });
});

describe("OllamaLlmProvider fetch behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("checks availability via GET /api/tags", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );

    const provider = new OllamaLlmProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "llama3.2",
    });

    const available = await provider.isAvailable();
    expect(available).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/tags",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns isAvailable false if Ollama returns error or connection fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const provider = new OllamaLlmProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "llama3.2",
    });

    const available = await provider.isAvailable();
    expect(available).toBe(false);
  });

  it("sends chat request with jsonFormat option", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: { role: "assistant", content: "{\"rating\":\"good\"}" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = new OllamaLlmProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "llama3.2",
    });

    const messages: ChatMessage[] = [{ role: "user", content: "Hello" }];
    const content = await provider.chat(messages, { jsonFormat: true });

    expect(content).toBe("{\"rating\":\"good\"}");
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "llama3.2",
          messages: [{ role: "user", content: "Hello" }],
          stream: false,
          format: "json",
        }),
      }),
    );
  });
});
