const RAW_PRODUCT_PAYLOAD_PATTERNS = [
  /"image_url"\s*:/i,
  /\bimage_url\b/i,
  /"final_score"\s*:/i,
  /"semantic_score"\s*:/i,
  /"keyword_score"\s*:/i,
  /\/images\/[^\s"'`]+/i,
];

export function shouldRenderAssistantText(text: string, hasRenderedToolOutput: boolean) {
  const normalized = text.trim();

  if (!normalized) {
    return false;
  }

  if (!hasRenderedToolOutput) {
    return true;
  }

  const startsLikeSerializedData = normalized.startsWith("[") || normalized.startsWith("{");
  const containsProductPayload = RAW_PRODUCT_PAYLOAD_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );

  return !(startsLikeSerializedData && containsProductPayload);
}
