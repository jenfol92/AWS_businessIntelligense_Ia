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

  if (order.eta) {
    return {
      etaVisible: order.eta,
      estimatedMonthDate: order.eta,
      hasDefinedEta: true,
      dateLabel: "ETA orden",
      dateSource: "order_eta",
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
): Pick<ArrivalOrder, "destination" | "destinationBadge" | "destinationCountry" | "destinationChannel"> {
  const hasDestination = Boolean(resolved.destination);
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
    displayCode: identificador,
    productLines: [],
    productSummary: "Sin orden vinculada",
    ...formatDestinationFields(resolved),
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
      "id, numero_orden, numero_pedido_agente, estado, destino, fecha_orden, etd, eta, lead_time_produccion, lead_time_transito",
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
      const container = containerByOrder.get(order.id);
      const containerId = container?.contenedor_id ?? null;

      if (containerId && seenContainerIds.has(containerId)) continue;

      const dateState = resolveDateState(order, orderItems, container);
      const containerRow = firstRelation(container?.contenedores);
      const resolved = resolveArrivalDestination({
        puertoLlegada: containerRow?.puerto_llegada ?? null,
        destinoOrden: order.destino,
        tipoContenedor: containerRow?.tipo_contenedor ?? null,
        portCountryByPort,
      });
      const status = resolveStatus(container, dateState.hasDefinedEta);
      const flags = computeArrivalFlags({
        hasDefinedEta: dateState.hasDefinedEta,
        estimatedMonthDate: dateState.estimatedMonthDate,
        status,
      });
      const productLines = buildArrivalProductLines(orderItems);

      const orderDto: ArrivalOrder = {
        orderId: order.id,
        numeroOrden: order.numero_orden,
        numeroPedidoAgente: order.numero_pedido_agente,
        displayCode: order.numero_pedido_agente || order.numero_orden || order.id.slice(0, 8),
        productLines,
        productSummary: buildArrivalProductSummary(productLines),
        ...formatDestinationFields(resolved),
        etaVisible: dateState.etaVisible,
        estimatedMonthDate: dateState.estimatedMonthDate,
        hasDefinedEta: dateState.hasDefinedEta,
        dateLabel: dateState.dateLabel,
        dateSource: dateState.dateSource,
        status,
        isDelivered: flags.isDelivered,
        isDelayed: flags.isDelayed,
        containerId,
        containerNumber: containerRow?.identificador_embarque ?? null,
        logisticsUrl: containerId ? `/logistica?containerId=${encodeURIComponent(containerId)}` : null,
        ordenesCount: containerId ? 1 : undefined,
      };

      if (!shouldIncludeArrival(orderDto, params)) continue;

      seenOrderIds.add(order.id);
      if (containerId) seenContainerIds.add(containerId);

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
