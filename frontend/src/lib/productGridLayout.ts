export function getProductGridClassNames(compact: boolean) {
  return {
    gridClassName: compact
      ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      : "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6",
    itemClassName: undefined,
  };
}
