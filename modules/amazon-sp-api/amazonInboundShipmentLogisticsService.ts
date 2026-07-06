/**
 * Modulo: Amazon AGL.
 * Responsabilidad: ficha logistica, documentos y costes manuales de shipments inbound.
 * No debe tocar stock, inventario_paises, forecast, contenedores ni estados logisticos.
 */

import {
  isDriveConfigured,
  uploadAmazonInboundShipmentDocument,
} from "@/modules/drive/googleDriveService";
import { supabaseAdmin } from "@/server/supabase/adminClient";

type RawRecord = Record<string, unknown>;

export type AmazonInboundShipmentHeader = {
  shipment_id: string;
  inbound_plan_id: string | null;
  amazon_shipment_id: string | null;
  amazon_reference_id: string | null;
  logistics_flow: string | null;
  transport_provider: string | null;
  shipment_name: string | null;
  estado_amazon: string | null;
  destination_center: string | null;
  destination_country: string | null;
  fecha_creacion_resuelta: string | null;
  date_source: string | null;
  eta_estimada: string | null;
  fecha_salida: string | null;
  fecha_entrega_real: string | null;
  carrier: string | null;
  tracking_number: string | null;
  agl_tracking_number: string | null;
  amazon_container_number: string | null;
  booking_reference: string | null;
  transport_status: string | null;
  notas: string | null;
  v2024_enrichment: unknown;
  synced_at: string | null;
  updated_at: string | null;
};

export type AmazonInboundShipmentDocument = {
  id: string;
  shipment_id: string;
  tipo_documento: string;
  nombre_archivo: string;
  drive_file_id: string | null;
  drive_url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string | null;
  uploaded_by: string | null;
  notas: string | null;
};

export type AmazonInboundShipmentCost = {
  id: string;
  shipment_id: string;
  concepto: string;
  amount: number;
  currency: string;
  source: string;
  cost_date: string | null;
  notas: string | null;
  created_at: string | null;
  created_by: string | null;
};

export type AmazonInboundShipmentSummaryExtras = {
  headers: Map<string, AmazonInboundShipmentHeader>;
  documentCounts: Map<string, number>;
  costCounts: Map<string, number>;
  costTotals: Map<string, number>;
};

const ALLOWED_DOCUMENT_TYPES = new Set([
  "packing_list",
  "factura",
  "proforma",
  "booking",
  "etiquetas_amazon",
  "documento_agl",
  "otros",
]);

