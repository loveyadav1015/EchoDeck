/**
 * EchoDeck UI client logic.
 *
 * Supports two modes:
 * 1. Ext-apps mode: Used when running inside Alexa+ / Echo Show via MCP client.
 * 2. Local browser mode: Standalone interactive UI for offline open-model study,
 *    voice/text answering, and local LLM flashcard generation.
 *
 * Uses textContent (never innerHTML) to prevent XSS.
 * Answer-leak rule: card back is NEVER rendered before answer submission.
 */

import "./styles.css";

// ── DOM helpers ──────────────────────────────────────────

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}

function setText(id: string, value: unknown): void {
  const el = $(id);
  el.textContent = value != null ? String(value) : "";
}

function show(id: string): void {
  $(id).classList.remove("hidden");
}

function hide(id: string): void {
  $(id).classList.add("hidden");
}

function safe(val: unknown): string {
  if (val == null) return "";
  return String(val);
}

// ── Types ────────────────────────────────────────────────

interface ToolData {
  done?: boolean;
  cardId?: string;
  deckName?: string;
  front?: string;
  back?: string;
  position?: number;
  total?: number;
  dueCount?: number;
  streak?: number;
  message?: string;
  error?: string;
  rating?: string;
  reasoning?: string;
  newBox?: number;
  nextReview?: string;
  cardsLeft?: number;
  fallback?: boolean;
}

// ── Shared State Rendering ──────────────────────────────

let currentCardId: string | null = null;
let currentFrontText: string = "";

function renderFrontOnly(data: ToolData): void {
  hide("done-container");
  hide("error-container");
  hide("generator-container");
  show("card-container");

  currentCardId = data.cardId ?? null;
  currentFrontText = data.front ?? "";

  // Progress
  const pos = data.position ?? 0;
  const total = data.total ?? 0;
  setText("progress-label", total > 0 ? `Card ${pos} of ${total}` : "");
  const streak = data.streak ?? 0;
  setText("streak-label", streak > 0 ? `${streak} day streak` : "");
  const headerStreak = document.getElementById("header-streak");
  if (headerStreak) headerStreak.textContent = `${streak} day streak`;

  // Front
  show("front-section");
  setText("front-text", safe(data.front));

  // Answer-leak rule: Hide back and rating
  hide("back-section");
  hide("rating-section");
}

function renderGraded(data: ToolData): void {
  hide("done-container");
  hide("error-container");
  hide("generator-container");
  show("card-container");

  // Keep front visible
  show("front-section");
  if (data.front) {
    setText("front-text", safe(data.front));
  }

  // Reveal back only after answer has been processed
  show("back-section");
  setText("back-text", safe(data.back));

  // Rating info
  show("rating-section");
  const ratingLabel = $("rating-label");
  const ratingText = safe(data.rating).toUpperCase();
  ratingLabel.textContent = ratingText ? `Rated: ${ratingText}` : "";
  ratingLabel.className = "";
  if (data.rating) {
    ratingLabel.classList.add(data.rating);
  }

  const reasoningEl = document.getElementById("rating-reasoning");
  if (reasoningEl) {
    reasoningEl.textContent = data.reasoning ? `"${data.reasoning}"` : "";
  }

  setText("next-review", data.nextReview ? `Next review: ${data.nextReview}` : "");
  const left = data.cardsLeft ?? 0;
  setText("cards-left", `${left} card${left === 1 ? "" : "s"} left`);

  const streak = data.streak ?? 0;
  setText("streak-label", streak > 0 ? `${streak} day streak` : "");
  const headerStreak = document.getElementById("header-streak");
  if (headerStreak) headerStreak.textContent = `${streak} day streak`;
}

function renderDone(data: ToolData): void {
  hide("card-container");
  hide("error-container");
  hide("generator-container");
  show("done-container");

  setText("done-message", safe(data.message) || "All caught up!");
  const streak = data.streak ?? 0;
  setText("done-streak", streak > 0 ? `${streak} day streak` : "");
  const headerStreak = document.getElementById("header-streak");
  if (headerStreak) headerStreak.textContent = `${streak} day streak`;
}

