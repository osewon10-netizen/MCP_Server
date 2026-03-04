import assert from "node:assert/strict";
import test from "node:test";
import { getRegisteredToolNames } from "../../build/server.js";
import { listToolNames } from "./helpers.mjs";

test("tools/list returns all registered tools with no duplicates", async () => {
  const registeredNames = getRegisteredToolNames();
  const listedNames = await listToolNames();

  assert.equal(new Set(registeredNames).size, registeredNames.length, "duplicate tool names in registry");
  assert.equal(new Set(listedNames).size, listedNames.length, "duplicate tool names in tools/list");
  assert.deepEqual([...listedNames].sort(), [...registeredNames].sort());
});
