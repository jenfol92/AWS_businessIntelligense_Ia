import { extractTwinlySkuFromSellerSku } from "@/modules/imports/shared/twinlySku";
import {
  buildAmazonInboundShipmentsDiagnostic,
  type AmazonInboundShipmentDiagnostic,
} from "@/modules/amazon-sp-api/inboundShipmentsDiagnosticService";
import { supabaseAdmin } from "@/server/supabase/adminClient";

type RawRecord = Record<string, unknown>;

export type ContainerAmazonLinkSuggestedStatus =
  | "LINKED"
  | "SUGGESTED_STRONG"
  | "SUGGESTED"
  | "PENDIENTE_CONCILIAR"
  | "POSIBLE_LOTE_ANTERIOR"
  | "DESCUADRE_FECHAS"
  | "DESCUADRE_CANTIDAD"
  | "SIN_SHIPMENT_AMAZON";

export type ContainerAmazonLinkDiagnostic = {
  status: ContainerAmazonLinkSuggestedStatus;
  score: number;
  reasons: string[];
  container: {
    id: string;
    identificador_embarque: string | null;
    tipo_contenedor: string | null;
    estado_logistico: string | null;
    estado_stock: string | null;
    fecha_eta_estimada: string | null;
    amazon_shipment_id: string | null;
    amazon_reference_id: string | null;
    agl_tracking_number: string | null;
    amazon_link_status: string | null;
    expected_units: number;
    product_ids: string[];
    skus: string[];
  };
  shipment: {
    amazon_shipment_id: string | null;
    amazon_inbound_plan_id: string | null;
    amazon_reference_id: string | null;
    shipment_name: string | null;
    status: string | null;
    destination_fc: string | null;
    created_at_amazon: string | null;
    updated_at_amazon: string | null;
    expected_units: number;
    located_units: number;
  } | null;
  matched_by: string[];
};

export type ContainerAmazonLinksDiagnosticResult = {
  ok: true;
  amazon_source: ReturnType<typeof buildAmazonInboundShipmentsDiagnostic> extends Promise<
    infer R
  >
    ? R extends { source: infer S }
      ? S
      : string
    : string;
  api_attempts: Awaited<
    ReturnType<typeof buildAmazonInboundShipmentsDiagnostic>
  >["api_attempts"];
  links: ContainerAmazonLinkDiagnostic[];
  unmatched_shipments: AmazonInboundShipmentDiagnostic[];
};

type ContainerRow = {
  id: string;
  identificador_embarque: string | null;
  tipo_contenedor: string | null;
  estado: string | null;
  estado_logistico: string | null;
  estado_stock: string | null;
  fecha_eta_estimada: string | null;
  amazon_shipment_id: string | null;
  amazon_reference_id: string | null;
  agl_tracking_number: string | null;
  amazon_link_status: string | null;
  fecha_salida: string | null;
  puerto_llegada: string | null;
  transitario: string | null;
  notas: string | null;
};

type ContainerCandidate = ContainerRow & {
  order_refs: string[];
  items: Array<{
    producto_id: string;
    sku: string | null;
    sku_limpio: string | null;
    cantidad: number;
  }>;
};

function str(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const aTime = new Date(a).getTime();
  const bTime = new Date(b).getTime();
  if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) return null;
  return Math.round((aTime - bTime) / 86_400_000);
}

function normalizeReference(value: string | null): string | null {
  return value?.replace(/[^a-z0-9]/gi, "").toLowerCase() || null;
}

function isLinkedStatus(value: string | null): boolean {
  const normalized = normalizeReference(value);
  return normalized === "linked" || normalized === "vinculado" || normalized === "linkado";
}

function rawContainsReference(raw: unknown, reference: string | null): boolean {
  const normalizedReference = normalizeReference(reference);
  if (!normalizedReference) return false;
  const normalizedRaw = normalizeReference(JSON.stringify(raw ?? ""));
  return Boolean(normalizedRaw?.includes(normalizedReference));
}

