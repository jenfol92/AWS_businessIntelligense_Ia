export type ArrivalProductLine = {
  label: string;
  quantity: number | null;
};

type ProductRelation =
  | { sku: string | null; nombre: string | null }
  | Array<{ sku: string | null; nombre: string | null }>
  | null;

type ItemRow = {
  cantidad: number | null;
  productos: ProductRelation;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function buildArrivalProductLines(items: ItemRow[]): ArrivalProductLine[] {
  return items.map((item) => {
    const product = firstRelation(item.productos);
    return {
      label: product?.nombre || product?.sku || "Producto",
      quantity: item.cantidad,
    };
  });
}

export function buildArrivalProductSummary(lines: ArrivalProductLine[]): string {
  if (lines.length === 0) return "Sin productos";
  const parts = lines.slice(0, 2).map((line) => {
    const qty = line.quantity ? ` x${line.quantity}` : "";
    return `${line.label}${qty}`;
  });
  const extra = lines.length > 2 ? ` +${lines.length - 2} más` : "";
  return `${parts.join(", ")}${extra}`;
}
