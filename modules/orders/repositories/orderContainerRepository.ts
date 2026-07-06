import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/server/supabase/adminClient";

import type {
  OrderLinkedAmazonInbound,
  OrderLinkedContainer,
} from "@/modules/orders/types/orderList.types";

type ContainerLinkRow = {
  orden_id: string;
  contenedor_id: string;
  contenedores:
    | {
        id: string;
        identificador_embarque: string | null;
        fecha_salida: string | null;
        fecha_eta_estimada: string | null;
        estado_logistico: string | null;
        puerto_llegada: string | null;
      }
    | Array<{
        id: string;
        identificador_embarque: string | null;
        fecha_salida: string | null;
        fecha_eta_estimada: string | null;
        estado_logistico: string | null;
        puerto_llegada: string | null;
      }>
    | null;
};

type AmazonInboundShipmentRow = {
  shipment_id: string | null;
  shipment_name: string | null;
  estado_amazon: string | null;
  destination_center: string | null;
  destination_country: string | null;
  logistics_flow: string | null;
  transport_provider: string | null;
  fecha_salida: string | null;
  eta_estimada: string | null;
  fecha_entrega_real: string | null;
  tracking_number: string | null;
  agl_tracking_number: string | null;
  amazon_container_number: string | null;
};

type AmazonInboundAssignmentRow = {
  id: string;
  orden_id: string;
  assignment_type: string;
  contenedor_id: string | null;
  shipment_id: string | null;
  status: string;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export type OrderContainerAssignment = {
  orden_id: string;
  contenedor_id: string;
  identificador_embarque: string;
};

export async function fetchContainerInfoByOrderIds(
  supabase: SupabaseClient,
  orderIds: string[],
): Promise<Map<string, OrderLinkedContainer>> {
  const map = new Map<string, OrderLinkedContainer>();
  if (orderIds.length === 0) return map;

  const { data, error } = await supabase
    .from("contenedor_ordenes")
    .select(
      `orden_id, contenedor_id,
       contenedores(id, identificador_embarque, fecha_salida, fecha_eta_estimada, estado_logistico, puerto_llegada)`,
    )
    .in("orden_id", orderIds);

  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as ContainerLinkRow[]) {
    const container = firstRelation(row.contenedores);
    if (!container) continue;

    map.set(row.orden_id, {
      contenedor_id: row.contenedor_id,
      identificador_embarque:
        container.identificador_embarque?.trim() || row.contenedor_id.slice(0, 8),
      fecha_salida: container.fecha_salida,
      fecha_eta_estimada: container.fecha_eta_estimada,
      estado_logistico: container.estado_logistico,
      puerto_llegada: container.puerto_llegada,
    });
  }

  return map;
}

export async function fetchOrderContainerAssignments(
  supabase: SupabaseClient,
  ordenIds: string[],
): Promise<OrderContainerAssignment[]> {
  if (ordenIds.length === 0) return [];

  const { data, error } = await supabase
    .from("contenedor_ordenes")
    .select(`orden_id, contenedor_id, contenedores(identificador_embarque)`)
    .in("orden_id", ordenIds);

  if (error) throw new Error(error.message);

  return ((data ?? []) as ContainerLinkRow[]).map((row) => {
    const container = firstRelation(row.contenedores);

    return {
      orden_id: row.orden_id,
      contenedor_id: row.contenedor_id,
      identificador_embarque:
        container?.identificador_embarque?.trim() || row.contenedor_id.slice(0, 8),
    };
  });
}

export async function fetchAmazonInboundInfoByOrderIds(
  _supabase: SupabaseClient,
  orderIds: string[],
): Promise<Map<string, OrderLinkedAmazonInbound>> {


  const map = new Map<string, OrderLinkedAmazonInbound>();
  if (orderIds.length === 0) return map;

  const db = supabaseAdmin;

  const { data: assignments, error: assignmentsError } = await db
    .from("orden_logistics_assignments")
    .select("id, orden_id, assignment_type, contenedor_id, shipment_id, status")
    .in("orden_id", orderIds)
    .eq("status", "active")
    .eq("assignment_type", "amazon_inbound");

  if (assignmentsError) {
    throw new Error(assignmentsError.message);
  }

  const assignmentRows = (assignments ?? []) as unknown as AmazonInboundAssignmentRow[];



  const shipmentIds = Array.from(
    new Set(
      assignmentRows
        .map((row) => row.shipment_id?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

  if (shipmentIds.length === 0) return map;

  const { data: shipments, error: shipmentsError } = await db
    .from("amazon_inbound_shipments")
    .select(
      [
        "shipment_id",
        "shipment_name",
        "estado_amazon",
        "destination_center",
        "destination_country",
        "logistics_flow",
        "transport_provider",
        "fecha_salida",
        "eta_estimada",
        "fecha_entrega_real",
        "tracking_number",
        "agl_tracking_number",
        "amazon_container_number",
      ].join(", "),
    )
    .in("shipment_id", shipmentIds);

  if (shipmentsError) {
    throw new Error(shipmentsError.message);
  }

  const shipmentRows = (shipments ?? []) as unknown as AmazonInboundShipmentRow[];



  const shipmentById = new Map<string, AmazonInboundShipmentRow>();

  for (const shipment of shipmentRows) {
    const shipmentId = shipment.shipment_id?.trim() ?? "";
    if (shipmentId) {
      shipmentById.set(shipmentId, shipment);
    }
  }

  for (const assignment of assignmentRows) {
    const orderId = assignment.orden_id;
    const shipmentId = assignment.shipment_id?.trim() ?? "";

    if (!orderId || !shipmentId) continue;

    const shipment = shipmentById.get(shipmentId) ?? null;

    if (!shipment && process.env.NODE_ENV === "development") {
      console.warn("[pedidos] amazon_inbound assignment sin header", {
        orderId,
        shipmentId,
      });
    }

    map.set(orderId, {
      assignment_type: "amazon_inbound",
      shipment_id: shipmentId,
      shipment_name: shipment?.shipment_name ?? null,
      estado_amazon: shipment?.estado_amazon ?? null,
      destination_center: shipment?.destination_center ?? null,
      destination_country: shipment?.destination_country ?? null,
      logistics_flow: shipment?.logistics_flow ?? null,
      transport_provider: shipment?.transport_provider ?? null,
      fecha_salida: shipment?.fecha_salida ?? null,
      eta_estimada: shipment?.eta_estimada ?? null,
      fecha_entrega_real: shipment?.fecha_entrega_real ?? null,
      tracking_number: shipment?.tracking_number ?? null,
      agl_tracking_number: shipment?.agl_tracking_number ?? null,
      amazon_container_number: shipment?.amazon_container_number ?? null,
      documents_count: 0,
      costs_count: 0,
    });
  }

 
  return map;
}