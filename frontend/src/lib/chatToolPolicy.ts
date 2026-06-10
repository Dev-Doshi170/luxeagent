export function getChatStepToolPolicy(stepNumber: number) {
  if (stepNumber === 0) {
    return {
      toolChoice: { type: "tool" as const, toolName: "search_products" as const },
      activeTools: ["search_products" as const],
    };
  }

  return {
    toolChoice: "none" as const,
    activeTools: [],
  };
}