function renderError(message: string): void {
  hide("card-container");
  hide("done-container");
  hide("generator-container");
  show("error-container");

  setText("error-message", message || "Something went wrong.");
}

function renderToolResult(toolName: string, data: ToolData): void {
  if (data.error && toolName !== "grade_answer") {
    renderError(safe(data.message) || safe(data.error));
    return;
  }

  if (toolName === "next_card") {
    if (data.done) {
      renderDone(data);
    } else {
      renderFrontOnly(data);
    }
    return;
  }

  if (toolName === "grade_answer") {
    if (data.error) {
      renderError(safe(data.message) || "Could not grade that card.");
    } else {
      renderGraded(data);
    }
    return;
  }

  if (data.message) {
    renderDone(data);
  }
}

// ── Local Mode Web App Controller ────────────────────────

async function initLocalApp(): Promise<void> {
  // Show header and local study controls
  show("local-header");
  show("speak-question-btn");
  show("local-input-section");
  show("done-actions");

  // Tab switching
  const tabStudy = $("tab-study");
  const tabCreate = $("tab-create");

  tabStudy.addEventListener("click", () => {
    tabStudy.classList.add("active");
    tabCreate.classList.remove("active");
    hide("generator-container");
    loadNextCard();
  });

  tabCreate.addEventListener("click", () => {
    tabCreate.classList.add("active");
    tabStudy.classList.remove("active");
    hide("card-container");
    hide("done-container");
    hide("error-container");
    show("generator-container");
  });

  const restartStudyBtn = document.getElementById("restart-study-btn");
  if (restartStudyBtn) {
    restartStudyBtn.addEventListener("click", () => loadNextCard());
  }

  const startAfterGenBtn = document.getElementById("start-after-generate-btn");
  if (startAfterGenBtn) {
    startAfterGenBtn.addEventListener("click", () => {
      tabStudy.click();
    });
  }

  // Speak question (TTS)
  const speakBtn = $("speak-question-btn");
  speakBtn.addEventListener("click", () => speakText(currentFrontText));

  // Voice recognition (STT)
  setupSpeechRecognition();

  // Submit Answer
  const submitBtn = $("submit-answer-btn");
  const answerInput = $("answer-input") as HTMLInputElement;

  const handleSubmit = async () => {
    const answer = answerInput.value.trim();
    if (!currentCardId) return;

    show("judge-loading");
    hide("fallback-rating-buttons");
    hide("next-card-actions");

    try {
      const res = await fetch("/api/study/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: currentCardId, answer }),
      });

      const data = (await res.json()) as ToolData;
      hide("judge-loading");

      if (data.fallback) {
        // Fallback to self-rating
        show("back-section");
        setText("back-text", safe(data.back));
        show("rating-section");
        setText("rating-label", "AI Evaluation Failed");
        const reasonEl = document.getElementById("rating-reasoning");
        if (reasonEl) reasonEl.textContent = data.reasoning || "Please self-rate your answer.";
        show("fallback-rating-buttons");
      } else {
        renderGraded(data);
        show("next-card-actions");
      }
    } catch {
      hide("judge-loading");
      show("fallback-rating-buttons");
    }
  };

  submitBtn.addEventListener("click", handleSubmit);
  answerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      handleSubmit();
    }
  });

  // Next card button
  const nextCardBtn = document.getElementById("next-card-btn");
  if (nextCardBtn) {
    nextCardBtn.addEventListener("click", () => {
      answerInput.value = "";
      loadNextCard();
    });
  }

  // Fallback rating buttons
  document.querySelectorAll(".rate-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const rating = (e.currentTarget as HTMLElement).getAttribute("data-rating");
      if (!currentCardId || !rating) return;

      try {
        const res = await fetch("/api/study/self-grade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId: currentCardId, rating }),
        });
        const data = (await res.json()) as ToolData;
        hide("fallback-rating-buttons");
        renderGraded(data);
        show("next-card-actions");
      } catch (err) {
        alert("Failed to record rating: " + String(err));
      }
    });
  });

  // Deck Generator
  const generateBtn = $("generate-btn");
  generateBtn.addEventListener("click", async () => {
    const deckNameInput = $("deck-name-input") as HTMLInputElement;
    const notesInput = $("notes-input") as HTMLTextAreaElement;
    const statusEl = $("generate-status");

    const deckName = deckNameInput.value.trim();
    const notes = notesInput.value.trim();

    if (!deckName || !notes) {
      statusEl.textContent = "Please enter both a deck name and notes.";
      show("generate-status");
      return;
    }

    statusEl.textContent = "Generating flashcards using local model... this may take a moment.";
    show("generate-status");
    generateBtn.setAttribute("disabled", "true");

    try {
      const res = await fetch("/api/generate-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckName, notes }),
      });
      const data = await res.json();
      generateBtn.removeAttribute("disabled");

      if (data.error) {
        statusEl.textContent = `Error: ${data.message || data.error}`;
      } else {
        statusEl.textContent = `Success! ${data.message}`;
        show("generator-actions");
      }
    } catch (err) {
      generateBtn.removeAttribute("disabled");
      statusEl.textContent = "Failed to communicate with local server: " + String(err);
    }
  });

  // Initial load
  await loadNextCard();
}

