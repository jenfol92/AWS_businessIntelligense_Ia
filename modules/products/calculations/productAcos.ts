// modules/products/calculations/productAcos.ts

export function calculateProductAcos(
    adSpend: number,
    sales: number
  ): number {
    if (!sales || sales <= 0) return 0;
  
    return (adSpend / sales) * 100;
  }