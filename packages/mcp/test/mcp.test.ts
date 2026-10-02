import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultToolRegistry } from "@massefelt/tools";
import { createMassefeltMcpServer } from "../src";
import { createFakeData, PROJECT_ID } from "../../tools/test/fake-data";

describe("MCP server", () => {
  it("lists and calls the same tools as the in-app assistant", async () => {
    const server = createMassefeltMcpServer({
      registry: createDefaultToolRegistry(),
      getContext: () => ({
        projectId: PROJECT_ID,
        userId: "u",
        selection: { scanId: null, measurementId: null, objectIds: [] },
        data: createFakeData(),
      }),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["listScans", "getMeasurement", "measureDistance"]));

    const res = await client.callTool({ name: "listScans", arguments: {} });
    expect(res.isError).toBe(false);
    expect(JSON.parse((res.content as { text: string }[])[0]!.text)).toMatchObject({ count: 1 });

    const bad = await client.callTool({ name: "measureDistance", arguments: { from: "nope" } });
    expect(bad.isError).toBe(true);
    await client.close();
  });
});
