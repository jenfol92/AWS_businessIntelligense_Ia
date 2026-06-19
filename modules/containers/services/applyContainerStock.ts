import {
  countActiveStockApplied,
  countProductoCostosForContainer,
  countStockDestinos,
  callFnStockAdd,
  fetchAmazonEnviosForContainer,
  fetchContainerForStock,
  fetchOrderItemsForContainer,
  fetchStockDestinosForContainer,
  insertStockAplicadoRows,
} from "../repositories/containerStockRepository";
import type { ApplyContainerStockResult } from "../types/containerStock.types";
import { calculateContainerCbmCostAllocation } from "./calculateContainerCbmCostAllocation";
import { validateStockDestinations } from "./validateStockDestinations";

function normalizeTipoContenedor(tipo: string | null | undefined): "propio" | "agl" | "unknown" {
  const t = String(tipo ?? "").trim().toLowerCase();
  if (t === "propio") return "propio";
  if (t === "agl" || t === "agc" || t === "amazon_agl") return "agl";
  return "unknown";
}

export async function applyContainerStock(
  contenedorId: string,
  options?: { userId?: string | null; includeCostPreview?: boolean },
): Promise<ApplyContainerStockResult> {
  const container = await fetchContainerForStock(contenedorId);
  if (!container) {
    return { triggered: true, applied: false, reason: "container_not_found" };
  }

  const activeLines = await countActiveStockApplied(contenedorId);
  if (activeLines > 0) {
    return { triggered: true, applied: false, reason: "already_applied" };
  }

  const tipo = normalizeTipoContenedor(container.tipo_contenedor);
  const costAllocation = options?.includeCostPreview
    ? await calculateContainerCbmCostAllocation(contenedorId)
    : undefined;

  if (tipo === "agl") {
    const envios = await fetchAmazonEnviosForContainer(contenedorId);
    const warnings: string[] = [
      "Contenedor AGL: el stock FBA lo gestiona Amazon progresivamente.",
      "No se incrementa inventario_paises.stock_fba manualmente.",
    ];
    if (envios.length > 0) {
      warnings.push(
        `${envios.length} envío(s) FBA vinculados en amazon_envios (informativo).`,
      );
    } else {
      warnings.push("Sin envíos amazon_envios vinculados todavía.");
    }

    return {
      triggered: true,
      applied: false,
      reason: "agl_stock_managed_by_amazon",
      warnings,
      costAllocation: costAllocation ?? undefined,
    };
  }

  if (tipo === "unknown") {
    return {
      triggered: true,
      applied: false,
      reason: "unknown_container_type",
      warnings: [
        `tipo_contenedor "${container.tipo_contenedor ?? "null"}" no reconocido. Use propio o agl.`,
      ],
      costAllocation: costAllocation ?? undefined,
    };
  }

  const [destinos, orderItems] = await Promise.all([
    fetchStockDestinosForContainer(contenedorId),
    fetchOrderItemsForContainer(contenedorId),
  ]);

  const validation = validateStockDestinations(destinos, orderItems);
  if (!validation.ok) {
    const reason = validation.errors.includes("missing_stock_destinations")
      ? "missing_stock_destinations"
      : "invalid_stock_destinations";
    return {
      triggered: true,
      applied: false,
      reason,
      warnings: [...validation.warnings, ...validation.errors],
      costAllocation: costAllocation ?? undefined,
    };
  }

  if (orderItems.length === 0) {
    return {
      triggered: true,
      applied: false,
      reason: "no_order_items",
      warnings: ["El contenedor no tiene líneas de pedido vinculadas."],
      costAllocation: costAllocation ?? undefined,
    };
  }

  const traceRows = destinos.map((destino) => ({
    contenedor_id: contenedorId,
    orden_item_id: destino.orden_item_id,
    producto_id: destino.producto_id,
    pais: destino.pais,
    canal: destino.canal,
    cantidad: destino.cantidad,
    fuente: "contenedor_stock_destinos",
    aplicado_by: options?.userId ?? null,
    notas: destino.notas,
  }));

  await insertStockAplicadoRows(traceRows);

  try {
    for (const destino of destinos) {
      await callFnStockAdd({
        productoId: destino.producto_id,
        pais: destino.pais,
        canal: destino.canal,
        cantidad: destino.cantidad,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      triggered: true,
      applied: false,
      reason: "stock_rpc_failed",
      warnings: [
        "Trazabilidad insertada pero fn_stock_add falló. Revisar antes de reintentar.",
        message,
      ],
      costAllocation: costAllocation ?? undefined,
    };
  }

  const totalUnits = destinos.reduce((sum, d) => sum + d.cantidad, 0);

  return {
    triggered: true,
    applied: true,
    summary: {
      linesApplied: destinos.length,
      totalUnits,
    },
    warnings: validation.warnings.length > 0 ? validation.warnings : undefined,
    costAllocation: costAllocation ?? undefined,
  };
}

export async function getContainerStockOperationalStatus(contenedorId: string) {
  const container = await fetchContainerForStock(contenedorId);
  if (!container) return null;

  const [activeStockLines, destinationLines, costRecords] = await Promise.all([
    countActiveStockApplied(contenedorId),
    countStockDestinos(contenedorId),
    countProductoCostosForContainer(contenedorId),
  ]);

  return {
    stockApplied: activeStockLines > 0,
    destinationsDefined: destinationLines > 0,
    costsProrated: costRecords > 0,
    tipoContenedor: container.tipo_contenedor,
    activeStockLines,
    destinationLines,
    costRecords,
  };
}
