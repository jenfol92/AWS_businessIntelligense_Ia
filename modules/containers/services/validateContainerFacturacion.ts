import type {
  ContainerRowForBilling,
  FacturacionErrorCode,
  OrdenItemForBillingRow,
} from "../types/containerBilling.types";

export type ValidateFacturacionResult =
  | { ok: true; warnings: string[] }
  | { ok: false; code: FacturacionErrorCode; message: string; details: string[] };

function resolveContainerCost(
  modern: number | null | undefined,
  legacy: number | null | undefined,
): number {
  if (modern != null && modern > 0) return modern;
  if (legacy != null && legacy > 0) return legacy;
  return 0;
}

export function resolveContainerLogisticTotals(container: ContainerRowForBilling) {
  const costeFleteTotal = resolveContainerCost(
    container.costo_flete_total_eur,
    container.flete,
  );
  const gastosLlegadaTotal = resolveContainerCost(
    container.gastos_llegada_puerto_eur,
    container.gastos_llegada_puerto,
  );
  const costeTransitoTotal = container.costo_transito_total_eur ?? 0;
  const comisionBancariaTotal = container.comision_bancaria_eur ?? 0;

  return {
    costeFleteTotal,
    gastosLlegadaTotal,
    costeTransitoTotal,
    comisionBancariaTotal,
    costeTotalLogistico:
      costeFleteTotal + gastosLlegadaTotal + costeTransitoTotal,
  };
}

/** Lote persistido: real del ítem o id de línea si falta (idempotencia). */
export function resolveLoteProductoForCostos(item: OrdenItemForBillingRow): string {
  const lote = item.lote_producto?.trim();
  if (lote) return lote;
  return item.id;
}

export function costosDedupKey(productoId: string, loteStored: string): string {
  return `${productoId}|${loteStored}`;
}

export function validateContainerFacturacion(input: {
  container: ContainerRowForBilling | null;
  orderItems: OrdenItemForBillingRow[];
}): ValidateFacturacionResult {
  const { container, orderItems } = input;
  const details: string[] = [];
  const warnings: string[] = [];

  if (!container) {
    return {
      ok: false,
      code: "container_not_found",
      message: "Contenedor no encontrado",
      details,
    };
  }

  if (orderItems.length === 0) {
    return {
      ok: false,
      code: "container_has_no_orders",
      message: "El contenedor no tiene órdenes o líneas vinculadas",
      details,
    };
  }

  const totals = resolveContainerLogisticTotals(container);
  if (totals.costeTotalLogistico <= 0) {
    return {
      ok: false,
      code: "missing_container_cost_fields",
      message:
        "El contenedor no tiene costes logísticos repartibles (flete, tránsito o gastos llegada puerto)",
      details: [
        `flete=${totals.costeFleteTotal}`,
        `transito=${totals.costeTransitoTotal}`,
        `gastos_llegada=${totals.gastosLlegadaTotal}`,
      ],
    };
  }

  if (totals.comisionBancariaTotal > 0) {
    warnings.push(
      `Comisión bancaria (${totals.comisionBancariaTotal} EUR) no se incluye en costo_unitario_total_eur en esta fase.`,
    );
  }

  let cbmSum = 0;
  for (const item of orderItems) {
    if (!Number.isFinite(item.cantidad) || item.cantidad <= 0) {
      details.push(`item ${item.id}: cantidad inválida`);
      continue;
    }
    const cbm = item.cbm_total ?? 0;
    if (cbm <= 0) {
      details.push(`${item.sku ?? item.producto_id}: cbm_total=0`);
    } else {
      cbmSum += cbm;
    }
    if (item.coste_unitario_eur == null || item.coste_unitario_eur <= 0) {
      details.push(`${item.sku ?? item.producto_id}: sin coste_unitario_eur`);
    }
  }

  if (details.some((d) => d.includes("cantidad"))) {
    return {
      ok: false,
      code: "missing_order_item_quantity",
      message: "Hay líneas con cantidad inválida",
      details,
    };
  }

  if (details.some((d) => d.includes("cbm_total"))) {
    return {
      ok: false,
      code: "missing_cbm_total",
      message: "Hay líneas sin CBM total (> 0)",
      details,
    };
  }

  if (cbmSum <= 0) {
    return {
      ok: false,
      code: "invalid_container_cbm_total",
      message: "CBM total del contenedor es 0",
      details,
    };
  }

  if (details.some((d) => d.includes("coste_unitario_eur"))) {
    return {
      ok: false,
      code: "missing_order_item_unit_cost_eur",
      message: "Hay líneas sin coste unitario EUR congelado en la orden",
      details,
    };
  }

  if (container.estado_costes === "costes_facturados") {
    warnings.push(
      "El contenedor ya estaba en costes_facturados; se actualizarán registros existentes.",
    );
  }

  return { ok: true, warnings };
}
