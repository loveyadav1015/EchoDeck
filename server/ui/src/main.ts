/**
 * EchoDeck UI client logic.
 * Uses the ext-apps client SDK to receive tool results from the MCP server.
 *
 * All ext-apps SDK usage is isolated in this file.
 * Uses textContent (never innerHTML) to prevent XSS.
 * Missing fields never render as "undefined".
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

// ── State rendering ─────────────────────────────────────

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
  newBox?: number;
  nextReview?: string;
  cardsLeft?: number;
}

function safe(val: unknown): string {
  if (val == null) return "";
  return String(val);
}

/**
 * State A: next_card returned a card — show front only.
 */
function renderFrontOnly(data: ToolData): void {
  hide("done-container");
  hide("error-container");
  show("card-container");

  // Progress
  const pos = data.position ?? 0;
  const total = data.total ?? 0;
  setText("progress-label", total > 0 ? `Card ${pos} of ${total}` : "");
  const streak = data.streak ?? 0;
  setText("streak-label", streak > 0 ? `${streak} day streak` : "");

  // Front
  show("front-section");
  setText("front-text", safe(data.front));

  // Hide back and rating
  hide("back-section");
  hide("rating-section");
}

/**
 * State B: grade_answer — show front, back, rating, and next review.
 */
function renderGraded(data: ToolData): void {
  hide("done-container");
  hide("error-container");
  show("card-container");

  // Progress — keep whatever is showing or hide
  setText("progress-label", "");
  const streak = data.streak ?? 0;
  setText("streak-label", streak > 0 ? `${streak} day streak` : "");

  // Front
  show("front-section");
  setText("front-text", safe(data.front));

  // Back
  show("back-section");
  setText("back-text", safe(data.back));

  // Rating info
  show("rating-section");
  const ratingLabel = $(  "rating-label");
  const ratingText = safe(data.rating).toUpperCase();
  ratingLabel.textContent = ratingText ? `Rated: ${ratingText}` : "";
  // Set color class
  ratingLabel.className = "";
  if (data.rating) {
    ratingLabel.classList.add(data.rating);
  }

  setText("next-review", data.nextReview ? `Next review: ${data.nextReview}` : "");
  const left = data.cardsLeft ?? 0;
  setText("cards-left", `${left} card${left === 1 ? "" : "s"} left`);
}

/**
 * State C: done — all caught up.
 */
function renderDone(data: ToolData): void {
  hide("card-container");
  hide("error-container");
  show("done-container");

  setText("done-message", safe(data.message) || "All caught up!");
  const streak = data.streak ?? 0;
  setText("done-streak", streak > 0 ? `${streak} day streak` : "");
}

/**
 * State D: error.
 */
function renderError(message: string): void {
  hide("card-container");
  hide("done-container");
  show("error-container");

  setText("error-message", message || "Something went wrong.");
}

// ── Determine which state to render from tool result ─────

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

  // Unknown tool — just show message if any
  if (data.message) {
    renderDone(data);
  }
}

// ── Ext-apps client connection ──────────────────────────

// TODO(VERIFY): the correct import path and class name for the ext-apps client.
// Check node_modules/@modelcontextprotocol/ext-apps for the actual export.
// It might be: import { McpClientApp } from "@modelcontextprotocol/ext-apps/client"
// or: import { ExtAppClient } from "@modelcontextprotocol/ext-apps"
// or something else entirely.

// TODO(VERIFY): the constructor, connect method, and tool-result callback registration.
// The API might look like:
//   const app = new McpClientApp();
//   app.onToolResult((toolName, result) => { ... });
//   await app.connect();
// or it might use addEventListener, or a different pattern.

// For now, use a safe pattern that tries to load the client and falls back gracefully.
async function initExtAppsClient(): Promise<void> {
  try {
    // Dynamic import so build does not fail if the package is missing during dev
    // TODO(VERIFY): replace this with the correct static import once the ext-apps
    // API is confirmed. The import path below is a best guess.
    const extApps = await import("@modelcontextprotocol/ext-apps");

    // TODO(VERIFY): the class name — could be McpClientApp, ExtAppClient, or Client
    const ClientClass = extApps.McpClientApp ?? extApps.ExtAppClient ?? extApps.default;

    if (!ClientClass) {
      console.warn("ext-apps client class not found in module exports");
      return;
    }

    const client = new ClientClass();

    // TODO(VERIFY): the method name for subscribing to tool results.
    // Might be onToolResult, on("tool_result", ...), addEventListener, etc.
    if (typeof client.onToolResult === "function") {
      client.onToolResult((toolName: string, result: { structuredContent?: ToolData }) => {
        const data = result.structuredContent ?? {};
        renderToolResult(toolName, data as ToolData);
      });
    } else if (typeof client.on === "function") {
      client.on("tool_result", (event: { toolName: string; result: { structuredContent?: ToolData } }) => {
        const data = event.result.structuredContent ?? {};
        renderToolResult(event.toolName, data as ToolData);
      });
    }

    // TODO(VERIFY): the connect/start method name. Might be connect(), start(), init().
    if (typeof client.connect === "function") {
      await client.connect();
    } else if (typeof client.start === "function") {
      await client.start();
    }
  } catch (err) {
    console.warn("ext-apps client not available:", err);
    // In development without the ext-apps client, show a placeholder
    renderError("Waiting for Alexa to connect...");
  }
}

// ── Bootstrap ────────────────────────────────────────────

initExtAppsClient();