async function loadNextCard(): Promise<void> {
  const answerInput = document.getElementById("answer-input") as HTMLInputElement | null;
  if (answerInput) answerInput.value = "";
  hide("judge-loading");
  hide("fallback-rating-buttons");
  hide("next-card-actions");

  try {
    const res = await fetch("/api/study/next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = (await res.json()) as ToolData;
    if (data.done) {
      renderDone(data);
    } else {
      renderFrontOnly(data);
    }
  } catch {
    renderError("Could not reach local server. Is it running?");
  }
}

async function speakText(text: string): Promise<void> {
  if (!text) return;

  // Try local Piper TTS endpoint first
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      await audio.play();
      return;
    }
  } catch {
    // Fall through to browser speech synthesis
  }

  // Graceful browser fallback
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  }
}

function setupSpeechRecognition(): void {
  const micBtn = document.getElementById("mic-btn");
  const answerInput = document.getElementById("answer-input") as HTMLInputElement | null;
  if (!micBtn || !answerInput) return;

  // Check browser SpeechRecognition or webkitSpeechRecognition
  const SpeechRec =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  if (SpeechRec) {
    const recognition = new SpeechRec();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    let isListening = false;

    recognition.onstart = () => {
      isListening = true;
      micBtn.classList.add("recording");
    };

    recognition.onend = () => {
      isListening = false;
      micBtn.classList.remove("recording");
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) {
        answerInput.value = transcript;
      }
    };

    micBtn.addEventListener("click", () => {
      if (isListening) {
        recognition.stop();
      } else {
        recognition.start();
      }
    });
  } else {
    micBtn.title = "Microphone input not supported by this browser";
    micBtn.style.opacity = "0.5";
  }
}

// ── Ext-Apps Connection ──────────────────────────────────

async function initExtAppsClient(): Promise<boolean> {
  // If running in an iframe with MCP parent
  if (window.self === window.top) {
    return false;
  }

  try {
    const extApps = await import("@modelcontextprotocol/ext-apps");
    const ClientClass = extApps.McpClientApp ?? (extApps as any).ExtAppClient ?? extApps.default;
    if (!ClientClass) return false;

    const client = new ClientClass();

    if (typeof client.onToolResult === "function") {
      client.onToolResult((toolName: string, result: { structuredContent?: ToolData }) => {
        const data = result.structuredContent ?? {};
        renderToolResult(toolName, data as ToolData);
      });
    }

    if (typeof client.connect === "function") {
      await client.connect();
      return true;
    }
  } catch {
    // Ext-apps not available
  }
  return false;
}

// ── Bootstrap ────────────────────────────────────────────

async function bootstrap() {
  const isExtApp = await initExtAppsClient();
  if (!isExtApp) {
    // Standalone browser mode
    initLocalApp();
  }
}

bootstrap();
