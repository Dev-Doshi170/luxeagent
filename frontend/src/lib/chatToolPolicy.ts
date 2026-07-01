export function getChatStepToolPolicy(stepNumber: number) {
  return {
    toolChoice: "auto" as const,
    activeTools: ["search_products" as const, "check_inventory" as const],
  };
}
