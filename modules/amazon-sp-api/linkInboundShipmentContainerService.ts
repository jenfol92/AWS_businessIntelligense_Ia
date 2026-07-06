/**
 * Modulo: Amazon AGL.
 * Responsabilidad: vinculacion manual entre shipments inbound sincronizados
 * en `amazon_envios` y contenedores ERP tipo `amazon_agl`.
 * No debe tocar stock, inventario_paises, forecast ni estados logisticos/stock.
 */

import { supabaseAdmin } from "@/server/supabase/adminClient";

type RawRecord = Record<string, unknown>;

export type LinkableAglContainer = {
  id: string;
  identificador_embarque: string | null;
  tipo_contenedor: string | null;
  estado_logistico: string | null;
  estado_stock: string | null;
  fecha_eta_estimada: string | null;
  destino_pais_id: string | null;
  amazon_shipment_id: string | null;
  amazon_reference_id: string | null;
  amazon_link_status: string | null;
  order_refs: string[];
};

export type LinkInboundShipmentResult = {
  shipment_id: string;
  contenedor_id: string | null;
  linesLinked: number;
  skusLinked: number;
};

function str(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

async function getShipmentRows(shipmentId: string) {
  const { data, error } = await supabaseAdmin
    .from("amazon_envios")
    .select("id, shipment_id, sku, reference_id, contenedor_id")
    .eq("shipment_id", shipmentId);

  if (error) throw new Error(error.message);
  return (data ?? []) as RawRecord[];
}

async function getContainer(containerId: string) {
  const { data, error } = await supabaseAdmin
    .from("contenedores")
    .select(
      "id, identificador_embarque, tipo_contenedor, amazon_shipment_id, amazon_reference_id, amazon_link_status",
    )
    .eq("id", containerId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data ?? null) as RawRecord | null;
}

function assertShipmentRows(shipmentId: string, rows: RawRecord[]) {
  if (rows.length === 0) {
    throw new Error(`No existe shipment ${shipmentId} en amazon_envios.`);
  }
}

function assertAmazonAglContainer(container: RawRecord | null, allowConvert: boolean) {
  if (!container) throw new Error("El contenedor indicado no existe.");
  const tipo = str(container.tipo_contenedor)?.toLowerCase();
  if (tipo === "amazon_agl") return;
  if (allowConvert) return;
  throw new Error(
    `El contenedor ${str(container.identificador_embarque) ?? str(container.id) ?? ""} no es amazon_agl.`,
  );
}

export async function listLinkableAglContainers(): Promise<LinkableAglContainer[]> {
  const { data: containersData, error: containersError } = await supabaseAdmin
    .from("contenedores")
    .select(
      "id, identificador_embarque, tipo_contenedor, estado_logistico, estado_stock, fecha_eta_estimada, destino_pais_id, amazon_shipment_id, amazon_reference_id, amazon_link_status",
    )
    .eq("tipo_contenedor", "amazon_agl")
    .or("estado_logistico.is.null,estado_logistico.neq.entregado")
    .order("amazon_shipment_id", { ascending: true, nullsFirst: true })
    .order("fecha_eta_estimada", { ascending: true, nullsFirst: false })
    .limit(200);

  if (containersError) throw new Error(containersError.message);

  const containers = ((containersData ?? []) as RawRecord[]).map((row) => ({
    id: String(row.id),
    identificador_embarque: str(row.identificador_embarque),
    tipo_contenedor: str(row.tipo_contenedor),
    estado_logistico: str(row.estado_logistico),
    estado_stock: str(row.estado_stock),
    fecha_eta_estimada: str(row.fecha_eta_estimada),
    destino_pais_id: str(row.destino_pais_id),
    amazon_shipment_id: str(row.amazon_shipment_id),
    amazon_reference_id: str(row.amazon_reference_id),
    amazon_link_status: str(row.amazon_link_status),
    order_refs: [] as string[],
  }));

  if (containers.length === 0) return [];

  const { data: linksData, error: linksError } = await supabaseAdmin
    .from("contenedor_ordenes")
    .select("contenedor_id, ordenes_compra(id, numero_orden, numero_pedido_agente)")
    .in(
      "contenedor_id",
      containers.map((container) => container.id),
    );

  if (linksError) throw new Error(linksError.message);

  const refsByContainer = new Map<string, string[]>();
  for (const link of (linksData ?? []) as RawRecord[]) {
    const containerId = str(link.contenedor_id);
    if (!containerId) continue;
    const order = Array.isArray(link.ordenes_compra)
      ? link.ordenes_compra[0]
      : link.ordenes_compra;
    const refs = unique([
      str(asRecord(order).numero_orden),
      str(asRecord(order).numero_pedido_agente),
    ]);
    refsByContainer.set(containerId, [
      ...(refsByContainer.get(containerId) ?? []),
      ...refs,
    ]);
  }

  return containers.map((container) => ({
    ...container,
    order_refs: unique(refsByContainer.get(container.id) ?? []),
  }));
}

export async function linkInboundShipmentToContainer(params: {
  shipmentId: string;
  contenedorId: string;
  linkNotes?: string | null;
  userId: string;
  convertToAmazonAgl?: boolean;
}): Promise<LinkInboundShipmentResult> {
  const shipmentRows = await getShipmentRows(params.shipmentId);
  assertShipmentRows(params.shipmentId, shipmentRows);

  const container = await getContainer(params.contenedorId);
  assertAmazonAglContainer(container, Boolean(params.convertToAmazonAgl));

  if (params.convertToAmazonAgl && str(container?.tipo_contenedor)?.toLowerCase() !== "amazon_agl") {
    const { error: convertError } = await supabaseAdmin
      .from("contenedores")
      .update({ tipo_contenedor: "amazon_agl" })
      .eq("id", params.contenedorId);
    if (convertError) throw new Error(convertError.message);
  }

  const referenceId = str(shipmentRows.find((row) => str(row.reference_id))?.reference_id);
  const now = new Date().toISOString();

  const { data: linkedRows, error: enviosError } = await supabaseAdmin
    .from("amazon_envios")
    .update({
      contenedor_id: params.contenedorId,
      link_status: "manual_linked",
      link_confidence: 1,
      link_notes: params.linkNotes ?? null,
      linked_at: now,
      linked_by: params.userId,
    })
    .eq("shipment_id", params.shipmentId)
    .select("id, sku");

  if (enviosError) throw new Error(enviosError.message);

  const { error: containerError } = await supabaseAdmin
    .from("contenedores")
    .update({
      amazon_shipment_id: params.shipmentId,
      amazon_reference_id: referenceId,
      amazon_link_status: "manual_linked",
    })
    .eq("id", params.contenedorId);

  if (containerError) throw new Error(containerError.message);

  const rows = (linkedRows ?? []) as RawRecord[];
  return {
    shipment_id: params.shipmentId,
    contenedor_id: params.contenedorId,
    linesLinked: rows.length,
    skusLinked: unique(rows.map((row) => str(row.sku))).length,
  };
}

export async function unlinkInboundShipmentFromContainer(params: {
  shipmentId: string;
  linkNotes?: string | null;
}): Promise<LinkInboundShipmentResult> {
  const shipmentRows = await getShipmentRows(params.shipmentId);
  assertShipmentRows(params.shipmentId, shipmentRows);

  const linkedContainerIds = unique(shipmentRows.map((row) => str(row.contenedor_id)));

  const { data: unlinkedRows, error: enviosError } = await supabaseAdmin
    .from("amazon_envios")
    .update({
      contenedor_id: null,
      link_status: "unlinked",
      link_confidence: null,
      link_notes: params.linkNotes ?? null,
      linked_at: null,
      linked_by: null,
    })
    .eq("shipment_id", params.shipmentId)
    .select("id, sku");

  if (enviosError) throw new Error(enviosError.message);

  const { error: containerError } = await supabaseAdmin
    .from("contenedores")
    .update({
      amazon_shipment_id: null,
      amazon_link_status: "unlinked",
    })
    .eq("amazon_shipment_id", params.shipmentId);

  if (containerError) throw new Error(containerError.message);

  const rows = (unlinkedRows ?? []) as RawRecord[];
  return {
    shipment_id: params.shipmentId,
    contenedor_id: linkedContainerIds.length === 1 ? linkedContainerIds[0] ?? null : null,
    linesLinked: rows.length,
    skusLinked: unique(rows.map((row) => str(row.sku))).length,
  };
}
