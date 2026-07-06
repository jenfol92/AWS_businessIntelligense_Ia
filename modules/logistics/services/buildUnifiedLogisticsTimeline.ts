/**
 * Modulo: Logistica.
 * Responsabilidad: base read-only para una futura vista unificada.
 * Incluye contenedores propios y shipments Amazon inbound sin duplicar entidades.
 * No toca stock, forecast, inventario_paises ni estados logisticos.
 */

import { supabaseAdmin } from "@/server/supabase/adminClient";

type RawRecord = Record<string, unknown>;

export type UnifiedLogisticsItem =
  | {
      type: "contenedor_propio";
      id: string;
      reference: string | null;
      status: string | null;
      eta: string | null;
      destination: string | null;
    }
  | {
      type: "amazon_inbound";
      id: string;
      reference: string | null;
      status: string | null;
      eta: string | null;
      destination: string | null;
      tracking: string | null;
    };

function str(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

export async function buildUnifiedLogisticsTimeline(): Promise<UnifiedLogisticsItem[]> {
  const [containersResult, amazonResult] = await Promise.all([
    supabaseAdmin
      .from("contenedores")
      .select("id, identificador_embarque, estado_logistico, fecha_eta_estimada, puerto_llegada")
      .order("fecha_eta_estimada", { ascending: true, nullsFirst: false })
      .limit(500),
    supabaseAdmin
      .from("amazon_inbound_shipments")
      .select(
        "shipment_id, shipment_name, estado_amazon, eta_estimada, destination_center, tracking_number, agl_tracking_number, amazon_container_number",
      )
      .order("eta_estimada", { ascending: true, nullsFirst: false })
      .limit(500),
  ]);

  if (containersResult.error) throw new Error(containersResult.error.message);
  if (amazonResult.error) throw new Error(amazonResult.error.message);

  const containers: UnifiedLogisticsItem[] = ((containersResult.data ?? []) as RawRecord[]).map(
    (row) => ({
      type: "contenedor_propio",
      id: String(row.id ?? ""),
      reference: str(row.identificador_embarque),
      status: str(row.estado_logistico),
      eta: str(row.fecha_eta_estimada),
      destination: str(row.puerto_llegada),
    }),
  );

  const amazonInbound: UnifiedLogisticsItem[] = ((amazonResult.data ?? []) as RawRecord[]).map(
    (row) => ({
      type: "amazon_inbound",
      id: String(row.shipment_id ?? ""),
      reference: str(row.shipment_name) ?? str(row.amazon_container_number),
      status: str(row.estado_amazon),
      eta: str(row.eta_estimada),
      destination: str(row.destination_center),
      tracking: str(row.tracking_number) ?? str(row.agl_tracking_number),
    }),
  );

  return [...containers, ...amazonInbound].sort((a, b) => {
    const aTime = new Date(a.eta ?? "9999-12-31").getTime();
    const bTime = new Date(b.eta ?? "9999-12-31").getTime();
    return aTime - bTime;
  });
}