function expectedUnits(container: ContainerCandidate): number {
  return container.items.reduce((sum, item) => sum + item.cantidad, 0);
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function shipmentProductIds(shipment: AmazonInboundShipmentDiagnostic): string[] {
  return unique(shipment.items.map((item) => item.producto_id));
}

function shipmentSkus(shipment: AmazonInboundShipmentDiagnostic): string[] {
  return unique(
    shipment.items.flatMap((item) => [
      item.sku_limpio,
      item.seller_sku ? extractTwinlySkuFromSellerSku(item.seller_sku) : null,
      item.seller_sku,
    ]),
  );
}

function summarizeContainer(container: ContainerCandidate) {
  return {
    id: container.id,
    identificador_embarque: container.identificador_embarque,
    tipo_contenedor: container.tipo_contenedor,
    estado_logistico: container.estado_logistico ?? container.estado,
    estado_stock: container.estado_stock,
    fecha_eta_estimada: container.fecha_eta_estimada,
    amazon_shipment_id: container.amazon_shipment_id,
    amazon_reference_id: container.amazon_reference_id,
    agl_tracking_number: container.agl_tracking_number,
    amazon_link_status: container.amazon_link_status,
    expected_units: expectedUnits(container),
    product_ids: unique(container.items.map((item) => item.producto_id)),
    skus: unique(container.items.flatMap((item) => [item.sku_limpio, item.sku])),
  };
}

function summarizeShipment(shipment: AmazonInboundShipmentDiagnostic) {
  return {
    amazon_shipment_id: shipment.amazon_shipment_id,
    amazon_inbound_plan_id: shipment.amazon_inbound_plan_id,
    amazon_reference_id: shipment.amazon_reference_id,
    shipment_name: shipment.shipment_name,
    status: shipment.status,
    destination_fc: shipment.destination_fc,
    created_at_amazon: shipment.created_at_amazon,
    updated_at_amazon: shipment.updated_at_amazon,
    expected_units: shipment.expected_units,
    located_units: shipment.located_units,
  };
}

function scoreLink(
  container: ContainerCandidate,
  shipment: AmazonInboundShipmentDiagnostic,
  duplicateProductQuantityKeys: Set<string>,
): ContainerAmazonLinkDiagnostic {
  const matched_by: string[] = [];
  const reasons: string[] = [];
  let score = 0;

  const containerShipmentId = normalizeReference(container.amazon_shipment_id);
  const shipmentId = normalizeReference(shipment.amazon_shipment_id);
  if (containerShipmentId && shipmentId && containerShipmentId === shipmentId) {
    score += 100;
    matched_by.push("amazon_shipment_id");
    reasons.push("amazon_shipment_id del contenedor coincide con shipment Amazon.");
  }

  const containerReferenceId = normalizeReference(container.amazon_reference_id);
  const shipmentReferenceId = normalizeReference(shipment.amazon_reference_id);
  if (containerReferenceId && shipmentReferenceId && containerReferenceId === shipmentReferenceId) {
    score += 90;
    matched_by.push("amazon_reference_id");
    reasons.push("amazon_reference_id del contenedor coincide con reference Amazon.");
  }

  if (rawContainsReference(shipment.raw, container.agl_tracking_number)) {
    score += 85;
    matched_by.push("agl_tracking_number");
    reasons.push("agl_tracking_number aparece en el payload/transporte Amazon.");
  }

  const legacyIdentifier = normalizeReference(container.identificador_embarque);
  if (
    legacyIdentifier &&
    legacyIdentifier.startsWith("fba") &&
    shipmentId &&
    legacyIdentifier === shipmentId
  ) {
    score += 75;
    matched_by.push("legacy_identificador_embarque_fba");
    reasons.push("identificador_embarque legacy FBA coincide con shipment_id.");
  }

  const containerProducts = new Set(summarizeContainer(container).product_ids);
  const shipmentProducts = new Set(shipmentProductIds(shipment));
  const sharedProducts = Array.from(containerProducts).filter((id) =>
    shipmentProducts.has(id),
  );
  if (sharedProducts.length > 0) {
    score += Math.min(12, sharedProducts.length * 4);
    matched_by.push("producto_id");
    reasons.push(`Productos coincidentes: ${sharedProducts.length}.`);
  }

  const containerSkus = new Set(summarizeContainer(container).skus);
  const sharedSkus = shipmentSkus(shipment).filter((sku) => containerSkus.has(sku));
  if (sharedSkus.length > 0) {
    score += Math.min(10, sharedSkus.length * 4);
    matched_by.push("sku");
    reasons.push(`SKUs coincidentes: ${sharedSkus.join(", ")}.`);
  }

  const containerQty = expectedUnits(container);
  const shipmentQty = shipment.expected_units || shipment.located_units;
  const qtyDiff = Math.abs(containerQty - shipmentQty);
  const qtyTolerance = Math.max(2, Math.round(containerQty * 0.03));
  if (containerQty > 0 && shipmentQty > 0 && qtyDiff <= qtyTolerance) {
    score += 8;
    matched_by.push("cantidad");
    reasons.push(`Cantidad compatible: contenedor ${containerQty}, Amazon ${shipmentQty}.`);
  } else if (shipmentQty > 0 && sharedProducts.length > 0) {
    reasons.push(`Cantidad distinta: contenedor ${containerQty}, Amazon ${shipmentQty}.`);
  }

  const daysToEta = daysBetween(
    container.fecha_eta_estimada,
    shipment.updated_at_amazon ?? shipment.created_at_amazon,
  );
  if (daysToEta != null) {
    matched_by.push("fechas");
    if (daysToEta >= 0) {
      score += daysToEta <= 60 ? 5 : 1;
      reasons.push(`Amazon snapshot antes/de ETA del contenedor (${daysToEta} dias).`);
    } else {
      reasons.push(`Amazon snapshot posterior a ETA del contenedor (${Math.abs(daysToEta)} dias).`);
    }
  }

  const strongMatched = matched_by.some((match) =>
    [
      "amazon_shipment_id",
      "amazon_reference_id",
      "agl_tracking_number",
      "legacy_identificador_embarque_fba",
    ].includes(match),
  );
  const weakMatchedOnly =
    !strongMatched &&
    matched_by.some((match) => ["producto_id", "sku", "cantidad"].includes(match));
  const duplicateKeys = container.items
    .map((item) => `${item.producto_id}:${item.cantidad}`)
    .filter((key) => duplicateProductQuantityKeys.has(key));
  if (duplicateKeys.length > 0 && weakMatchedOnly) {
    reasons.push(
      "Hay varios contenedores AGL con el mismo producto y cantidad; hace falta shipment_id/reference/tracking para vincular.",
    );
  }

  let status: ContainerAmazonLinkSuggestedStatus = "PENDIENTE_CONCILIAR";
  if (matched_by.includes("amazon_shipment_id")) {
    status = isLinkedStatus(container.amazon_link_status) ? "LINKED" : "SUGGESTED_STRONG";
  } else if (strongMatched) {
    status = "SUGGESTED_STRONG";
  } else if (duplicateKeys.length > 0 && weakMatchedOnly) {
    status = "PENDIENTE_CONCILIAR";
  } else if (score >= 25 && weakMatchedOnly) {
    status = "SUGGESTED";
  } else if (sharedProducts.length > 0 && shipmentQty > 0 && qtyDiff > qtyTolerance) {
    status = "DESCUADRE_CANTIDAD";
  } else if (daysToEta != null && daysToEta < -14 && sharedProducts.length > 0) {
    status = "POSIBLE_LOTE_ANTERIOR";
  } else if (daysToEta != null && Math.abs(daysToEta) > 90 && sharedProducts.length > 0) {
    status = "DESCUADRE_FECHAS";
  }

  return {
    status,
    score,
    reasons,
    container: summarizeContainer(container),
    shipment: summarizeShipment(shipment),
    matched_by,
  };
}

async function loadAglContainers(): Promise<ContainerCandidate[]> {
  const { data: containersData, error: containersError } = await supabaseAdmin
    .from("contenedores")
    .select(
      "id, identificador_embarque, tipo_contenedor, estado, estado_logistico, estado_stock, fecha_eta_estimada, amazon_shipment_id, amazon_reference_id, agl_tracking_number, amazon_link_status, fecha_salida, puerto_llegada, transitario, notas",
    )
    .eq("tipo_contenedor", "amazon_agl")
    .or("estado_logistico.is.null,estado_logistico.neq.entregado")
    .order("fecha_eta_estimada", { ascending: true, nullsFirst: false })
    .limit(100);

  if (containersError) throw new Error(containersError.message);
  const containers = (containersData ?? []) as ContainerRow[];
  const containerIds = containers.map((container) => container.id);
  if (containerIds.length === 0) return [];

  const { data: linksData, error: linksError } = await supabaseAdmin
    .from("contenedor_ordenes")
    .select("contenedor_id, orden_id, ordenes_compra(id, numero_orden, numero_pedido_agente)")
    .in("contenedor_id", containerIds);

  if (linksError) throw new Error(linksError.message);

  const links = (linksData ?? []) as Array<RawRecord>;
  const orderIds = unique(links.map((link) => str(link.orden_id)));
  const linksByContainer = new Map<string, RawRecord[]>();
  for (const link of links) {
    const containerId = str(link.contenedor_id);
    if (!containerId) continue;
    const current = linksByContainer.get(containerId) ?? [];
    current.push(link);
    linksByContainer.set(containerId, current);
  }

  const { data: itemsData, error: itemsError } =
    orderIds.length > 0
      ? await supabaseAdmin
          .from("orden_items")
          .select("orden_id, producto_id, cantidad, productos(sku)")
          .in("orden_id", orderIds)
      : { data: [], error: null };

  if (itemsError) throw new Error(itemsError.message);

  const itemsByOrder = new Map<string, RawRecord[]>();
  for (const item of (itemsData ?? []) as RawRecord[]) {
    const orderId = str(item.orden_id);
    if (!orderId) continue;
    const current = itemsByOrder.get(orderId) ?? [];
    current.push(item);
    itemsByOrder.set(orderId, current);
  }

  return containers.map((container) => {
    const containerLinks = linksByContainer.get(container.id) ?? [];
    const orderRefs = containerLinks.flatMap((link) => {
      const order = Array.isArray(link.ordenes_compra)
        ? link.ordenes_compra[0]
        : link.ordenes_compra;
      return [str(asRecord(order).numero_orden), str(asRecord(order).numero_pedido_agente)];
    });
    const items = containerLinks.flatMap((link) => {
      const orderId = str(link.orden_id);
      return orderId ? itemsByOrder.get(orderId) ?? [] : [];
    });

    return {
      ...container,
      order_refs: unique(orderRefs),
      items: items.map((item) => {
        const product = Array.isArray(item.productos)
          ? item.productos[0]
          : item.productos;
        const sku = str(asRecord(product).sku);
        return {
          producto_id: String(item.producto_id),
          sku,
          sku_limpio: sku ? extractTwinlySkuFromSellerSku(sku) ?? sku : null,
          cantidad: num(item.cantidad),
        };
      }),
    };
  });
}

function duplicateProductQuantityKeys(containers: ContainerCandidate[]): Set<string> {
  const counts = new Map<string, number>();
  for (const container of containers) {
    const keys = unique(
      container.items.map((item) => `${item.producto_id}:${item.cantidad}`),
    );
    for (const key of keys) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  );
}

export async function buildContainerAmazonLinksDiagnostic(params: {
  limit?: number;
  lastUpdatedAfter?: string | null;
} = {}): Promise<ContainerAmazonLinksDiagnosticResult> {
  const [amazon, containers] = await Promise.all([
    buildAmazonInboundShipmentsDiagnostic(params),
    loadAglContainers(),
  ]);

  const links: ContainerAmazonLinkDiagnostic[] = [];
  const matchedShipmentIds = new Set<string>();
  const duplicateKeys = duplicateProductQuantityKeys(containers);

  for (const container of containers) {
    const candidates = amazon.shipments
      .map((shipment) => scoreLink(container, shipment, duplicateKeys))
      .filter((link) => link.score > 0)
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      links.push({
        status: "SIN_SHIPMENT_AMAZON",
        score: 0,
        reasons: ["No se ha encontrado shipment Amazon candidato para este contenedor AGL."],
        container: summarizeContainer(container),
        shipment: null,
        matched_by: [],
      });
      continue;
    }

    const best = candidates[0];
    links.push(best);
    if (best.shipment?.amazon_shipment_id) {
      matchedShipmentIds.add(best.shipment.amazon_shipment_id);
    }
  }

  return {
    ok: true,
    amazon_source: amazon.source,
    api_attempts: amazon.api_attempts,
    links,
    unmatched_shipments: amazon.shipments.filter(
      (shipment) =>
        !shipment.amazon_shipment_id || !matchedShipmentIds.has(shipment.amazon_shipment_id),
    ),
  };
}

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}
