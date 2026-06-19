/**
 * Factura/cierre de costes del contenedor: reparto CBM → producto_costos.
 * NO aplica stock ni toca inventario_paises.
 */

import { syncLegacyEstadoFromSeparated } from "../utils/resolveContainerEstados";
import { calculateCbmCostAllocationFromData } from "./calculateContainerCbmCostAllocation";
import {
  costosDedupKey,
  resolveContainerLogisticTotals,
  resolveLoteProductoForCostos,
  validateContainerFacturacion,
} from "./validateContainerFacturacion";
import {
  fetchContainerForBilling,
  fetchExistingProductoCostosForContainer,
  fetchOrderItemsForBilling,
  markContainerCostesFacturados,
  upsertProductoCostoFromFacturacion,
} from "../repositories/containerBillingRepository";
import type {
  ContainerRowForBilling,
  FacturacionLineaResult,
  FacturarContainerCostsError,
  FacturarContainerCostsResult,
  OrdenItemForBillingRow,
} from "../types/containerBilling.types";
import type { ContainerRowForStock } from "../types/containerStock.types";

function roundUnit(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function toStockContainerRow(container: ContainerRowForBilling): ContainerRowForStock {
  return {
    id: container.id,
    identificador_embarque: container.identificador_embarque,
    estado: container.estado ?? "",
    tipo_contenedor: container.tipo_contenedor,
    costo_flete_total_eur: container.costo_flete_total_eur,
    gastos_llegada_puerto_eur: container.gastos_llegada_puerto_eur,
    costo_transito_total_eur: container.costo_transito_total_eur,
    comision_bancaria_eur: container.comision_bancaria_eur,
    flete: container.flete,
    gastos_llegada_puerto: container.gastos_llegada_puerto,
  };
}

function resolvePaisDestino(
  item: OrdenItemForBillingRow,
  container: ContainerRowForBilling,
): string | null {
  return item.destino?.trim() || container.puerto_llegada?.trim() || null;
}

export async function facturarContainerCosts(
  contenedorId: string,
  userId: string,
): Promise<FacturarContainerCostsResult | FacturarContainerCostsError> {
  const [container, orderItems] = await Promise.all([
    fetchContainerForBilling(contenedorId),
    fetchOrderItemsForBilling(contenedorId),
  ]);

  const validation = validateContainerFacturacion({ container, orderItems });
  if (validation.ok === false) {
    return {
      ok: false,
      code: validation.code,
      message: validation.message,
      details: validation.details,
    };
  }

  const warnings = [...validation.warnings];
  const totals = resolveContainerLogisticTotals(container!);

  const allocation = calculateCbmCostAllocationFromData({
    container: toStockContainerRow(container!),
    orderItems: orderItems.map((item) => ({
      id: item.id,
      orden_id: item.orden_id,
      producto_id: item.producto_id,
      cantidad: item.cantidad,
      cbm_unitario: item.cbm_unitario,
      cbm_total: item.cbm_total,
      coste_unitario_eur: item.coste_unitario_eur,
      lote_producto: item.lote_producto,
    })),
  });

  const allocationByItemId = new Map(
    allocation.lineas.map((line) => [line.ordenItemId, line]),
  );

  const existingMap = await fetchExistingProductoCostosForContainer(contenedorId);
  const fechaHoy = new Date().toISOString().slice(0, 10);
  const lineas: FacturacionLineaResult[] = [];
  let upserted = 0;

  for (const item of orderItems) {
    const alloc = allocationByItemId.get(item.id);
    if (!alloc) {
      return {
        ok: false,
        code: "facturacion_failed",
        message: `No se pudo calcular reparto CBM para la línea ${item.id}`,
      };
    }

    const loteStored = resolveLoteProductoForCostos(item);
    const dedupKey = costosDedupKey(item.producto_id, loteStored);
    const existingId = existingMap.get(dedupKey);

    const costoFabricaEur = roundUnit(item.coste_unitario_eur!);
    const costoFleteUnit = alloc.costeFleteUnitario;
    const gastosPuertoUnit = alloc.costePuertoUnitario;
    const transitoUnit = alloc.costeTransitoUnitario;
    const costoTotalUnit = roundUnit(
      costoFabricaEur + costoFleteUnit + gastosPuertoUnit + transitoUnit,
    );

    const payload: Record<string, unknown> = {
      producto_id: item.producto_id,
      proveedor_id: item.proveedor_id,
      costo_fabrica_monto: item.coste_unitario_moneda,
      costo_fabrica_moneda: item.moneda_compra ?? "USD",
      tipo_cambio_aplicado: item.tipo_cambio_moneda_eur,
      costo_fabrica_eur: costoFabricaEur,
      costo_flete_unit_eur: costoFleteUnit,
      gastos_llegada_puerto_eur_unit: gastosPuertoUnit,
      transito_eur_unit: transitoUnit,
      costo_unitario_total_eur: costoTotalUnit,
      contenedor_id: contenedorId,
      lote_producto: loteStored,
      pais_destino: resolvePaisDestino(item, container!),
      fecha: fechaHoy,
    };

    const saved = await upsertProductoCostoFromFacturacion(existingId, payload);
    upserted += 1;

    const cbmTotal = item.cbm_total ?? 0;
    const pesoCbm =
      allocation.cbmTotalContenedor > 0
        ? cbmTotal / allocation.cbmTotalContenedor
        : 0;

    lineas.push({
      orden_item_id: item.id,
      sku: item.sku,
      producto: item.nombre,
      lote_producto: item.lote_producto,
      cantidad: item.cantidad,
      cbm_total: cbmTotal,
      peso_cbm: roundUnit(pesoCbm),
      costo_fabrica_eur_unit: costoFabricaEur,
      costo_flete_unit_eur: costoFleteUnit,
      gastos_llegada_puerto_eur_unit: gastosPuertoUnit,
      transito_eur_unit: transitoUnit,
      costo_unitario_total_eur: costoTotalUnit,
      producto_costos_id: saved.id,
      action: saved.action,
    });
  }

  const estadoLogistico =
    (container!.estado_logistico as
      | "borrador"
      | "preparando"
      | "en_puerto_salida"
      | "en_transito"
      | "en_puerto_destino"
      | "entregado") ?? "borrador";
  const estadoStock =
    (container!.estado_stock as
      | "pendiente_stock"
      | "parcialmente_disponible"
      | "disponible_stock"
      | "incidencia_stock") ?? "pendiente_stock";

  const legacyEstado = syncLegacyEstadoFromSeparated({
    estado_logistico: estadoLogistico,
    estado_stock: estadoStock,
    estado_costes: "costes_facturados",
  });

  await markContainerCostesFacturados(contenedorId, userId, {
    estado_costes: "costes_facturados",
    estado: legacyEstado,
    facturado_at: new Date().toISOString(),
    facturado_by: userId,
  });

  return {
    ok: true,
    contenedor_id: contenedorId,
    cbm_total_contenedor: roundUnit(allocation.cbmTotalContenedor),
    coste_flete_total: roundUnit(totals.costeFleteTotal),
    coste_transito_total: roundUnit(totals.costeTransitoTotal),
    gastos_llegada_total: roundUnit(totals.gastosLlegadaTotal),
    lineas_procesadas: lineas.length,
    coste_total_logistico: roundUnit(totals.costeTotalLogistico),
    producto_costos_upserted: upserted,
    warnings,
    lineas,
  };
}
