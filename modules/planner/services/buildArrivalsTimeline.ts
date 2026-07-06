import { supabaseAdmin } from "@/server/supabase/adminClient";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import {
  fetchPortCountryMap,
  matchesDestinationFilter,
} from "@/modules/planner/repositories/plannerDestinationsRepository";
import type {
  ArrivalDateSource,
  ArrivalMonth,
  ArrivalOrder,
  ArrivalOrderStatus,
  ArrivalsTimelineParams,
  ArrivalsTimelineResponse,
} from "@/modules/planner/types/arrivals.types";
import {
  buildArrivalProductLines,
  buildArrivalProductSummary,
} from "@/modules/planner/utils/buildArrivalProductLines";
import {
  monthKeyFromIso,
  normalizeDateOnly,
} from "@/modules/planner/utils/arrivalsDateUtils";
import { computeArrivalFlags, matchesArrivalStatusFilter } from "@/modules/planner/utils/arrivalVisualUtils";
import { resolveArrivalDestination } from "@/modules/planner/utils/resolveArrivalDestination";

type OrderRow = {
  id: string;
  numero_orden: string | null;
  numero_pedido_agente: string | null;
  estado: string;
  tipo_envio: string | null;
  destino: string | null;
  fecha_orden: string | null;
  etd: string | null;
  eta: string | null;
  lead_time_produccion: number | null;
  lead_time_transito: number | null;
};

type ProductRelation =
  | {
      id: string;
      sku: string | null;
      nombre: string | null;
      proveedor_id: string | null;
    }
  | Array<{
      id: string;
      sku: string | null;
      nombre: string | null;
      proveedor_id: string | null;
    }>
  | null;

type SupplierRelation =
  | {
      id: string;
      nombre: string | null;
      dias_produccion_estandar: number | null;
      dias_transito_estandar: number | null;
    }
  | Array<{
      id: string;
      nombre: string | null;
      dias_produccion_estandar: number | null;
      dias_transito_estandar: number | null;
    }>
  | null;

type ItemRow = {
  orden_id: string;
  producto_id: string;
  proveedor_id: string | null;
  cantidad: number | null;
  productos: ProductRelation;
  proveedores: SupplierRelation;
};

type ContainerRelation =
  | {
      id: string;
      identificador_embarque: string | null;
      estado: string | null;
      estado_logistico: string | null;
      fecha_eta_estimada: string | null;
      puerto_llegada: string | null;
      tipo_contenedor: string | null;
    }
  | Array<{
      id: string;
      identificador_embarque: string | null;
      estado: string | null;
      estado_logistico: string | null;
      fecha_eta_estimada: string | null;
      puerto_llegada: string | null;
      tipo_contenedor: string | null;
    }>
  | null;

type ContainerLinkRow = {
  orden_id: string;
  contenedor_id: string;
  contenedores: ContainerRelation;
};

type AmazonInboundRelation =
  | {
      shipment_id: string | null;
      shipment_name: string | null;
      estado_amazon: string | null;
      destination_center: string | null;
      destination_country: string | null;
      logistics_flow: string | null;
      transport_provider: string | null;
      eta_estimada: string | null;
      fecha_salida: string | null;
      fecha_entrega_real: string | null;
      tracking_number: string | null;
      agl_tracking_number: string | null;
      amazon_container_number: string | null;
      raw: Record<string, unknown> | null;
    }
  | Array<{
      shipment_id: string | null;
      shipment_name: string | null;
      estado_amazon: string | null;
      destination_center: string | null;
      destination_country: string | null;
      logistics_flow: string | null;
      transport_provider: string | null;
      eta_estimada: string | null;
      fecha_salida: string | null;
      fecha_entrega_real: string | null;
      tracking_number: string | null;
      agl_tracking_number: string | null;
      amazon_container_number: string | null;
      raw: Record<string, unknown> | null;
    }>
  | null;

