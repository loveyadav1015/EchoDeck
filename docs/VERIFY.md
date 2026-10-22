# VERIFY.md — Items That Need Manual Verification

Every `TODO(VERIFY)` in the codebase is listed here. Before deploying, open the
referenced file in `node_modules` and confirm the API matches what the code assumes.

---

## 1. McpServer Import Path

- **File**: `server/src/mcp/server.ts`
- **What**: `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"`
- **Check**: Open `node_modules/@modelcontextprotocol/sdk/dist/server/mcp.d.ts` (or the
  package's `exports` field in `package.json`) and confirm `McpServer` is the exported
  class name and the path is correct.

## 2. McpServer Constructor Options

- **File**: `server/src/mcp/server.ts`
- **What**: `new McpServer({ name: "echodeck", version: "1.0.0" })`
- **Check**: Confirm the constructor accepts `{ name: string; version: string }`. Look at
  the type definition in `node_modules/@modelcontextprotocol/sdk/dist/server/mcp.d.ts`.

## 3. Tool Registration Signature

- **File**: `server/src/mcp/server.ts`
- **What**: `server.tool(name, description, inputSchemaShape, handler)`
- **Check**: Confirm the signature is `tool(name: string, description: string, schema: Record<string, ZodType>, handler: (args, extra) => Promise<result>)`.
  The schema might need to be a `z.object(...)` instead of a plain object. Check `mcp.d.ts`.

## 4. Tool Result Shape (structuredContent and _meta)

- **File**: `server/src/mcp/server.ts`
- **What**: The tool handler returns `{ content: [...], structuredContent: {...}, _meta: { ui: { resourceUri: "..." } } }`
- **Check**: Confirm `structuredContent` is a valid top-level key in `CallToolResult` (check
  `node_modules/@modelcontextprotocol/sdk/dist/types.d.ts`). Confirm `_meta.ui.resourceUri`
  is the correct path for MCP App UI linking (check ext-apps docs).

## 5. Resource Registration Signature

- **File**: `server/src/mcp/server.ts`
- **What**: `server.resource(name, uri, handler)`
- **Check**: Confirm the method signature. It might be `server.resource(name, uri, metadata, handler)`
  or use a different registration pattern. Check `mcp.d.ts`.

## 6. UI Resource MIME Type

- **File**: `server/src/mcp/server.ts`
- **What**: `mimeType: "text/html"` for the UI resource
- **Check**: The ext-apps package may export a specific MIME type constant like
  `MCP_APP_MIME_TYPE` or require `"application/vnd.mcp.app+html"`. Check
  `node_modules/@modelcontextprotocol/ext-apps/` exports.

## 7. StreamableHTTPServerTransport Import and Constructor

- **File**: `server/src/mcp/transport.ts`
- **What**: `import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"` and `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`
- **Check**: Confirm the class name and import path in
  `node_modules/@modelcontextprotocol/sdk/dist/server/`. Confirm `sessionIdGenerator: undefined`
  is correct for stateless mode (no session tracking).

## 8. Transport handleRequest Method

- **File**: `server/src/mcp/transport.ts`
- **What**: `await transport.handleRequest(req, res)`
- **Check**: The method might be `handle`, `handleRequest`, or `processRequest`. Check the
  transport class's type definition.

## 9. GET/DELETE /mcp Error Response

- **File**: `server/src/mcp/transport.ts`
- **What**: Responding with 405 and a JSON-RPC error body for GET and DELETE
- **Check**: The MCP spec (2025-11-25) Streamable HTTP section may specify a required
  error code or response format for unsupported methods on a stateless server.

## 10. Ext-apps Client SDK

- **File**: `server/ui/src/main.ts`
- **What**: `import { McpClientApp } from "@modelcontextprotocol/ext-apps"` — class name,
  constructor, `onToolResult` callback, and `connect()` method.
- **Check**: Open `node_modules/@modelcontextprotocol/ext-apps/` and check:
  - What classes are exported
  - The constructor signature
  - How to subscribe to tool results (method name, callback signature)
  - How to initialize the connection (connect, start, init)

## 11. Streamable HTTP Required Headers

- **File**: `scripts/smoke-test.sh`
- **What**: `Accept: application/json, text/event-stream`
- **Check**: The MCP spec (2025-11-25) may require specific Accept header values for
  Streamable HTTP requests. Verify against the spec.

---

## How to verify

For each item above:

1. Run `npm install` in `server/`
2. Open the referenced file in `node_modules/`
3. Confirm the API matches, or update the code to match
4. Remove the `TODO(VERIFY)` comment once confirmed
