// modules/planning/services/upsertProductSupplyConfig.ts

import { upsertProductSupplyConfigRow } from "../repositories/productSupplyConfigRepository";
import type {
  ProductSupplyConfigUpsertBody,
  ProductSupplyConfigUpsertRaw,
  ProductSupplyConfigUpsertResponse,
} from "../types";
import { mapRawToProductSupplyConfig } from "./getProductSupplyConfig";

function toInt(value: number | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function mapBodyToRaw(
  productoId: string,
  body: ProductSupplyConfigUpsertBody
): ProductSupplyConfigUpsertRaw {
  return {
    producto_id: productoId,
    lead_time_produccion_dias: toInt(body.leadTimeProduccionDias, 0),
    lead_time_transporte_dias: toInt(body.leadTimeTransporteDias, 0),
    lead_time_aduana_dias: toInt(body.leadTimeAduanaDias, 0),
    stock_seguridad_dias: toInt(body.stockSeguridadDias, 0),
    frecuencia_reposicion_dias: toInt(body.frecuenciaReposicionDias, 0),
    moq: toInt(body.moq, 0),
    master_carton_qty: toInt(body.masterCartonQty, 0),
    puerto_origen: body.puertoOrigen,
    puerto_destino: body.puertoDestino,
    proveedor_id: body.proveedorId,
    agente_id: body.agenteId,
  };
}

export async function upsertProductSupplyConfig(
  productoId: string,
  body: ProductSupplyConfigUpsertBody
): Promise<ProductSupplyConfigUpsertResponse> {
  const raw = mapBodyToRaw(productoId, body);
  const row = await upsertProductSupplyConfigRow(raw);

  return {
    ok: true,
    config: mapRawToProductSupplyConfig(row),
  };
}
