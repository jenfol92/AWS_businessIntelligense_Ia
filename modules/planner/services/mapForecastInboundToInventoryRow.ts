import type { InventoryInboundRow } from "@/modules/inventory/types/inventory.types";
import type { ForecastInboundItem } from "../types/forecastInbound.types";
import {
  inboundPlanningKindLabel,
  legacyInboundConfidence,
  resolveInboundPlanningKind,
  usableForPlanning,
} from "./resolveInboundPlanningKind";

export function mapForecastInboundToInventoryRow(
  item: ForecastInboundItem,
): InventoryInboundRow {
  const planningKind = resolveInboundPlanningKind(item);
  const forPlanning = usableForPlanning(planningKind);

  return {
    ordenId: item.orden_id,
    ordenItemId: item.orden_item_id,
    numeroOrden: item.numero_orden,
    numeroPedidoAgente: null,
    contenedorId: item.contenedor_id,
    contenedorIdentificador: item.identificador_embarque,
    logisticsKind: item.contenedor_id ? "contenedor_propio" : "none",
    seguimiento: item.identificador_embarque,
    amazonShipmentId: null,
    amazonShipmentName: null,
    amazonStatus: null,
    amazonDestinationCenter: null,
    destinoOrden: item.destino_orden,
    eta: item.fecha_eta_estimada?.slice(0, 10) ?? null,
    etaSource: item.has_contenedor ? "container" : "order",
    cantidadPendiente: item.unidades_pendientes,
    unidadesOrden: item.unidades_orden,
    unidadesAplicadas: item.unidades_aplicadas,
    estado: "confirmado",
    loteProducto: null,
    confidence: legacyInboundConfidence(planningKind),
    planningKind,
    usableForPlanning: forPlanning,
    retrasoDias: item.retraso_dias,
    costeUnitarioEur: Number(item.coste_unitario_eur ?? 0),
    forecastCountry: item.forecast_country,
    forecastChannel: item.forecast_channel,
    warnings: item.warnings,
  };
}

export { inboundPlanningKindLabel };
