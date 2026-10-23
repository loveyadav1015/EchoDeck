/**
 * Streamable HTTP transport handling for MCP.
 * All SDK transport imports are isolated here.
 */

import type { Request, Response } from "express";

// TODO(VERIFY): import path for StreamableHTTPServerTransport. Check:
// node_modules/@modelcontextprotocol/sdk/dist/**/server/streamableHttp.d.ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createMcpServer, type McpServerOptions } from "./server.js";
import type { EchoDeckService } from "../domain/service.js";
import { logger } from "../logger.js";

/**
 * Handle a POST /mcp request using stateless Streamable HTTP.
 * Each request gets a fresh McpServer + transport (shared store via service).
 */
export async function handleMcpPost(
  req: Request,
  res: Response,
  service: EchoDeckService,
  options?: McpServerOptions,
): Promise<void> {
  try {
    const server = createMcpServer(service, options);

    // TODO(VERIFY): constructor option for stateless mode.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    // Release the per-request server and transport once the response is done.
    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);

    // express.json() has already consumed the request stream, so the parsed
    // body must be passed in explicitly.
    // TODO(VERIFY): confirm the third argument is the parsed body in the
    // installed SDK (check handleRequest in streamableHttp.d.ts).
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error("MCP POST handler error", {
      error: err instanceof Error ? err.message : String(err),
    });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
}

/**
 * Handle GET /mcp and DELETE /mcp with a 405 for stateless mode.
 * TODO(VERIFY): confirm the appropriate error response for a stateless server
 * against the MCP Streamable HTTP specification.
 */
export function handleMcpMethodNotAllowed(_req: Request, res: Response): void {
  res.setHeader("Allow", "POST");
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "This server operates in stateless mode. Only POST /mcp is supported.",
    },
    id: null,
  });
}