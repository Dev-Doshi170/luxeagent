import test from "node:test";
import assert from "node:assert/strict";
import { shouldRenderAssistantText } from "./messageText.ts";

test("does not render serialized product payloads after product cards", () => {
  const rawPayload =
    '[{"id":3028,"name":"Vintage Men Striped Casual Shirt","image_url":"/images/3028.jpg","final_score":0.72}]';

  assert.equal(shouldRenderAssistantText(rawPayload, true), false);
});

test("renders normal assistant copy after product cards", () => {
  const response = "I found a few polished shirt options that match your brief.";

  assert.equal(shouldRenderAssistantText(response, true), true);
});
