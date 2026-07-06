/**
 * Modulo: Amazon AGL.
 * Responsabilidad: vinculacion manual entre shipments inbound sincronizados
 * en `amazon_envios` y ordenes/proformas ERP.
 * No debe tocar stock, contenedores, inventario_paises, forecast ni estados logisticos.
 */

import { supabaseAdmin } from "@/server/supabase/adminClient";
import { ensureAmazonInboundShipmentHeader } from "@/modules/amazon-sp-api/amazonInboundShipmentLogisticsService";

type RawRecord = Record<string, unknown>;

export type ShipmentOrderLinkSummary = {
  id: string;
  shipment_id: string;
  orden_id: string;
  numero_orden: string | null;
  numero_pedido_agente: string | null;
  estado: string | null;
  proveedor: string | null;
  link_status: string | null;
  link_notes: string | null;
  linked_at: string | null;
};

export type LinkableOrderCandidate = {
  orden_id: string;
  numero_orden: string | null;
  numero_pedido_agente: string | null;
  estado: string | null;
  proveedor: string | null;
  fecha_orden: string | null;
  fecha_confirmacion: string | null;
  eta: string | null;
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  matchedProducts: number;
  shipmentUnits: number;
  orderUnits: number;
  alreadyLinked: boolean;
};

export type LinkShipmentOrderResult = {
  shipment_id: string;
  orden_id: string;
  links: ShipmentOrderLinkSummary[];
};

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}

function str(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function dateText(value: unknown): string | null {
  const text = str(value);
  return text ? text.slice(0, 10) : null;
}

function firstString(values: Array<unknown>): string | null {
  for (const value of values) {
    const text = str(value);
    if (text) return text;
  }
  return null;
}

function relatedRecord(value: unknown): RawRecord {
  return Array.isArray(value) ? asRecord(value[0]) : asRecord(value);
}

async function assertCanAssignAmazonInbound(params: {
  ordenId: string;
  shipmentId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("orden_logistics_assignments")
    .select("id, assignment_type, shipment_id, contenedor_id")
    .eq("orden_id", params.ordenId)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return;

  const assignment = data as RawRecord;
  const assignmentType = str(assignment.assignment_type);
  const shipmentId = str(assignment.shipment_id);
  if (assignmentType === "amazon_inbound" && shipmentId === params.shipmentId) return;

  if (assignmentType === "amazon_inbound") {
    throw new Error(
      `La orden ya tiene otro shipment Amazon activo (${shipmentId ?? "sin shipment"}). Desvincula esa logistica antes de vincular otra.`,
    );
  }

  throw new Error(
    "La orden ya tiene una logistica activa distinta. Desvincula primero la logistica anterior antes de vincular Amazon inbound.",
  );
}

async function upsertAmazonInboundAssignment(params: {
  ordenId: string;
  shipmentId: string;
  userId: string;
  notes?: string | null;
}) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("orden_logistics_assignments")
    .select("id")
    .eq("orden_id", params.ordenId)
    .eq("shipment_id", params.shipmentId)
    .eq("assignment_type", "amazon_inbound")
    .eq("status", "active")
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existing) return;

  const { error } = await supabaseAdmin
    .from("orden_logistics_assignments")
    .insert({
      orden_id: params.ordenId,
      assignment_type: "amazon_inbound",
      shipment_id: params.shipmentId,
      contenedor_id: null,
      status: "active",
      notes: params.notes ?? null,
      created_by: params.userId,
    });

  if (error) throw new Error(error.message);
}

async function getShipmentRows(shipmentId: string): Promise<RawRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("amazon_envios")
    .select("id, shipment_id, producto_id, cantidad_esperada, cantidad_enviada, fecha_creacion")
    .eq("shipment_id", shipmentId);

  if (error) throw new Error(error.message);
  return (data ?? []) as RawRecord[];
}

function assertShipmentRows(shipmentId: string, rows: RawRecord[]) {
  if (rows.length === 0) {
    throw new Error(`No existe shipment ${shipmentId} en amazon_envios.`);
  }
}

function buildShipmentProductUnits(rows: RawRecord[]): Map<string, number> {
  const unitsByProduct = new Map<string, number>();
  for (const row of rows) {
    const productId = str(row.producto_id);
    if (!productId) continue;
    const units = num(row.cantidad_esperada) || num(row.cantidad_enviada);
    unitsByProduct.set(productId, (unitsByProduct.get(productId) ?? 0) + units);
  }
  return unitsByProduct;
}

