import test from "node:test";
import assert from "node:assert/strict";
import { getChatStepToolPolicy } from "./chatToolPolicy.ts";

test("requires catalog search on the first chat step", () => {
  assert.deepEqual(getChatStepToolPolicy(0), {
    toolChoice: { type: "tool", toolName: "search_products" },
    activeTools: ["search_products"],
  });
});

test("disables tools after search results are available", () => {
  assert.deepEqual(getChatStepToolPolicy(1), {
    toolChoice: "none",
    activeTools: [],
  });
});
