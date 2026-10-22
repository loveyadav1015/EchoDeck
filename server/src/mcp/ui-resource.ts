/**
 * Loads the built UI HTML and exposes it for the MCP resource handler.
 * All ext-apps references are isolated here and in the UI client file.
 */

import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { logger } from "../logger.js";

const DIST_UI_PATH = fileURLToPath(
  new URL("../../dist-ui/card.html", import.meta.url),
);

const FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>EchoDeck</title></head>
<body style="display:flex;align-items:center;justify-content:center;height:100vh;background:#1a1a2e;color:#e0e0e0;font-family:sans-serif;">
<p>The EchoDeck UI has not been built yet. Run <code>npm run build:ui</code> in the server directory.</p>
</body>
</html>`;

let cachedHtml: string | null = null;

/**
 * Load the built UI HTML file. Call this at startup.
 * If the file does not exist, log a clear error and use the fallback.
 */
export function loadUiHtml(): string {
  if (cachedHtml !== null) {
    return cachedHtml;
  }

  try {
    if (!fs.existsSync(DIST_UI_PATH)) {
      logger.error(
        "Built UI file not found. Run 'npm run build:ui' to build the UI.",
        { expected: DIST_UI_PATH },
      );
      cachedHtml = FALLBACK_HTML;
      return cachedHtml;
    }

    cachedHtml = fs.readFileSync(DIST_UI_PATH, "utf-8");
    logger.info("Loaded UI HTML", { path: DIST_UI_PATH, size: cachedHtml.length });
    return cachedHtml;
  } catch (err) {
    logger.error("Failed to read built UI file", {
      path: DIST_UI_PATH,
      error: err instanceof Error ? err.message : String(err),
    });
    cachedHtml = FALLBACK_HTML;
    return cachedHtml;
  }
}

/**
 * Reset the cache (for testing).
 */
export function resetUiCache(): void {
  cachedHtml = null;
}