async function loadOrderLinks(shipmentIds: string[]): Promise<Map<string, ShipmentOrderLinkSummary[]>> {
  const uniqueShipmentIds = unique(shipmentIds);
  const linksByShipment = new Map<string, ShipmentOrderLinkSummary[]>();
  if (uniqueShipmentIds.length === 0) return linksByShipment;

  const { data, error } = await supabaseAdmin
    .from("amazon_inbound_shipment_order_links")
    .select(
      `id, shipment_id, orden_id, link_status, link_notes, linked_at,
       ordenes_compra(id, numero_orden, numero_pedido_agente, estado)`,
    )
    .in("shipment_id", uniqueShipmentIds)
    .order("linked_at", { ascending: false, nullsFirst: false });

  if (error) throw new Error(error.message);

  const orderIds = unique(
    ((data ?? []) as RawRecord[]).map((row) => str(row.orden_id)),
  );
  const suppliersByOrder = await loadOrderSuppliers(orderIds);

  for (const row of (data ?? []) as RawRecord[]) {
    const shipmentId = str(row.shipment_id);
    const linkId = str(row.id);
    const orderId = str(row.orden_id);
    if (!shipmentId || !linkId || !orderId) continue;
    const order = relatedRecord(row.ordenes_compra);
    const current = linksByShipment.get(shipmentId) ?? [];
    current.push({
      id: linkId,
      shipment_id: shipmentId,
      orden_id: orderId,
      numero_orden: str(order.numero_orden),
      numero_pedido_agente: str(order.numero_pedido_agente),
      estado: str(order.estado),
      proveedor: suppliersByOrder.get(orderId) ?? null,
      link_status: str(row.link_status),
      link_notes: str(row.link_notes),
      linked_at: str(row.linked_at),
    });
    linksByShipment.set(shipmentId, current);
  }

  return linksByShipment;
}

async function loadOrderSuppliers(orderIds: string[]): Promise<Map<string, string | null>> {
  const suppliers = new Map<string, string | null>();
  const uniqueOrderIds = unique(orderIds);
  if (uniqueOrderIds.length === 0) return suppliers;

  const { data, error } = await supabaseAdmin
    .from("orden_items")
    .select("orden_id, proveedores(nombre)")
    .in("orden_id", uniqueOrderIds);

  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as RawRecord[]) {
    const orderId = str(row.orden_id);
    if (!orderId || suppliers.has(orderId)) continue;
    suppliers.set(orderId, str(relatedRecord(row.proveedores).nombre));
  }

  return suppliers;
}

export async function listLinkedOrdersForShipments(
  shipmentIds: string[],
): Promise<Map<string, ShipmentOrderLinkSummary[]>> {
  return loadOrderLinks(shipmentIds);
}

export async function listLinkableOrdersForShipment(
  shipmentId: string,
): Promise<{
  shipment_id: string;
  linkedOrders: ShipmentOrderLinkSummary[];
  candidates: LinkableOrderCandidate[];
}> {
  const shipmentRows = await getShipmentRows(shipmentId);
  assertShipmentRows(shipmentId, shipmentRows);

  const shipmentUnitsByProduct = buildShipmentProductUnits(shipmentRows);
  const productIds = Array.from(shipmentUnitsByProduct.keys());
  const shipmentUnits = Array.from(shipmentUnitsByProduct.values()).reduce(
    (sum, value) => sum + value,
    0,
  );
  const linksByShipment = await loadOrderLinks([shipmentId]);
  const linkedOrders = linksByShipment.get(shipmentId) ?? [];

  if (productIds.length === 0) {
    return { shipment_id: shipmentId, linkedOrders, candidates: [] };
  }

  const { data, error } = await supabaseAdmin
    .from("orden_items")
    .select(
      `orden_id, producto_id, cantidad,
       ordenes_compra(id, numero_orden, numero_pedido_agente, estado, fecha_orden, fecha_confirmacion, eta),
       proveedores(nombre)`,
    )
    .in("producto_id", productIds)
    .limit(1000);

  if (error) throw new Error(error.message);

  const rowsByOrder = new Map<string, RawRecord[]>();
  for (const row of (data ?? []) as RawRecord[]) {
    const orderId = str(row.orden_id);
    if (!orderId) continue;
    const current = rowsByOrder.get(orderId) ?? [];
    current.push(row);
    rowsByOrder.set(orderId, current);
  }

  const linkedOrderIds = new Set(linkedOrders.map((link) => link.orden_id));
  const candidates = Array.from(rowsByOrder.entries()).map(([orderId, rows]) => {
    const matchedProductIds = unique(rows.map((row) => str(row.producto_id)));
    const orderUnits = rows.reduce((sum, row) => sum + num(row.cantidad), 0);
    const exactQuantityMatches = rows.filter((row) => {
      const productId = str(row.producto_id);
      return productId
        ? num(row.cantidad) === (shipmentUnitsByProduct.get(productId) ?? -1)
        : false;
    }).length;
    const order = relatedRecord(rows[0]?.ordenes_compra);
    const diff = Math.abs(orderUnits - shipmentUnits);
    const quantityScore =
      shipmentUnits > 0 ? Math.max(0, 1 - diff / Math.max(shipmentUnits, orderUnits, 1)) : 0;
    const productScore = matchedProductIds.length / productIds.length;
    const exactScore = exactQuantityMatches / Math.max(productIds.length, 1);
    const score = Math.round((productScore * 60 + quantityScore * 25 + exactScore * 15) * 100) / 100;
    const reasons = [
      `${matchedProductIds.length}/${productIds.length} productos coinciden`,
      `${orderUnits} uds en orden frente a ${shipmentUnits} uds en shipment`,
    ];
    if (exactQuantityMatches > 0) {
      reasons.push(`${exactQuantityMatches} producto(s) con cantidad exacta`);
    }
    if (linkedOrderIds.has(orderId)) reasons.push("Orden ya vinculada a este shipment");

    return {
      orden_id: orderId,
      numero_orden: str(order.numero_orden),
      numero_pedido_agente: str(order.numero_pedido_agente),
      estado: str(order.estado),
      proveedor: firstString(rows.map((row) => relatedRecord(row.proveedores).nombre)),
      fecha_orden: dateText(order.fecha_orden),
      fecha_confirmacion: dateText(order.fecha_confirmacion),
      eta: dateText(order.eta),
      score,
      confidence: score >= 80 ? "high" : score >= 50 ? "medium" : "low",
      reasons,
      matchedProducts: matchedProductIds.length,
      shipmentUnits,
      orderUnits,
      alreadyLinked: linkedOrderIds.has(orderId),
    } satisfies LinkableOrderCandidate;
  });

  candidates.sort((a, b) => b.score - a.score);

  return {
    shipment_id: shipmentId,
    linkedOrders,
    candidates: candidates.slice(0, 50),
  };
}

