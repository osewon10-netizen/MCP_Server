import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../build/server.js";

export async function withMcpClient(config, run) {
  const server = createServer(config);
  const client = new Client({ name: "contract-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    return await run(client);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

export async function listToolNames(config) {
  return withMcpClient(config, async (client) => {
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name);
  });
}