type AmazonInboundAssignmentRow = {
  id: string;
  orden_id: string;
  assignment_type: string;
  contenedor_id: string | null;
  shipment_id: string | null;
  status: string;
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

type AmazonInboundLinkRow = {
  orden_id: string;
  shipment_id: string | null;
  amazon_inbound_shipments: AmazonInboundRelation;
};

type StandaloneContainerRow = {
  id: string;
  identificador_embarque: string | null;
  tipo_contenedor: string | null;
  transitario: string | null;
  puerto_salida: string | null;
  puerto_llegada: string | null;
  fecha_eta_estimada: string | null;
  estado: string | null;
  estado_logistico: string | null;
};

const CONTAINER_ETA_FIELD = "fecha_eta_estimada";

const MONTH_LABELS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function normalizeText(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function pick(value: unknown, keys: string[]): unknown {
  const record = asRecord(value);
  for (const key of keys) {
    if (record[key] != null) return record[key];
  }
  return null;
}

function formatShipFromAddress(raw: unknown): string | null {
  const address = asRecord(pick(raw, ["ShipFromAddress", "shipFromAddress"]));
  const parts = [
    pick(address, ["Name", "name"]),
    pick(address, ["City", "city"]),
    pick(address, ["DistrictOrCounty", "districtOrCounty"]),
    pick(address, ["StateOrProvinceCode", "stateOrProvinceCode"]),
    pick(address, ["CountryCode", "countryCode"]),
  ]
    .map(str)
    .filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(", ") : null;
}

function parseMonthStart(fromMonth?: string | null): Date {
  const raw = fromMonth?.trim();
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    return new Date(`${raw}-01T00:00:00.000Z`);
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildMonthSkeleton(start: Date, count: number): ArrivalMonth[] {
  return Array.from({ length: count }, (_, index) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    return {
      month: monthKey(d),
      label: MONTH_LABELS[d.getUTCMonth()],
      total: 0,
      confirmedEtaOrders: [],
      estimatedOrders: [],
      pendingDateOrders: [],
    };
  });
}

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function resolveSupplierLeadTime(items: ItemRow[]): number | null {
  let maxDays: number | null = null;

  for (const item of items) {
    const supplier = firstRelation(item.proveedores);
    const production = toPositiveInt(supplier?.dias_produccion_estandar);
    const transit = toPositiveInt(supplier?.dias_transito_estandar);
    if (production == null || transit == null) continue;

    const days = production + transit;
    maxDays = maxDays == null ? days : Math.max(maxDays, days);
  }

  return maxDays;
}

function resolveEstimatedMonthDate(
  order: OrderRow,
  items: ItemRow[],
): { estimatedMonthDate: string | null; dateSource: ArrivalDateSource } {
  const baseDate = order.etd ?? order.fecha_orden;
  if (!baseDate) {
    return { estimatedMonthDate: null, dateSource: "unknown" };
  }

  const orderProduction = toPositiveInt(order.lead_time_produccion);
  const orderTransit = toPositiveInt(order.lead_time_transito);
  if (orderProduction != null && orderTransit != null) {
    return {
      estimatedMonthDate: addDays(baseDate, orderProduction + orderTransit),
      dateSource: order.etd ? "estimated_from_etd" : "estimated_from_order_date",
    };
  }

  const supplierDays = resolveSupplierLeadTime(items);
  if (supplierDays != null) {
    return {
      estimatedMonthDate: addDays(baseDate, supplierDays),
      dateSource: "supplier_lead_time",
    };
  }

  return { estimatedMonthDate: null, dateSource: "unknown" };
}

function resolveDateState(
  order: OrderRow,
  items: ItemRow[],
  container: ContainerLinkRow | undefined,
  amazonInbound: AmazonInboundLinkRow | undefined,
): {
  etaVisible: string;
  estimatedMonthDate: string | null;
  hasDefinedEta: boolean;
  dateLabel: string;
  dateSource: ArrivalDateSource;
} {
  const containerRow = firstRelation(container?.contenedores);
  const containerEta = normalizeDateOnly(containerRow?.fecha_eta_estimada ?? null);
  if (containerEta) {
    return {
      etaVisible: containerEta,
      estimatedMonthDate: containerEta,
      hasDefinedEta: true,
      dateLabel: "ETA contenedor",
      dateSource: "container_eta",
    };
  }

  const amazonRow = firstRelation(amazonInbound?.amazon_inbound_shipments);
  const amazonEta = normalizeDateOnly(amazonRow?.eta_estimada ?? null);
  if (amazonEta) {
    return {
      etaVisible: amazonEta,
      estimatedMonthDate: amazonEta,
      hasDefinedEta: true,
      dateLabel: "ETA Amazon inbound",
      dateSource: "amazon_inbound_eta",
    };
  }

  if (order.eta) {
    return {
      etaVisible: order.eta,
      estimatedMonthDate: order.eta,
      hasDefinedEta: true,
      dateLabel: "ETA orden",
      dateSource: "order_eta",
    };
  }

  if (amazonRow || amazonInbound?.shipment_id) {
    return {
      etaVisible: "ETA no disponible en fuente Amazon actual",
      estimatedMonthDate: null,
      hasDefinedEta: false,
      dateLabel: "Pendiente de ETA Amazon",
      dateSource: "unknown",
    };
  }

  const estimated = resolveEstimatedMonthDate(order, items);
  return {
    etaVisible: "ETA sin definir",
    estimatedMonthDate: estimated.estimatedMonthDate,
    hasDefinedEta: false,
    dateLabel: estimated.estimatedMonthDate ? "Mes estimado por lead time" : "Fecha por confirmar",
    dateSource: estimated.dateSource,
  };
}

function resolveStatusFromContainerRow(
  containerRow: Pick<StandaloneContainerRow, "estado" | "estado_logistico"> | null,
  hasDefinedEta = true,
): ArrivalOrderStatus {
  const containerState = normalizeText(
    containerRow?.estado_logistico ?? containerRow?.estado ?? "",
  );

  if (containerState === "ENTREGADO" || containerState.includes("ENTREGADO")) {
    return "entregado";
  }
  if (containerState.includes("PUERTO_DESTINO")) return "en_puerto_destino";
  if (containerState.includes("TRANSITO")) return "en_transito";
  if (containerState.includes("PUERTO_SALIDA")) return "en_puerto_salida";
  if (containerState.includes("PREPARAND")) return "preparando";
  if (containerState.includes("BORRADOR")) return "borrador";
  if (!hasDefinedEta) return "pendiente_eta";
  return "confirmado";
}

function resolveStatus(
  container: ContainerLinkRow | undefined,
  hasDefinedEta: boolean,
): ArrivalOrderStatus {
  const containerRow = firstRelation(container?.contenedores);
  return resolveStatusFromContainerRow(containerRow, hasDefinedEta);
}

function formatDestinationFields(
  resolved: ReturnType<typeof resolveArrivalDestination>,
  containerType: string | null,
): Pick<ArrivalOrder, "destination" | "destinationBadge" | "destinationCountry" | "destinationChannel"> {
  const hasDestination = Boolean(resolved.destination);
  const isAmazonAgl = containerType?.trim().toLowerCase() === "amazon_agl";

  if (!hasDestination && isAmazonAgl) {
    return {
      destination: "Amazon AGL",
      destinationBadge: "Amazon AGL",
      destinationCountry: null,
      destinationChannel: "FBA",
    };
  }

  return {
    destination: resolved.destination ?? "Sin destino definido",
    destinationBadge: hasDestination ? resolved.destinationBadge : "Sin destino definido",
    destinationCountry: resolved.destinationCountry,
    destinationChannel: resolved.destinationChannel,
  };
}

function shouldIncludeArrival(
  orderDto: ArrivalOrder,
  params: ArrivalsTimelineParams,
): boolean {
  if (!matchesArrivalStatusFilter(params.status, orderDto.status)) return false;
  return matchesDestinationFilter(params.destination, {
    destinationBadge: orderDto.destinationBadge,
    destinationChannel: orderDto.destinationChannel,
    destinationCountry: orderDto.destinationCountry,
  });
}

function pushArrivalToMonth(
  orderDto: ArrivalOrder,
  monthList: ArrivalMonth[],
  monthMap: Map<string, ArrivalMonth>,
  allowedMonths: Set<string>,
  byDestination: Record<string, number>,
): void {
  const key = orderDto.estimatedMonthDate ? monthKeyFromIso(orderDto.estimatedMonthDate) : null;
  if (key && !allowedMonths.has(key)) return;

  const month = key ? monthMap.get(key) : monthList[monthList.length - 1];
  if (!month) return;

  month.total += 1;
  byDestination[orderDto.destinationBadge] = (byDestination[orderDto.destinationBadge] ?? 0) + 1;

  if (orderDto.hasDefinedEta) {
    month.confirmedEtaOrders.push(orderDto);
  } else if (orderDto.estimatedMonthDate) {
    month.estimatedOrders.push(orderDto);
  } else {
    month.pendingDateOrders.push(orderDto);
  }
}

async function loadAmazonInboundMaps(orderIds: string[]): Promise<{
  amazonAssignmentByOrderId: Map<string, AmazonInboundAssignmentRow>;
  amazonShipmentByShipmentId: Map<string, AmazonInboundShipmentRow>;
}> {
  const amazonAssignmentByOrderId = new Map<string, AmazonInboundAssignmentRow>();
  const amazonShipmentByShipmentId = new Map<string, AmazonInboundShipmentRow>();

  if (orderIds.length === 0) {
    return { amazonAssignmentByOrderId, amazonShipmentByShipmentId };
  }

  const { data: assignments, error: assignmentsError } = await supabaseAdmin
    .from("orden_logistics_assignments")
    .select("id, orden_id, assignment_type, contenedor_id, shipment_id, status")
    .in("orden_id", orderIds)
    .eq("status", "active")
    .eq("assignment_type", "amazon_inbound");

  if (assignmentsError) throw new Error(assignmentsError.message);

  const assignmentRows = (assignments ?? []) as unknown as AmazonInboundAssignmentRow[];

  if (process.env.NODE_ENV === "development") {
    console.log("[llegadas] amazon assignments raw", assignmentRows);
  }

  for (const row of assignmentRows) {
    if (row.orden_id && !amazonAssignmentByOrderId.has(row.orden_id)) {
      amazonAssignmentByOrderId.set(row.orden_id, row);
    }
  }

  const shipmentIds = Array.from(
    new Set(
      assignmentRows
        .map((row) => row.shipment_id?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

  if (shipmentIds.length === 0) {
    return { amazonAssignmentByOrderId, amazonShipmentByShipmentId };
  }

  const { data: shipments, error: shipmentsError } = await supabaseAdmin
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

  if (shipmentsError) throw new Error(shipmentsError.message);

  const shipmentRows = (shipments ?? []) as unknown as AmazonInboundShipmentRow[];

  if (process.env.NODE_ENV === "development") {
    console.log("[llegadas] amazon shipments raw", shipmentRows);
  }

  for (const shipment of shipmentRows) {
    const shipmentId = shipment.shipment_id?.trim() ?? "";
    if (shipmentId) {
      amazonShipmentByShipmentId.set(shipmentId, shipment);
    }
  }

  return { amazonAssignmentByOrderId, amazonShipmentByShipmentId };
}

function buildAmazonInboundDto(
  assignment: AmazonInboundAssignmentRow | undefined,
  shipment: AmazonInboundShipmentRow | undefined,
): ArrivalOrder["amazonInbound"] {
  if (!assignment || assignment.assignment_type !== "amazon_inbound") return null;

  const shipmentId = String(assignment.shipment_id ?? "").trim();
  if (!shipmentId) return null;

  if (!shipment && process.env.NODE_ENV === "development") {
    console.warn("[llegadas] amazon_inbound assignment sin header", {
      orderId: assignment.orden_id,
      shipmentId,
    });
  }

  return {
    shipment_id: shipmentId,
    shipment_name: shipment?.shipment_name ?? null,
    estado_amazon: shipment?.estado_amazon ?? null,
    destination_center: shipment?.destination_center ?? null,
    destination_country: shipment?.destination_country ?? null,
    logistics_flow: shipment?.logistics_flow ?? null,
    transport_provider: shipment?.transport_provider ?? null,
    eta_estimada: normalizeDateOnly(shipment?.eta_estimada ?? null),
    fecha_salida: normalizeDateOnly(shipment?.fecha_salida ?? null),
    fecha_entrega_real: normalizeDateOnly(shipment?.fecha_entrega_real ?? null),
    ship_from_address: null,
    tracking_number: shipment?.tracking_number ?? null,
    agl_tracking_number: shipment?.agl_tracking_number ?? null,
    amazon_container_number: shipment?.amazon_container_number ?? null,
  };
}

function resolveLogisticsKind(
  amazonAssignment: AmazonInboundAssignmentRow | undefined,
  hasContainerLink: boolean,
): ArrivalOrder["logisticsKind"] {
  if (amazonAssignment) return "amazon_inbound";
  if (hasContainerLink) return "contenedor_propio";
  return "none";
}

function toAmazonInboundLinkRow(
  assignment: AmazonInboundAssignmentRow | undefined,
  shipment: AmazonInboundShipmentRow | undefined,
): AmazonInboundLinkRow | undefined {
  if (!assignment || assignment.assignment_type !== "amazon_inbound") return undefined;

  return {
    orden_id: assignment.orden_id,
    shipment_id: assignment.shipment_id,
    amazon_inbound_shipments: shipment
      ? {
          ...shipment,
          raw: null,
        }
      : null,
  };
}

function buildStandaloneArrivalOrder(
  container: StandaloneContainerRow,
  portCountryByPort: Map<string, string>,
): ArrivalOrder | null {
  const etaDate = normalizeDateOnly(container.fecha_eta_estimada);
  if (!etaDate) return null;

  const resolved = resolveArrivalDestination({
    puertoLlegada: container.puerto_llegada,
    destinoOrden: null,
    tipoContenedor: container.tipo_contenedor,
    portCountryByPort,
  });
  const status = resolveStatusFromContainerRow(container, true);
  const flags = computeArrivalFlags({
    hasDefinedEta: true,
    estimatedMonthDate: etaDate,
    status,
  });
  const identificador = container.identificador_embarque?.trim() || container.id.slice(0, 8);

  return {
    orderId: container.id,
    numeroOrden: null,
    numeroPedidoAgente: null,
    proveedor: null,
    tipoEnvio: null,
    displayCode: identificador,
    productLines: [],
    productSummary: "Sin orden vinculada",
    ...formatDestinationFields(resolved, container.tipo_contenedor),
    etaVisible: etaDate,
    estimatedMonthDate: etaDate,
    hasDefinedEta: true,
    dateLabel: "ETA contenedor",
    dateSource: "container_eta",
    status,
    isDelivered: flags.isDelivered,
    isDelayed: flags.isDelayed,
    containerId: container.id,
    containerNumber: container.identificador_embarque,
    containerType: container.tipo_contenedor,
    logisticsKind: "contenedor_propio",
    amazonInbound: null,
    logisticsUrl: `/logistica?containerId=${encodeURIComponent(container.id)}`,
    ordenesCount: 0,
  };
}

export async function buildArrivalsTimeline(
  params: ArrivalsTimelineParams = {},
): Promise<ArrivalsTimelineResponse> {
  const supabase = createSupabaseRouteClient();
  const portCountryByPort = await fetchPortCountryMap(supabase);
  const start = parseMonthStart(params.fromMonth);
  const monthCount = Math.min(Math.max(params.months ?? 4, 1), 18);
  const monthList = buildMonthSkeleton(start, monthCount);
  const allowedMonths = new Set(monthList.map((m) => m.month));
  const monthMap = new Map(monthList.map((m) => [m.month, m]));
  const byDestination: Record<string, number> = {};
  const seenContainerIds = new Set<string>();
  const seenOrderIds = new Set<string>();

  const { data: rawOrders, error: orderError } = await supabase
    .from("ordenes_compra")
    .select(
      "id, numero_orden, numero_pedido_agente, estado, tipo_envio, destino, fecha_orden, etd, eta, lead_time_produccion, lead_time_transito",
    )
    .eq("estado", "confirmado")
    .order("fecha_orden", { ascending: true })
    .limit(1000);

  if (orderError) throw new Error(orderError.message);

  const orders = (rawOrders ?? []) as OrderRow[];

  if (orders.length > 0) {
    const orderIds = orders.map((order) => order.id);
    const { data: rawItems, error: itemError } = await supabase
      .from("orden_items")
      .select(
        `orden_id, producto_id, proveedor_id, cantidad,
         productos(id, sku, nombre, proveedor_id),
         proveedores(id, nombre, dias_produccion_estandar, dias_transito_estandar)`,
      )
      .in("orden_id", orderIds);

    if (itemError) throw new Error(itemError.message);

    const { data: rawContainers, error: containerError } = await supabase
      .from("contenedor_ordenes")
      .select(
        `orden_id, contenedor_id, contenedores(id, identificador_embarque, estado, estado_logistico, ${CONTAINER_ETA_FIELD}, puerto_llegada, tipo_contenedor)`,
      )
      .in("orden_id", orderIds);

    if (containerError) throw new Error(containerError.message);

    const { amazonAssignmentByOrderId, amazonShipmentByShipmentId } =
      await loadAmazonInboundMaps(orderIds);

    const items = (rawItems ?? []) as unknown as ItemRow[];
    const containerByOrder = new Map(
      ((rawContainers ?? []) as unknown as ContainerLinkRow[]).map((link) => [link.orden_id, link]),
    );

    const itemsByOrder = new Map<string, ItemRow[]>();
    for (const item of items) {
      const list = itemsByOrder.get(item.orden_id) ?? [];
      list.push(item);
      itemsByOrder.set(item.orden_id, list);
    }

    for (const order of orders) {
      if (seenOrderIds.has(order.id)) continue;

      const orderItems = itemsByOrder.get(order.id) ?? [];
      const amazonAssignment = amazonAssignmentByOrderId.get(order.id);
      const containerLink = containerByOrder.get(order.id);
      const containerRow = firstRelation(containerLink?.contenedores);
      const containerId = containerLink?.contenedor_id ?? null;
      const logisticsKind = resolveLogisticsKind(amazonAssignment, Boolean(containerLink));
      const effectiveContainerId =
        logisticsKind === "contenedor_propio" ? containerId : null;
      const amazonShipment = amazonAssignment?.shipment_id
        ? amazonShipmentByShipmentId.get(amazonAssignment.shipment_id.trim())
        : undefined;
      const amazonInboundLink = toAmazonInboundLinkRow(amazonAssignment, amazonShipment);
      const amazonInboundDto = buildAmazonInboundDto(amazonAssignment, amazonShipment);

      if (effectiveContainerId && seenContainerIds.has(effectiveContainerId)) continue;

      if (
        process.env.NODE_ENV === "development"
        && order.tipo_envio === "amazon_agl"
        && logisticsKind !== "amazon_inbound"
      ) {
        console.warn("[llegadas] amazon_agl sin assignment activo", {
          orderId: order.id,
          numeroOrden: order.numero_orden,
        });
      }

      const dateState = resolveDateState(order, orderItems, containerLink, amazonInboundLink);
      const resolved = resolveArrivalDestination({
        puertoLlegada: containerRow?.puerto_llegada ?? amazonInboundDto?.destination_center ?? null,
        destinoOrden: order.destino,
        tipoContenedor:
          containerRow?.tipo_contenedor
          ?? (logisticsKind === "amazon_inbound" ? "amazon_agl" : null),
        portCountryByPort,
      });
      const status = resolveStatus(containerLink, dateState.hasDefinedEta);
      const flags = computeArrivalFlags({
        hasDefinedEta: dateState.hasDefinedEta,
        estimatedMonthDate: dateState.estimatedMonthDate,
        status,
      });
      const productLines = buildArrivalProductLines(orderItems);
      const proveedor =
        orderItems
          .map((item) => firstRelation(item.proveedores)?.nombre ?? null)
          .find((name): name is string => Boolean(name)) ?? null;

      const orderDto: ArrivalOrder = {
        orderId: order.id,
        numeroOrden: order.numero_orden,
        numeroPedidoAgente: order.numero_pedido_agente,
        proveedor,
        tipoEnvio: order.tipo_envio,
        displayCode: order.numero_pedido_agente || order.numero_orden || order.id.slice(0, 8),
        productLines,
        productSummary: buildArrivalProductSummary(productLines),
        ...formatDestinationFields(resolved, containerRow?.tipo_contenedor ?? null),
        etaVisible: dateState.etaVisible,
        estimatedMonthDate: dateState.estimatedMonthDate,
        hasDefinedEta: dateState.hasDefinedEta,
        dateLabel: dateState.dateLabel,
        dateSource: dateState.dateSource,
        status,
        isDelivered: flags.isDelivered,
        isDelayed: flags.isDelayed,
        containerId: effectiveContainerId,
        containerNumber: containerRow?.identificador_embarque ?? null,
        containerType: containerRow?.tipo_contenedor ?? null,
        logisticsKind,
        amazonInbound: logisticsKind === "amazon_inbound" ? amazonInboundDto : null,
        logisticsUrl:
          logisticsKind === "contenedor_propio" && effectiveContainerId
            ? `/logistica?containerId=${encodeURIComponent(effectiveContainerId)}`
            : amazonInboundDto?.shipment_id
              ? `/amazon/envios?shipmentId=${encodeURIComponent(amazonInboundDto.shipment_id)}`
              : null,
        ordenesCount: effectiveContainerId ? 1 : undefined,
      };

      if (
        process.env.NODE_ENV === "development"
        && (order.numero_pedido_agente === "BM-2616" || order.numero_orden === "ORD-2026-011")
      ) {
        console.log("[llegadas] BM-2616 mapped", {
          orderId: orderDto.orderId,
          numeroOrden: orderDto.numeroOrden,
          numeroPedidoAgente: orderDto.numeroPedidoAgente,
          tipoEnvio: orderDto.tipoEnvio,
          logisticsKind: orderDto.logisticsKind,
          amazonInbound: orderDto.amazonInbound,
        });
      }

      if (!shouldIncludeArrival(orderDto, params)) continue;

      seenOrderIds.add(order.id);
      if (effectiveContainerId) seenContainerIds.add(effectiveContainerId);

      pushArrivalToMonth(orderDto, monthList, monthMap, allowedMonths, byDestination);
    }
  }

  const { data: rawStandalone, error: standaloneError } = await supabase
    .from("contenedores")
    .select(
      `id, identificador_embarque, tipo_contenedor, transitario,
       puerto_salida, puerto_llegada, fecha_eta_estimada, estado, estado_logistico`,
    )
    .not("fecha_eta_estimada", "is", null);

  if (standaloneError) throw new Error(standaloneError.message);

  for (const row of (rawStandalone ?? []) as StandaloneContainerRow[]) {
    if (seenContainerIds.has(row.id)) continue;

    const orderDto = buildStandaloneArrivalOrder(row, portCountryByPort);
    if (!orderDto) continue;
    if (!shouldIncludeArrival(orderDto, params)) continue;

    seenContainerIds.add(row.id);
    pushArrivalToMonth(orderDto, monthList, monthMap, allowedMonths, byDestination);
  }

  for (const month of monthList) {
    const sorter = (a: ArrivalOrder, b: ArrivalOrder) =>
      (a.estimatedMonthDate ?? "9999-99-99").localeCompare(b.estimatedMonthDate ?? "9999-99-99");
    month.confirmedEtaOrders.sort(sorter);
    month.estimatedOrders.sort(sorter);
    month.pendingDateOrders.sort((a, b) => a.displayCode.localeCompare(b.displayCode));
  }

  return {
    ok: true,
    summary: {
      totalOrders: monthList.reduce((sum, month) => sum + month.total, 0),
      byDestination,
      byMonth: monthList.map((month) => ({ month: month.month, total: month.total })),
    },
    months: monthList,
  };
}