export async function linkInboundShipmentToOrder(params: {
  shipmentId: string;
  ordenId: string;
  linkNotes?: string | null;
  userId: string;
}): Promise<LinkShipmentOrderResult> {
  const shipmentRows = await getShipmentRows(params.shipmentId);
  assertShipmentRows(params.shipmentId, shipmentRows);

  const { data: order, error: orderError } = await supabaseAdmin
    .from("ordenes_compra")
    .select("id")
    .eq("id", params.ordenId)
    .maybeSingle();

  if (orderError) throw new Error(orderError.message);
  if (!order) throw new Error("La orden indicada no existe.");

  await ensureAmazonInboundShipmentHeader(params.shipmentId);
  await assertCanAssignAmazonInbound({
    ordenId: params.ordenId,
    shipmentId: params.shipmentId,
  });

  const { error } = await supabaseAdmin
    .from("amazon_inbound_shipment_order_links")
    .upsert(
      {
        shipment_id: params.shipmentId,
        orden_id: params.ordenId,
        link_status: "manual_linked",
        link_notes: params.linkNotes ?? null,
        linked_at: new Date().toISOString(),
        linked_by: params.userId,
      },
      { onConflict: "shipment_id,orden_id" },
    );

  if (error) throw new Error(error.message);

  await upsertAmazonInboundAssignment({
    ordenId: params.ordenId,
    shipmentId: params.shipmentId,
    userId: params.userId,
    notes: params.linkNotes ?? null,
  });

  return {
    shipment_id: params.shipmentId,
    orden_id: params.ordenId,
    links: (await loadOrderLinks([params.shipmentId])).get(params.shipmentId) ?? [],
  };
}

export async function unlinkInboundShipmentFromOrder(params: {
  shipmentId: string;
  ordenId: string;
}): Promise<LinkShipmentOrderResult> {
  const shipmentRows = await getShipmentRows(params.shipmentId);
  assertShipmentRows(params.shipmentId, shipmentRows);

  const { error } = await supabaseAdmin
    .from("amazon_inbound_shipment_order_links")
    .delete()
    .eq("shipment_id", params.shipmentId)
    .eq("orden_id", params.ordenId);

  if (error) throw new Error(error.message);

  const { error: assignmentError } = await supabaseAdmin
    .from("orden_logistics_assignments")
    .update({ status: "inactive" })
    .eq("orden_id", params.ordenId)
    .eq("shipment_id", params.shipmentId)
    .eq("assignment_type", "amazon_inbound")
    .eq("status", "active");

  if (assignmentError) throw new Error(assignmentError.message);

  return {
    shipment_id: params.shipmentId,
    orden_id: params.ordenId,
    links: (await loadOrderLinks([params.shipmentId])).get(params.shipmentId) ?? [],
  };
}
