import test from "node:test";
import assert from "node:assert/strict";
import { getProductGridClassNames } from "../lib/productGridLayout.ts";

test("compact product grid wraps without horizontal overflow", () => {
  const { gridClassName, itemClassName } = getProductGridClassNames(true);

  assert.match(gridClassName, /\bgrid\b/);
  assert.doesNotMatch(gridClassName, /overflow-x-auto/);
  assert.equal(itemClassName, undefined);
});
