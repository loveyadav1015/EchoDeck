import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { EchoDeckService } from "../src/domain/service.js";
import { Store } from "../src/store/store.js";
import * as fs from "node:fs";
import * as path from "node:path";

describe("MCP Server tools/list and resources/read metadata", () => {
  const testDir = path.resolve(`./test-mcp-data-${process.pid}`);
  const storePath = path.join(testDir, "mcp-test.json");
  let store: Store;
  let service: EchoDeckService;
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeEach(async () => {
    store = new Store(storePath);
    await store.load();
    service = new EchoDeckService(store, {
      tz: "America/New_York",
      demoMode: false,
      maxCardsPerCall: 20,
      maxTextLength: 200,
    });

    const mcpServer = createMcpServer(service);
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.connect(serverTransport),
    ]);
  });

  afterEach(async () => {
    await client.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("tools/list shows _meta.ui.resourceUri on next_card and grade_answer", async () => {
    const { tools } = await client.listTools();
    const nextCardTool = tools.find((t) => t.name === "next_card");
    const gradeAnswerTool = tools.find((t) => t.name === "grade_answer");
    const createDeckTool = tools.find((t) => t.name === "create_deck");
    const getProgressTool = tools.find((t) => t.name === "get_progress");

    expect(nextCardTool).toBeDefined();
    expect((nextCardTool?._meta as any)?.ui?.resourceUri).toBe("ui://echodeck/card.html");

    expect(gradeAnswerTool).toBeDefined();
    expect((gradeAnswerTool?._meta as any)?.ui?.resourceUri).toBe("ui://echodeck/card.html");

    expect((createDeckTool?._meta as any)?.ui).toBeUndefined();
    expect((getProgressTool?._meta as any)?.ui).toBeUndefined();
  });

  it("resources/read returns MIME type text/html;profile=mcp-app", async () => {
    const resource = await client.readResource({ uri: "ui://echodeck/card.html" });
    expect(resource.contents).toHaveLength(1);
    expect(resource.contents[0].mimeType).toBe("text/html;profile=mcp-app");
    expect((resource.contents[0] as any).text).toContain("EchoDeck");
  });
});
