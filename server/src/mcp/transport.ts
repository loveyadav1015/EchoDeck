/**
 * Streamable HTTP transport handling for MCP.
 * All SDK transport imports are isolated here.
 */

import type { Request, Response } from "express";

// TODO(VERIFY): import path for StreamableHTTPServerTransport. Check:
// node_modules/@modelcontextprotocol/sdk/dist/server/streamableHttp.d.ts
// The class name might also be StreamableHTTPTransport or HttpServerTransport.
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createMcpServer } from "./server.js";
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
): Promise<void> {
  try {
    const server = createMcpServer(service);

    // TODO(VERIFY): StreamableHTTPServerTransport constructor options.
    // Confirm the option name for stateless mode. It may be `sessionIdGenerator` set to
    // undefined or `stateless: true` or something else entirely.
    // Check node_modules/@modelcontextprotocol/sdk/dist/server/streamableHttp.d.ts
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);

    // TODO(VERIFY): confirm that transport.handleRequest(req, res) is the correct method
    // to hand off the Express request/response to the transport. The method might be
    // called handleRequest, handle, or processRequest.
    // Check node_modules/@modelcontextprotocol/sdk/dist/server/streamableHttp.d.ts
    await transport.handleRequest(req, res);
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
 * that does not support GET (SSE) or DELETE (session teardown). Check MCP spec
 * 2025-11-25 section on Streamable HTTP for required error codes.
 */
export function handleMcpMethodNotAllowed(_req: Request, res: Response): void {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "This server operates in stateless mode. Only POST /mcp is supported.",
    },
    id: null,
  });
}
