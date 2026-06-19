// modules/products/calculations/productMargin.ts

export function calculateProductMargin(
    price: number,
    cost: number
  ): number {
    if (!price || price <= 0) return 0;
  
    return ((price - cost) / price) * 100;
  }