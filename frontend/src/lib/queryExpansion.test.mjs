import assert from "node:assert/strict";
import test from "node:test";

import { expandQuery, tokenize } from "./queryExpansion.ts";

test("expandQuery adds conservative fashion synonyms", () => {
  const expanded = expandQuery("luxury handbag");

  assert.match(expanded, /luxury handbag/);
  assert.match(expanded, /designer/);
  assert.match(expanded, /premium/);
  assert.match(expanded, /leather handbag/);
  assert.match(expanded, /purse/);
});

test("tokenize normalizes punctuation and case", () => {
  assert.deepEqual(tokenize("Premium Navy-Blue Men's T-Shirt!"), [
    "premium",
    "navy",
    "blue",
    "men",
    "s",
    "t",
    "shirt",
  ]);
});
