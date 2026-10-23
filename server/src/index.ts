/**
 * Express HTTP server: /health, /mcp, startup logging, graceful shutdown.
 */

import express from "express";
import { loadConfig } from "./config.js";
import { logger, setLogLevel } from "./logger.js";
import { Store } from "./store/store.js";
import { EchoDeckService } from "./domain/service.js";
import { handleMcpPost, handleMcpMethodNotAllowed } from "./mcp/transport.js";
import { loadUiHtml } from "./mcp/ui-resource.js";
import { OllamaLlmProvider } from "./local/ollama-llm.js";
import { WhisperSttProvider } from "./local/whisper-stt.js";
import { PiperTtsProvider } from "./local/piper-tts.js";
import { LocalController } from "./local/local-controller.js";
import { createLocalApiRouter } from "./routes/local-api.js";

const MAX_BODY_SIZE = "1mb";

async function main(): Promise<void> {
  // ── Config ────────────────────────────────────────────
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // Config errors are fatal
    console.error(
      `[STARTUP ERROR] ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  setLogLevel(config.logLevel);

  // ── Store ─────────────────────────────────────────────
  const store = new Store(config.dataFile);
  await store.load();

  // ── Service ───────────────────────────────────────────
  const service = new EchoDeckService(store, {
    tz: config.tz,
    demoMode: config.demoMode,
    maxCardsPerCall: config.maxCardsPerCall,
    maxTextLength: config.maxTextLength,
  });

  // ── Express ───────────────────────────────────────────
  const app = express();
  app.use(express.json({ limit: MAX_BODY_SIZE }));

  // Disable x-powered-by header
  app.disable("x-powered-by");

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // ── Local Mode Setup ──────────────────────────────────
  let localController: LocalController | undefined;
  if (config.mode === "local" || config.mode === "both") {
    const llm = new OllamaLlmProvider({
      baseUrl: config.ollamaUrl,
      model: config.ollamaModel,
    });
    const stt = new WhisperSttProvider({ baseUrl: config.sttUrl });
    const tts = new PiperTtsProvider({ baseUrl: config.ttsUrl });

    localController = new LocalController({
      service,
      store,
      llm,
      stt,
      tts,
      maxCardsPerCall: config.maxCardsPerCall,
      maxTextLength: config.maxTextLength,
    });

    app.use("/api", createLocalApiRouter(localController));

    // Serve interactive card UI for local browser use
    const serveUi = (_req: express.Request, res: express.Response) => {
      const html = loadUiHtml();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    };

    app.get("/", serveUi);
    app.get("/app", serveUi);
    app.get("/card.html", serveUi);
  }

  // ── MCP Endpoint ──────────────────────────────────────
  const mcpOptions = localController ? { localController } : undefined;
  app.post("/mcp", (req, res) => {
    handleMcpPost(req, res, service, mcpOptions).catch((err) => {
      logger.error("Unhandled MCP error", {
        error: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    });
  });

  // GET /mcp and DELETE /mcp return 405
  app.get("/mcp", handleMcpMethodNotAllowed);
  app.delete("/mcp", handleMcpMethodNotAllowed);

  // ── Start ─────────────────────────────────────────────
  const server = app.listen(config.port, config.host, () => {
    logger.info("EchoDeck server started", {
      mode: config.mode,
      host: config.host,
      port: config.port,
      dataFile: config.dataFile,
      demoMode: config.demoMode,
      timezone: config.tz,
      logLevel: config.logLevel,
    });
  });

  // ── Graceful shutdown ─────────────────────────────────
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close(async () => {
      await store.waitForWrites();
      logger.info("Server closed");
      process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
      logger.warn("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Prevent crashes from unhandled errors
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", {
      error: err.message,
      stack: err.stack,
    });
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", {
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });
}

main().catch((err) => {
  console.error(
    `[FATAL] ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
