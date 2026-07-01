import test from "node:test";
import assert from "node:assert/strict";
import { getChatStepToolPolicy } from "./chatToolPolicy.ts";

test("allows all tools to be chosen dynamically at any step", () => {
  const expectedPolicy = {
    toolChoice: "auto",
    activeTools: ["search_products", "check_inventory"],
  };
  assert.deepEqual(getChatStepToolPolicy(0), expectedPolicy);
  assert.deepEqual(getChatStepToolPolicy(1), expectedPolicy);
});
