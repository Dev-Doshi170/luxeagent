export interface ProductInventory {
  S: number;
  M: number;
  L: number;
  XL: number;
}

/**
 * Deterministically generates inventory levels for a product based on its ID.
 * This guarantees consistent results for checking the same product.
 */
export function getProductInventory(productId: number): ProductInventory {
  // Use modulo arithmetic on the ID to generate repeatable stock levels
  const sStock = productId % 5; // 0 to 4 items
  const mStock = productId % 4; // 0 to 3 items
  const lStock = (productId + 1) % 3; // 0 to 2 items
  const xlStock = (productId + 2) % 6; // 0 to 5 items

  return {
    S: sStock,
    M: mStock,
    L: lStock,
    XL: xlStock,
  };
}

/**
 * Checks if a specific size is in stock for a product.
 */
export function checkSizeStock(productId: number, size: keyof ProductInventory): boolean {
  const inventory = getProductInventory(productId);
  return (inventory[size] ?? 0) > 0;
}