function str(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function mapHeader(row: RawRecord): AmazonInboundShipmentHeader {
  return {
    shipment_id: String(row.shipment_id ?? ""),
    inbound_plan_id: str(row.inbound_plan_id),
    amazon_shipment_id: str(row.amazon_shipment_id),
    amazon_reference_id: str(row.amazon_reference_id),
    logistics_flow: str(row.logistics_flow),
    transport_provider: str(row.transport_provider),
    shipment_name: str(row.shipment_name),
    estado_amazon: str(row.estado_amazon),
    destination_center: str(row.destination_center),
    destination_country: str(row.destination_country),
    fecha_creacion_resuelta: str(row.fecha_creacion_resuelta),
    date_source: str(row.date_source),
    eta_estimada: str(row.eta_estimada),
    fecha_salida: str(row.fecha_salida),
    fecha_entrega_real: str(row.fecha_entrega_real),
    carrier: str(row.carrier),
    tracking_number: str(row.tracking_number),
    agl_tracking_number: str(row.agl_tracking_number),
    amazon_container_number: str(row.amazon_container_number),
    booking_reference: str(row.booking_reference),
    transport_status: str(row.transport_status),
    notas: str(row.notas),
    v2024_enrichment: row.v2024_enrichment ?? null,
    synced_at: str(row.synced_at),
    updated_at: str(row.updated_at),
  };
}

function mapDocument(row: RawRecord): AmazonInboundShipmentDocument {
  return {
    id: String(row.id ?? ""),
    shipment_id: String(row.shipment_id ?? ""),
    tipo_documento: String(row.tipo_documento ?? "otros"),
    nombre_archivo: String(row.nombre_archivo ?? ""),
    drive_file_id: str(row.drive_file_id),
    drive_url: str(row.drive_url),
    mime_type: str(row.mime_type),
    size_bytes: row.size_bytes == null ? null : num(row.size_bytes),
    uploaded_at: str(row.uploaded_at),
    uploaded_by: str(row.uploaded_by),
    notas: str(row.notas),
  };
}

function mapCost(row: RawRecord): AmazonInboundShipmentCost {
  return {
    id: String(row.id ?? ""),
    shipment_id: String(row.shipment_id ?? ""),
    concepto: String(row.concepto ?? ""),
    amount: num(row.amount),
    currency: String(row.currency ?? "EUR"),
    source: String(row.source ?? "manual"),
    cost_date: str(row.cost_date),
    notas: str(row.notas),
    created_at: str(row.created_at),
    created_by: str(row.created_by),
  };
}

export async function ensureAmazonInboundShipmentHeader(shipmentId: string) {
  const { error } = await supabaseAdmin
    .from("amazon_inbound_shipments")
    .upsert({ shipment_id: shipmentId, synced_at: new Date().toISOString() }, { onConflict: "shipment_id" });
  if (error) throw new Error(error.message);
}

export async function loadAmazonInboundShipmentExtras(
  shipmentIds: string[],
): Promise<AmazonInboundShipmentSummaryExtras> {
  const uniqueIds = Array.from(new Set(shipmentIds.filter(Boolean)));
  const headers = new Map<string, AmazonInboundShipmentHeader>();
  const documentCounts = new Map<string, number>();
  const costCounts = new Map<string, number>();
  const costTotals = new Map<string, number>();
  if (uniqueIds.length === 0) return { headers, documentCounts, costCounts, costTotals };

  const [headerResult, docsResult, costsResult] = await Promise.all([
    supabaseAdmin.from("amazon_inbound_shipments").select("*").in("shipment_id", uniqueIds),
    supabaseAdmin
      .from("amazon_inbound_shipment_documents")
      .select("shipment_id")
      .in("shipment_id", uniqueIds),
    supabaseAdmin
      .from("amazon_inbound_shipment_costs")
      .select("shipment_id, amount")
      .in("shipment_id", uniqueIds),
  ]);

  if (headerResult.error) throw new Error(headerResult.error.message);
  if (docsResult.error) throw new Error(docsResult.error.message);
  if (costsResult.error) throw new Error(costsResult.error.message);

  for (const row of (headerResult.data ?? []) as RawRecord[]) {
    const header = mapHeader(row);
    if (header.shipment_id) headers.set(header.shipment_id, header);
  }
  for (const row of (docsResult.data ?? []) as RawRecord[]) {
    const shipmentId = str(row.shipment_id);
    if (!shipmentId) continue;
    documentCounts.set(shipmentId, (documentCounts.get(shipmentId) ?? 0) + 1);
  }
  for (const row of (costsResult.data ?? []) as RawRecord[]) {
    const shipmentId = str(row.shipment_id);
    if (!shipmentId) continue;
    costCounts.set(shipmentId, (costCounts.get(shipmentId) ?? 0) + 1);
    costTotals.set(shipmentId, (costTotals.get(shipmentId) ?? 0) + num(row.amount));
  }

  return { headers, documentCounts, costCounts, costTotals };
}

export async function listAmazonInboundShipmentDocuments(
  shipmentId: string,
): Promise<AmazonInboundShipmentDocument[]> {
  const { data, error } = await supabaseAdmin
    .from("amazon_inbound_shipment_documents")
    .select("*")
    .eq("shipment_id", shipmentId)
    .order("uploaded_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawRecord[]).map(mapDocument);
}

export async function updateAmazonInboundShipmentManualFields(params: {
  shipmentId: string;
  eta_estimada?: string | null;
  fecha_salida?: string | null;
  fecha_entrega_real?: string | null;
  carrier?: string | null;
  tracking_number?: string | null;
  agl_tracking_number?: string | null;
  amazon_container_number?: string | null;
  booking_reference?: string | null;
  notas?: string | null;
}): Promise<AmazonInboundShipmentHeader> {
  await ensureAmazonInboundShipmentHeader(params.shipmentId);

  const { shipmentId: _shipmentId, ...manualFields } = params;
  const { data, error } = await supabaseAdmin
    .from("amazon_inbound_shipments")
    .update({
      ...manualFields,
      updated_at: new Date().toISOString(),
    })
    .eq("shipment_id", params.shipmentId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapHeader(data as RawRecord);
}

const ALLOWED_LOGISTICS_FLOWS = new Set([
  "fabrica_a_amazon",
  "almacen_a_amazon",
  "desconocido",
]);

function normalizeLogisticsFlowForWrite(value: string | null): string | null {
  if (value === "proveedor_a_amazon") return "fabrica_a_amazon";
  return value;
}

export async function updateAmazonInboundShipmentLogisticsFlow(params: {
  shipmentId: string;
  logisticsFlow: string | null;
}): Promise<AmazonInboundShipmentHeader> {
  const logisticsFlow = normalizeLogisticsFlowForWrite(params.logisticsFlow);
  if (logisticsFlow && !ALLOWED_LOGISTICS_FLOWS.has(logisticsFlow)) {
    throw new Error("logistics_flow invalido.");
  }

  await ensureAmazonInboundShipmentHeader(params.shipmentId);

  const { data, error } = await supabaseAdmin
    .from("amazon_inbound_shipments")
    .update({
      logistics_flow: logisticsFlow,
      updated_at: new Date().toISOString(),
    })
    .eq("shipment_id", params.shipmentId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapHeader(data as RawRecord);
}

export async function uploadAmazonInboundShipmentDocumentRecord(params: {
  shipmentId: string;
  file: File;
  tipoDocumento: string;
  notas?: string | null;
  userId: string;
}): Promise<AmazonInboundShipmentDocument> {
  if (!ALLOWED_DOCUMENT_TYPES.has(params.tipoDocumento)) {
    throw new Error("Tipo de documento no valido.");
  }
  if (!isDriveConfigured()) {
    throw new Error("Google Drive no esta configurado.");
  }
  await ensureAmazonInboundShipmentHeader(params.shipmentId);

  const buffer = Buffer.from(await params.file.arrayBuffer());
  const driveResult = await uploadAmazonInboundShipmentDocument(
    params.shipmentId,
    params.file.name,
    buffer,
    params.file.type || "application/octet-stream",
  );

  const { data, error } = await supabaseAdmin
    .from("amazon_inbound_shipment_documents")
    .insert({
      shipment_id: params.shipmentId,
      tipo_documento: params.tipoDocumento,
      nombre_archivo: params.file.name,
      drive_file_id: driveResult.drive_id,
      drive_url: driveResult.web_view_link,
      mime_type: params.file.type || null,
      size_bytes: params.file.size,
      uploaded_by: params.userId,
      notas: params.notas ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapDocument(data as RawRecord);
}

export async function listAmazonInboundShipmentCosts(
  shipmentId: string,
): Promise<AmazonInboundShipmentCost[]> {
  const { data, error } = await supabaseAdmin
    .from("amazon_inbound_shipment_costs")
    .select("*")
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawRecord[]).map(mapCost);
}

export async function createAmazonInboundShipmentCost(params: {
  shipmentId: string;
  concepto: string;
  amount: number;
  currency?: string | null;
  costDate?: string | null;
  notas?: string | null;
  userId: string;
}): Promise<AmazonInboundShipmentCost> {
  if (!params.concepto.trim()) throw new Error("concepto requerido");
  if (!Number.isFinite(params.amount) || params.amount < 0) {
    throw new Error("amount invalido");
  }
  await ensureAmazonInboundShipmentHeader(params.shipmentId);

  const { data, error } = await supabaseAdmin
    .from("amazon_inbound_shipment_costs")
    .insert({
      shipment_id: params.shipmentId,
      concepto: params.concepto.trim(),
      amount: params.amount,
      currency: (params.currency ?? "EUR").trim().toUpperCase() || "EUR",
      source: "manual",
      cost_date: params.costDate || null,
      notas: params.notas ?? null,
      created_by: params.userId,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapCost(data as RawRecord);
}

export async function deleteAmazonInboundShipmentCost(params: {
  shipmentId: string;
  costId: string;
}) {
  const { error } = await supabaseAdmin
    .from("amazon_inbound_shipment_costs")
    .delete()
    .eq("shipment_id", params.shipmentId)
    .eq("id", params.costId);
  if (error) throw new Error(error.message);
}
