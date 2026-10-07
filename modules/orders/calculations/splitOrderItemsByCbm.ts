type SplitItem = { _key: string; cantidad: number; cbm_unitario: number };

/** Reparte unidades enteras sin alterar costes ni otros datos de las líneas. */
export function splitOrderItemsByCbm<T extends SplitItem>(items: T[], limit: number): T[][] {
  if (!Number.isFinite(limit) || limit <= 0) throw new Error("Indica un límite de m³ mayor que cero.");
  for (const item of items) {
    if (!Number.isSafeInteger(item.cantidad) || item.cantidad <= 0) {
      throw new Error("Las cantidades deben ser unidades enteras mayores que cero.");
    }
    if (!Number.isFinite(item.cbm_unitario) || item.cbm_unitario <= 0) {
      throw new Error("Todos los productos deben tener cubicaje unitario mayor que cero para dividir la orden.");
    }
    if (item.cbm_unitario > limit) throw new Error("Una unidad de producto supera el límite de m³ indicado.");
  }
  const groups: T[][] = [];
  const volumes: number[] = [];
  for (const item of items) {
    let remaining = item.cantidad;
    for (let index = 0; remaining > 0; index++) {
      if (!groups[index]) { groups[index] = []; volumes[index] = 0; }
      const available = Math.max(0, limit - volumes[index]);
      const ratio = available / item.cbm_unitario;
      let capacity = Math.floor(ratio + Number.EPSILON * Math.max(1, ratio) * 8);
      if (capacity * item.cbm_unitario > available + Number.EPSILON * Math.max(1, limit) * 8) capacity--;
      const quantity = Math.min(remaining, capacity);
      if (quantity <= 0) continue;
      groups[index].push({ ...item, cantidad: quantity });
      volumes[index] += quantity * item.cbm_unitario;
      remaining -= quantity;
    }
  }
  return groups;
}

/** Reúne fragmentos de la misma línea al deshacer o mover el reparto. */
export function mergeSplitOrderItems<T extends SplitItem>(items: T[]): T[] {
  const merged = new Map<string, T>();
  for (const item of items) {
    const previous = merged.get(item._key);
    merged.set(item._key, previous ? { ...previous, cantidad: previous.cantidad + item.cantidad } : { ...item });
  }
  return Array.from(merged.values());
}
