/**
 * Modulo: Amazon AGL.
 * Responsabilidad: mostrar envios inbound sincronizados desde Seller Central
 * y permitir lanzar la sincronizacion manual hacia `amazon_envios`.
 * No debe vincular contenedores, crear envios Amazon ni tocar stock.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";

type AmazonInboundProduct = {
  id: string;
  sku: string | null;
  nombre: string | null;
  imagen_url: string | null;
};

type AmazonInboundItem = {
  id: string | null;
  sku: string | null;
  seller_sku_original: string | null;
  sku_limpio: string | null;
  match_candidates: string[];
  matched_by: string | null;
  date_source: string | null;
  resolved_shipment_date: string | null;
  producto_id: string | null;
  producto: AmazonInboundProduct | null;
  cantidad_enviada: number;
  cantidad_recibida: number;
  cantidad_esperada: number;
  cantidad_localizada: number;
};

type AmazonInboundShipment = {
  shipment_id: string;
  shipment_name: string | null;
  reference_id: string | null;
  inbound_plan_id: string | null;
  logistics_flow: string | null;
  transport_provider: string | null;
  estado: string | null;
  transport_status: string | null;
  destination_country: string | null;
  destination_center: string | null;
  fecha_creacion: string | null;
  fecha_cerrado: string | null;
  imported_at: string | null;
  date_source: string | null;
  resolved_shipment_date: string | null;
  total_skus: number;
  total_cantidad_enviada: number;
  total_cantidad_recibida: number;
  total_cantidad_esperada: number;
  total_cantidad_localizada: number;
  productsMatched: number;
  productsUnmatched: number;
  contenedor_id: string | null;
  link_status: string | null;
  link_confidence: number | null;
  visible_logistics: AmazonShipmentVisibleLogistics;
  header: AmazonInboundShipmentHeader | null;
  documents_count: number;
  costs_count: number;
  costs_total: number;
  amazon_v0?: AmazonInboundShipmentV0Details | null;
  linked_orders: ShipmentOrderLink[];
  items: AmazonInboundItem[];
};

type VisibleLogisticsField = {
  value: string | null;
  source: "amazon" | "contenedor_erp" | "no_aplica" | "no_disponible";
  label: string;
};

type AmazonShipmentVisibleLogistics = {
  eta: VisibleLogisticsField;
  etd: VisibleLogisticsField;
  tracking: VisibleLogisticsField;
  carrier: VisibleLogisticsField;
  containerNumber: VisibleLogisticsField;
  containerApplicability: "aplica" | "no_aplica" | "desconocido";
};

type AmazonInboundShipmentV0Details = {
  ship_from_name: string | null;
  ship_from_city: string | null;
  ship_from_district_or_county: string | null;
  ship_from_state_or_province_code: string | null;
  ship_from_country_code: string | null;
  destination_fulfillment_center_id: string | null;
  shipment_status: string | null;
  label_prep_type: string | null;
  box_contents_source: string | null;
};

type AmazonInboundShipmentHeader = {
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
};

type ShipmentOrderLink = {
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

type LinkableOrderCandidate = {
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

type LinkableContainer = {
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

type ListResponse = {
  ok?: boolean;
  shipments?: AmazonInboundShipment[];
  closedCount?: number;
  hiddenClosedCount?: number;
  error?: string;
};

type SyncResponse = {
  ok?: boolean;
  summary?: {
    diagnosticSource: string;
    shipmentsProcessed: number;
    linesUpserted: number;
    productsMatched: number;
    productsUnmatched: number;
    effectiveLastUpdatedAfter: string;
    effectiveLastUpdatedBefore: string | null;
    syncYear: number | null;
    includeClosedCurrentYear: boolean;
    includeReadyToShip: boolean;
    includeClosed: boolean;
    skippedByDate: number;
    skippedByStatus: number;
    skippedByMissingDate: number;
    dateResolvedFromRaw: number;
    dateResolvedFromShipmentName: number;
    activeWithoutDateImported: number;
    deletedUnlinkedRows: number;
    cleanupSkippedByExistingLinks: boolean;
    v2024RelationsMatched: number;
    v2024ShipmentsFetched: number;
    v2024TransportationOptionsRequests: number;
    v2024TransportationOptionsFetched: number;
    warnings: string[];
    errors: string[];
  };
  error?: string;
};

type V2024EnrichmentResponse = {
  ok?: boolean;
  result?: {
    shipmentId: string;
    searchedShipmentIds: string[];
    inboundPlanPagesScanned: number;
    plansScanned: number;
    plansRead: number;
    internalShipmentsChecked: number;
    getInboundPlanCalls: number;
    getShipmentCalls: number;
    relationsMatched: number;
    enriched: string[];
    notFound: string[];
    shipmentsFetched: number;
    transportationOptionsRequests: number;
    transportationOptionsFetched: number;
    quotaExceededCount: number;
    warnings: string[];
  };
  error?: string;
};

type LinkableContainersResponse = {
  ok?: boolean;
  containers?: LinkableContainer[];
  error?: string;
};

type LinkResponse = {
  ok?: boolean;
  shipment_id?: string;
  contenedor_id?: string | null;
  linesLinked?: number;
  skusLinked?: number;
  error?: string;
};

type LinkableOrdersResponse = {
  ok?: boolean;
  shipment_id?: string;
  linkedOrders?: ShipmentOrderLink[];
  candidates?: LinkableOrderCandidate[];
  error?: string;
};

type OrderLinkResponse = {
  ok?: boolean;
  shipment_id?: string;
  orden_id?: string;
  links?: ShipmentOrderLink[];
  error?: string;
};


function formatNumber(value: number): string {
  return Number(value ?? 0).toLocaleString("es-ES");
}

function currentYear(): number {
  return new Date().getFullYear();
}

function statusKey(value: string | null): string {
  return value?.trim().toUpperCase() ?? "";
}

function statusLabel(value: string | null): string {
  switch (statusKey(value)) {
    case "WORKING":
    case "READY_TO_SHIP":
      return "Listo para enviar";
    case "SHIPPED":
    case "IN_TRANSIT":
      return "En transito";
    case "CHECKED_IN":
    case "RECEIVING":
      return "Recibiendo";
    case "DELIVERED":
      return "Entregado";
    case "CLOSED":
      return "Cerrado";
    default:
      return value?.trim() || "Sin estado";
  }
}

function statusBucket(value: string | null):
  | "ready"
  | "transit"
  | "receiving"
  | "closed"
  | "other" {
  switch (statusKey(value)) {
    case "WORKING":
    case "READY_TO_SHIP":
      return "ready";
    case "SHIPPED":
    case "IN_TRANSIT":
    case "DELIVERED":
      return "transit";
    case "CHECKED_IN":
    case "RECEIVING":
      return "receiving";
    case "CLOSED":
      return "closed";
    default:
      return "other";
  }
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString("es-ES");
}

function amazonValue(value: string | null | undefined): string {
  return value?.trim() || "Dato no disponible en la fuente Amazon actual.";
}

function visibleValue(field: VisibleLogisticsField | null | undefined): string {
  return field?.label?.trim() || "Dato no disponible en la fuente actual";
}

function visibleDate(field: VisibleLogisticsField | null | undefined): string {
  if (!field?.value) return visibleValue(field);
  return formatDate(field.value);
}

function shipFromAddressText(value: AmazonInboundShipmentV0Details | null | undefined): string {
  if (!value) return "Dato no disponible en la fuente Amazon actual.";
  return [
    value.ship_from_name,
    value.ship_from_city,
    value.ship_from_district_or_county,
    value.ship_from_state_or_province_code,
    value.ship_from_country_code,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" | ") || "Dato no disponible en la fuente Amazon actual.";
}

function dateSourceLabel(value: string | null): string {
  if (value === "shipment_name") return "nombre shipment";
  if (value?.startsWith("raw.")) return "datos Amazon";
  if (value === "updated_at_amazon") return "ultima actualizacion Amazon";
  if (value === "created_at_amazon") return "creacion Amazon";
  return value ?? "-";
}

function matchLabel(value: string | null): string {
  switch (value) {
    case "productos.sku":
      return "Producto identificado por SKU ERP";
    case "productos.sku_normalizado":
    case "productos.sku_normalized":
      return "Producto identificado por SKU ERP normalizado";
    case "producto_logistica.ean_upc":
      return "Producto identificado por EAN/UPC";
    case "producto_logistica.ean_upc_normalizado":
      return "Producto identificado por EAN/UPC normalizado";
    default:
      return value ? "Producto identificado" : "Producto identificado";
  }
}

function v2024StatusLabel(shipment: AmazonInboundShipment): {
  label: string;
  className: string;
} {
  if (shipment.header?.inbound_plan_id && shipment.header.amazon_shipment_id) {
    return {
      label: "Relacion v2024 encontrada",
      className: "bg-emerald-50 text-emerald-700",
    };
  }
  const enrichment =
    shipment.header?.v2024_enrichment &&
    typeof shipment.header.v2024_enrichment === "object"
      ? (shipment.header.v2024_enrichment as { v2024Status?: string })
      : null;
  if (enrichment?.v2024Status === "quota_exceeded") {
    return {
      label: "Cuota Amazon agotada temporalmente",
      className: "bg-red-50 text-red-700",
    };
  }
  if (enrichment?.v2024Status === "not_found") {
    return {
      label: "Sin relacion v2024",
      className: "bg-amber-50 text-amber-700",
    };
  }
  if (shipment.header?.v2024_enrichment) {
    return {
      label: "Relacion v2024 parcial",
      className: "bg-amber-50 text-amber-700",
    };
  }
  return {
    label: "Enrichment no ejecutado",
    className: "bg-slate-50 text-slate-500",
  };
}

function logisticsFlowValue(shipment: AmazonInboundShipment): string | null {
  return shipment.header?.logistics_flow ?? shipment.logistics_flow ?? null;
}

function logisticsFlowLabel(value: string | null): string {
  switch (value) {
    case "fabrica_a_amazon":
    case "proveedor_a_amazon":
      return "Fábrica → Amazon";
    case "almacen_a_amazon":
      return "Almacén → Amazon";
    case "amazon_agl":
      return "Amazon AGL";
    default:
      return "Amazon inbound";
  }
}

function logisticsFlowClass(value: string | null): string {
  switch (value) {
    case "fabrica_a_amazon":
    case "proveedor_a_amazon":
      return "bg-amber-50 text-amber-700";
    case "almacen_a_amazon":
      return "bg-emerald-50 text-emerald-700";
    case "amazon_agl":
      return "bg-blue-50 text-blue-700";
    default:
      return "bg-slate-50 text-slate-500";
  }
}

function transportProviderValue(shipment: AmazonInboundShipment): string | null {
  return shipment.header?.transport_provider ?? shipment.transport_provider ?? null;
}

function transportProviderLabel(value: string | null): string | null {
  switch (value) {
    case "amazon_agl":
      return "Amazon AGL";
    case "propio":
    case "fabrica":
    case "transitario":
    case "desconocido":
      return "Logística propia";
    default:
      return null;
  }
}

function isFactoryToAmazonFlow(value: string | null): boolean {
  return value === "fabrica_a_amazon" || value === "proveedor_a_amazon";
}

function shipmentLogisticsLabel(shipment: AmazonInboundShipment): string {
  const route = logisticsFlowLabel(logisticsFlowValue(shipment));
  const transport = transportProviderLabel(transportProviderValue(shipment));
  return transport ? `${route} · ${transport}` : route;
}


export default function AmazonEnviosPage() {
  const [shipments, setShipments] = useState<AmazonInboundShipment[]>([]);
  const [selectedYear, setSelectedYear] = useState(currentYear());
  const [includeClosed, setIncludeClosed] = useState(true);
  const [closedCount, setClosedCount] = useState(0);
  const [hiddenClosedCount, setHiddenClosedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [enrichingShipmentId, setEnrichingShipmentId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [containersLoading, setContainersLoading] = useState(false);
  const [linkableContainers, setLinkableContainers] = useState<LinkableContainer[]>([]);
  const [linkModalShipment, setLinkModalShipment] =
    useState<AmazonInboundShipment | null>(null);
  const [orderModalShipment, setOrderModalShipment] =
    useState<AmazonInboundShipment | null>(null);
  const [selectedContainerId, setSelectedContainerId] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [linkNotes, setLinkNotes] = useState("");
  const [orderCandidates, setOrderCandidates] = useState<LinkableOrderCandidate[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [orderFilter, setOrderFilter] = useState("ALL");
  const [docsFilter, setDocsFilter] = useState("ALL");
  const [search, setSearch] = useState("");
    useState<AmazonInboundShipment | null>(null);
  const [documentModalShipment, setDocumentModalShipment] =
    useState<AmazonInboundShipment | null>(null);
  const [documentType, setDocumentType] = useState("otros");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
    useState<AmazonInboundShipment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const statusOptions = useMemo(
    () => Array.from(new Set(shipments.map((shipment) => shipment.estado).filter(Boolean))),
    [shipments],
  );

  const yearOptions = useMemo(() => {
    const year = currentYear();
    return Array.from(new Set([year, year - 1, year - 2])).sort((a, b) => b - a);
  }, []);

  const filteredShipments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shipments.filter((shipment) => {
      if (statusFilter !== "ALL" && shipment.estado !== statusFilter) return false;
      if (orderFilter === "linked" && shipment.linked_orders.length === 0) return false;
      if (orderFilter === "unlinked" && shipment.linked_orders.length > 0) return false;
      if (docsFilter === "with" && shipment.documents_count === 0) return false;
      if (docsFilter === "without" && shipment.documents_count > 0) return false;
      if (!q) return true;

      const haystack = [
        shipment.shipment_id,
        shipment.shipment_name,
        shipment.reference_id,
        shipment.inbound_plan_id,
        logisticsFlowLabel(logisticsFlowValue(shipment)),
        shipment.header?.tracking_number,
        shipment.header?.agl_tracking_number,
        shipment.header?.amazon_container_number,
        shipment.header?.booking_reference,
        ...shipment.linked_orders.flatMap((order) => [
          order.numero_orden,
          order.numero_pedido_agente,
        ]),
        ...shipment.items.flatMap((item) => [
          item.sku,
          item.seller_sku_original,
          item.sku_limpio,
          item.producto?.sku,
          item.producto?.nombre,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [docsFilter, orderFilter, search, shipments, statusFilter]);

  const totals = useMemo(
    () => {
      const counts = filteredShipments.reduce(
        (acc, shipment) => {
          acc[statusBucket(shipment.estado)] += 1;
          return acc;
        },
        { ready: 0, transit: 0, receiving: 0, closed: 0, other: 0 },
      );

      return {
        shipments: filteredShipments.length,
        skus: filteredShipments.reduce((sum, shipment) => sum + shipment.total_skus, 0),
        expected: filteredShipments.reduce(
          (sum, shipment) => sum + shipment.total_cantidad_esperada,
          0,
        ),
        matched: filteredShipments.reduce((sum, shipment) => sum + shipment.productsMatched, 0),
        unmatched: filteredShipments.reduce((sum, shipment) => sum + shipment.productsUnmatched, 0),
        closed: closedCount,
        ...counts,
      };
    },
    [closedCount, filteredShipments],
  );

  async function loadShipments(nextIncludeClosed = includeClosed, nextYear = selectedYear) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        year: String(nextYear),
        includeClosedCurrentYear: String(nextIncludeClosed),
      });
      const res = await fetch(`/api/amazon/inbound-shipments?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as ListResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Error HTTP ${res.status}`);
      }
      setShipments(json.shipments ?? []);
      setClosedCount(json.closedCount ?? 0);
      setHiddenClosedCount(json.hiddenClosedCount ?? 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error cargando envios Amazon");
    } finally {
      setLoading(false);
    }
  }

  async function syncShipments() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/amazon/inbound-shipments/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: selectedYear,
          includeClosedCurrentYear: includeClosed,
          includeReadyToShip: true,
          limit: 100,
        }),
      });
      const json = (await res.json()) as SyncResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Error HTTP ${res.status}`);
      }
      setMessage(
        `Sincronizacion completada: ${json.summary?.linesUpserted ?? 0} lineas actualizadas del año ${
          json.summary?.syncYear ?? selectedYear
        } desde ${
          json.summary?.effectiveLastUpdatedAfter?.slice(0, 10) ?? `${selectedYear}-01-01`
        }. Saltadas: ${json.summary?.skippedByDate ?? 0} por fecha, ${
          json.summary?.skippedByStatus ?? 0
        } por estado y ${json.summary?.skippedByMissingDate ?? 0} sin fecha. Fechas: ${
          json.summary?.dateResolvedFromRaw ?? 0
        } desde raw y ${json.summary?.dateResolvedFromShipmentName ?? 0} desde nombre. v2024: ${
          json.summary?.v2024RelationsMatched ?? 0
        } relaciones, ${json.summary?.v2024ShipmentsFetched ?? 0} shipments, ${
          json.summary?.v2024TransportationOptionsRequests ?? 0
        } consultas transporte, ${
          json.summary?.v2024TransportationOptionsFetched ?? 0
        } opciones.`,
      );
      await loadShipments(includeClosed, selectedYear);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error sincronizando envios Amazon");
    } finally {
      setSyncing(false);
    }
  }

  async function enrichV2024(shipment: AmazonInboundShipment) {
    setEnrichingShipmentId(shipment.shipment_id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/amazon/inbound-shipments/${encodeURIComponent(
          shipment.shipment_id,
        )}/enrich-v2024`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            maxPages: 100,
            delayMs: 1000,
            force: true,
          }),
        },
      );
      const json = (await res.json()) as V2024EnrichmentResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Error HTTP ${res.status}`);
      }
      const result = json.result;
      const quotaText =
        (result?.quotaExceededCount ?? 0) > 0
          ? " Cuota Amazon agotada temporalmente."
          : "";
      const foundText =
        (result?.relationsMatched ?? 0) > 0
          ? "relacion v2024 encontrada"
          : "sin relacion v2024";
      setMessage(
        `${shipment.shipment_id}: ${foundText}. Paginas ${result?.inboundPlanPagesScanned ?? 0}, plans ${
          result?.plansScanned ?? 0
        }, shipments internos ${result?.internalShipmentsChecked ?? 0}, getShipment ${
          result?.getShipmentCalls ?? 0
        }, transporte ${result?.transportationOptionsRequests ?? 0} consultas/${
          result?.transportationOptionsFetched ?? 0
        } opciones.${quotaText}`,
      );
      await loadShipments(includeClosed, selectedYear);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error buscando datos v2024");
    } finally {
      setEnrichingShipmentId(null);
    }
  }

  async function loadLinkableContainers() {
    setContainersLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/amazon/inbound-shipments/linkable-containers", {
        cache: "no-store",
      });
      const json = (await res.json()) as LinkableContainersResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Error HTTP ${res.status}`);
      }
      setLinkableContainers(json.containers ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error cargando contenedores AGL");
    } finally {
      setContainersLoading(false);
    }
  }

  async function openLinkModal(shipment: AmazonInboundShipment) {
    setLinkModalShipment(shipment);
    setSelectedContainerId("");
    setLinkNotes("");
    if (linkableContainers.length === 0) {
      await loadLinkableContainers();
    }
  }

  async function openOrderModal(shipment: AmazonInboundShipment) {
    setOrderModalShipment(shipment);
    setSelectedOrderId("");
    setLinkNotes("");
    setOrdersLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/amazon/inbound-shipments/${encodeURIComponent(
          shipment.shipment_id,
        )}/linkable-orders`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as LinkableOrdersResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Error HTTP ${res.status}`);
      }
      setOrderCandidates(json.candidates ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error cargando ordenes candidatas");
      setOrderCandidates([]);
    } finally {
      setOrdersLoading(false);
    }
  }

  async function linkSelectedOrder() {
    if (!orderModalShipment || !selectedOrderId) return;
    setLinking(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/amazon/inbound-shipments/${encodeURIComponent(
          orderModalShipment.shipment_id,
        )}/link-order`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orden_id: selectedOrderId,
            link_notes: linkNotes || null,
          }),
        },
      );
      const json = (await res.json()) as OrderLinkResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Error HTTP ${res.status}`);
      }
      setMessage(
        `Shipment ${json.shipment_id ?? orderModalShipment.shipment_id} vinculado a orden/proforma.`,
      );
      setOrderModalShipment(null);
      await loadShipments();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error vinculando orden/proforma");
    } finally {
      setLinking(false);
    }
  }

  async function unlinkOrder(shipment: AmazonInboundShipment, link: ShipmentOrderLink) {
    const confirmed = window.confirm(
      `Desvincular ${shipment.shipment_id} de ${link.numero_orden ?? link.orden_id}?`,
    );
    if (!confirmed) return;

    setLinking(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/amazon/inbound-shipments/${encodeURIComponent(
          shipment.shipment_id,
        )}/unlink-order`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orden_id: link.orden_id }),
        },
      );
      const json = (await res.json()) as OrderLinkResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Error HTTP ${res.status}`);
      }
      setMessage(`Shipment ${shipment.shipment_id} desvinculado de orden/proforma.`);
      await loadShipments();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desvinculando orden/proforma");
    } finally {
      setLinking(false);
    }
  }

  async function linkSelectedContainer() {
    if (!linkModalShipment || !selectedContainerId) return;
    setLinking(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/amazon/inbound-shipments/${encodeURIComponent(
          linkModalShipment.shipment_id,
        )}/link-container`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contenedor_id: selectedContainerId,
            link_notes: linkNotes || null,
          }),
        },
      );
      const json = (await res.json()) as LinkResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Error HTTP ${res.status}`);
      }
      setMessage(
        `Shipment ${json.shipment_id ?? linkModalShipment.shipment_id} vinculado: ${
          json.linesLinked ?? 0
        } lineas, ${json.skusLinked ?? 0} SKUs.`,
      );
      setLinkModalShipment(null);
      await Promise.all([loadShipments(), loadLinkableContainers()]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error vinculando contenedor");
    } finally {
      setLinking(false);
    }
  }

  async function unlinkShipment(shipment: AmazonInboundShipment) {
    const confirmed = window.confirm(
      `Desvincular ${shipment.shipment_id} del contenedor actual?`,
    );
    if (!confirmed) return;

    setLinking(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/amazon/inbound-shipments/${encodeURIComponent(
          shipment.shipment_id,
        )}/unlink-container`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ link_notes: "Desvinculado manualmente desde UI" }),
        },
      );
      const json = (await res.json()) as LinkResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Error HTTP ${res.status}`);
      }
      setMessage(`Shipment ${shipment.shipment_id} desvinculado.`);
      await Promise.all([loadShipments(), loadLinkableContainers()]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desvinculando contenedor");
    } finally {
      setLinking(false);
    }
  }

  async function uploadDocument() {
    if (!documentModalShipment || !documentFile) return;
    setLinking(true);
    setError(null);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", documentFile);
      formData.append("tipo_documento", documentType);
      const res = await fetch(
        `/api/amazon/inbound-shipments/${encodeURIComponent(
          documentModalShipment.shipment_id,
        )}/documents`,
        { method: "POST", body: formData },
      );
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `Error HTTP ${res.status}`);
      setMessage("Documento subido al shipment.");
      setDocumentModalShipment(null);
      setDocumentFile(null);
      await loadShipments();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error subiendo documento");
    } finally {
      setLinking(false);
    }
  }

  useEffect(() => {
    void loadShipments(includeClosed, selectedYear);
  }, [includeClosed, selectedYear]);

  return (
    <main className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Envios Amazon</h1>
          <p className="text-sm text-slate-500">
            Envios inbound creados en Seller Central y preparados para vinculacion manual.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={selectedYear}
            onChange={(event) => setSelectedYear(Number(event.target.value))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={includeClosed}
              onChange={(event) => setIncludeClosed(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Incluir cerrados del año
          </label>
          <button
            type="button"
            onClick={() => void syncShipments()}
            disabled={syncing}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Sincronizar año
          </button>
        </div>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {message}
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {[
          ["Listo para enviar", totals.ready],
          ["En transito", totals.transit],
          ["Recibiendo", totals.receiving],
          ["Cerrados año", totals.closed],
          ["Total", totals.shipments],
          ["SKUs", totals.skus],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase text-slate-400">
              {label}
            </p>
            <p className="mt-1 text-xl font-bold text-slate-900">
              {formatNumber(Number(value))}
            </p>
          </div>
        ))}
      </section>

      {hiddenClosedCount > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
          {formatNumber(hiddenClosedCount)} envio(s) CLOSED de {selectedYear} ocultos.
          Activa "Incluir cerrados del año" para revisarlos.
        </div>
      ) : null}

      {includeClosed && closedCount === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No hay envios CLOSED sincronizados para {selectedYear}.
        </div>
      ) : null}

      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 lg:grid-cols-[1.5fr_repeat(3,minmax(0,1fr))]">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Buscar shipment, tracking, contenedor/ref, orden, pedido agente, SKU o producto"
        />
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="ALL">Todos los estados</option>
          {statusOptions.map((status) => (
            <option key={status} value={status ?? ""}>
              {status}
            </option>
          ))}
        </select>
        <select
          value={orderFilter}
          onChange={(event) => setOrderFilter(event.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="ALL">Orden: todas</option>
          <option value="linked">Con orden</option>
          <option value="unlinked">Sin orden</option>
        </select>
        <select
          value={docsFilter}
          onChange={(event) => setDocsFilter(event.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="ALL">Docs: todos</option>
          <option value="with">Con documentacion</option>
          <option value="without">Sin documentacion</option>
        </select>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando envios
          </div>
        ) : filteredShipments.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            No hay envios que coincidan con los filtros.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredShipments.map((shipment) => (
              <article key={shipment.shipment_id} className="p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-mono text-sm font-semibold text-slate-900">
                        {shipment.shipment_id}
                      </h2>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {statusLabel(shipment.estado)}
                      </span>
                      {shipment.contenedor_id ? (
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Contenedor real vinculado
                        </span>
                      ) : logisticsFlowValue(shipment) === "almacen_a_amazon" ? (
                        <span className="rounded bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
                          Contenedor ERP no aplica
                        </span>
                      ) : (
                        <span className="rounded bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
                          {isFactoryToAmazonFlow(logisticsFlowValue(shipment))
                            ? "Contenedor ERP opcional"
                            : "Sin contenedor ERP"}
                        </span>
                      )}
                      {shipment.linked_orders.length > 0 ? (
                        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          Orden vinculada
                        </span>
                      ) : null}
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          v2024StatusLabel(shipment).className
                        }`}
                      >
                        {v2024StatusLabel(shipment).label}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${logisticsFlowClass(
                          logisticsFlowValue(shipment),
                        )}`}
                      >
                        {shipmentLogisticsLabel(shipment)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {shipment.shipment_name ?? "Sin nombre"} | Ref{" "}
                      {shipment.reference_id ?? "-"} | Plan{" "}
                      {shipment.header?.inbound_plan_id ?? shipment.inbound_plan_id ?? "-"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Plan v2024{" "}
                      {shipment.header?.inbound_plan_id ?? shipment.inbound_plan_id ?? "-"} |
                      Shipment interno {shipment.header?.amazon_shipment_id ?? "-"} |
                      Referencia Amazon {shipment.header?.amazon_reference_id ?? "-"}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Creado {shipment.fecha_creacion ?? "-"} | Destino{" "}
                      {shipment.destination_country ?? "-"} | Centro{" "}
                      {shipment.destination_center ?? "-"} | Transporte{" "}
                      {shipment.transport_status ?? "-"}
                    </p>
                    {shipment.date_source ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Fecha creacion:{" "}
                        {formatDate(
                          shipment.header?.fecha_creacion_resuelta ??
                            shipment.resolved_shipment_date,
                        )}{" "}
                        · origen: {dateSourceLabel(shipment.header?.date_source ?? shipment.date_source)}
                      </p>
                    ) : null}
                    <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <span className="text-slate-400">ETA</span>{" "}
                        {visibleDate(shipment.visible_logistics.eta)}
                      </div>
                      <div>
                        <span className="text-slate-400">Tracking</span>{" "}
                        {visibleValue(shipment.visible_logistics.tracking)}
                      </div>
                      <div>
                        <span className="text-slate-400">Nº contenedor Amazon/AGL</span>{" "}
                        {visibleValue(shipment.visible_logistics.containerNumber)}
                      </div>
                      <div>
                        <span className="text-slate-400">Carrier</span>{" "}
                        {visibleValue(shipment.visible_logistics.carrier)}
                      </div>
                      <div>
                        <span className="text-slate-400">ETD</span>{" "}
                        {visibleDate(shipment.visible_logistics.etd)}
                      </div>
                      <div>
                        <span className="text-slate-400">Documentos</span>{" "}
                        {formatNumber(shipment.documents_count)}
                      </div>
                      <div>
                        <span className="text-slate-400">Coste logistico Amazon</span>{" "}
                        pendiente de conciliacion
                      </div>
                      <div>
                        <span className="text-slate-400">Contenedor ERP</span>{" "}
                        {shipment.visible_logistics.containerApplicability === "no_aplica"
                          ? "No aplica"
                          : shipment.contenedor_id
                            ? "Vinculado"
                            : isFactoryToAmazonFlow(logisticsFlowValue(shipment))
                              ? "Opcional / vincular si corresponde"
                              : "No requerido"}
                      </div>
                    </div>
                    <div className="mt-2 grid gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <span className="text-slate-400">ShipFromAddress</span>{" "}
                        {shipFromAddressText(shipment.amazon_v0)}
                      </div>
                      <div>
                        <span className="text-slate-400">DestinationFulfillmentCenterId</span>{" "}
                        {amazonValue(
                          shipment.amazon_v0?.destination_fulfillment_center_id ??
                            shipment.destination_center,
                        )}
                      </div>
                      <div>
                        <span className="text-slate-400">ShipmentStatus</span>{" "}
                        {amazonValue(shipment.amazon_v0?.shipment_status ?? shipment.estado)}
                      </div>
                      <div>
                        <span className="text-slate-400">LabelPrepType</span>{" "}
                        {amazonValue(shipment.amazon_v0?.label_prep_type)}
                      </div>
                      <div>
                        <span className="text-slate-400">BoxContentsSource</span>{" "}
                        {amazonValue(shipment.amazon_v0?.box_contents_source)}
                      </div>
                    </div>
                    {shipment.productsUnmatched > 0 ? (
                      <p className="mt-1 text-xs font-medium text-amber-700">
                        {formatNumber(shipment.productsUnmatched)} producto(s) sin match.
                      </p>
                    ) : null}
                    {logisticsFlowValue(shipment) === "almacen_a_amazon" ? (
                      <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                        Envio desde almacen propio a Amazon. Contenedor ERP: no aplica.
                      </div>
                    ) : isFactoryToAmazonFlow(logisticsFlowValue(shipment)) ? (
                      <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Envío desde fábrica a Amazon. Contenedor ERP opcional,
                        vincular solo si corresponde a una operacion real.
                      </div>
                    ) : (
                      <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                        Este envio ya existe en Amazon. No es necesario crear un contenedor ERP
                        salvo que corresponda a un contenedor propio real.
                      </div>
                    )}
                    {shipment.linked_orders.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {shipment.linked_orders.map((link) => (
                          <span
                            key={link.id}
                            className="inline-flex items-center gap-2 rounded-lg border border-blue-100 bg-white px-2.5 py-1 text-xs text-blue-800"
                          >
                            <span>
                              {link.numero_orden ?? link.orden_id}
                              {link.numero_pedido_agente
                                ? ` | ${link.numero_pedido_agente}`
                                : ""}
                              {link.proveedor ? ` | ${link.proveedor}` : ""}
                            </span>
                            <button
                              type="button"
                              onClick={() => void unlinkOrder(shipment, link)}
                              disabled={linking}
                              className="font-semibold text-blue-500 hover:text-blue-700 disabled:opacity-50"
                            >
                              quitar
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-right text-xs">
                    <div>
                      <p className="text-slate-400">Esperadas</p>
                      <p className="font-semibold text-slate-800">
                        {formatNumber(shipment.total_cantidad_esperada)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400">Enviadas</p>
                      <p className="font-semibold text-slate-800">
                        {formatNumber(shipment.total_cantidad_enviada)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400">Recibidas</p>
                      <p className="font-semibold text-slate-800">
                        {formatNumber(shipment.total_cantidad_recibida)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400">Localizadas</p>
                      <p className="font-semibold text-slate-800">
                        {formatNumber(shipment.total_cantidad_localizada)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="text-slate-400">
                      <tr>
                        <th className="py-1 pr-3 font-medium">SKU original</th>
                        <th className="py-1 pr-3 font-medium">SKU limpio</th>
                        <th className="py-1 pr-3 font-medium">Producto</th>
                        <th className="py-1 pr-3 text-right font-medium">Esperada</th>
                        <th className="py-1 pr-3 text-right font-medium">Recibida</th>
                        <th className="py-1 text-right font-medium">Localizada</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {shipment.items.map((item) => (
                        <tr key={item.id ?? `${shipment.shipment_id}-${item.sku}`}>
                          <td className="py-1.5 pr-3 font-mono">
                            {item.seller_sku_original ?? item.sku ?? "-"}
                          </td>
                          <td className="py-1.5 pr-3 font-mono">
                            {item.sku_limpio ?? item.match_candidates[0] ?? "-"}
                          </td>
                          <td className="py-1.5 pr-3">
                            {item.producto ? (
                              <div className="flex min-w-[280px] items-center gap-3">
                                {item.producto.imagen_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={item.producto.imagen_url}
                                    alt={
                                      item.producto.nombre ??
                                      item.producto.sku ??
                                      "Producto ERP"
                                    }
                                    className="h-12 w-12 shrink-0 rounded-md border border-slate-200 object-cover"
                                  />
                                ) : (
                                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-100 px-1 text-center text-[10px] font-medium leading-tight text-slate-400">
                                    Sin imagen
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-slate-800">
                                    {item.producto.nombre ?? "Producto sin nombre"}
                                  </p>
                                  <p className="font-mono text-xs text-slate-500">
                                    {item.producto.sku ?? item.producto_id}
                                  </p>
                                  <p
                                    className="text-[11px] text-emerald-700"
                                    title={item.matched_by ?? undefined}
                                  >
                                    {matchLabel(item.matched_by)}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div className="min-w-[220px]">
                                <p className="text-sm font-medium text-amber-700">
                                  Sin match
                                </p>
                                <p className="font-mono text-xs text-slate-500">
                                  {item.sku_limpio ?? item.match_candidates[0] ?? "-"}
                                </p>
                                {item.match_candidates.length > 1 ? (
                                  <p className="text-[11px] text-slate-400">
                                    {item.match_candidates.slice(0, 3).join(" / ")}
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td className="py-1.5 pr-3 text-right">
                            {formatNumber(item.cantidad_esperada)}
                          </td>
                          <td className="py-1.5 pr-3 text-right">
                            {formatNumber(item.cantidad_recibida)}
                          </td>
                          <td className="py-1.5 text-right">
                            {formatNumber(item.cantidad_localizada)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void enrichV2024(shipment)}
                    disabled={Boolean(enrichingShipmentId)}
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                  >
                    {enrichingShipmentId === shipment.shipment_id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Buscar datos v2024
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDocumentModalShipment(shipment);
                      setDocumentType("otros");
                      setDocumentFile(null);
                    }}
                    disabled={linking}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Subir documento
                  </button>
                  <button
                    type="button"
                    onClick={() => void openOrderModal(shipment)}
                    disabled={linking}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    Vincular a orden/proforma
                  </button>
                  {logisticsFlowValue(shipment) === "almacen_a_amazon" ? (
                    <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500">
                      Contenedor ERP: no aplica
                    </span>
                  ) : shipment.contenedor_id ? (
                    <button
                      type="button"
                      onClick={() => void unlinkShipment(shipment)}
                      disabled={linking}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                    >
                      Avanzado: desvincular contenedor real
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void openLinkModal(shipment)}
                      disabled={linking}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Avanzado: vincular contenedor real
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {documentModalShipment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-xl rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Subir documento</h2>
            <p className="mt-1 font-mono text-sm text-slate-500">
              {documentModalShipment.shipment_id}
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-slate-700">
                Tipo documento
                <select
                  value={documentType}
                  onChange={(event) => setDocumentType(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="packing_list">Packing list</option>
                  <option value="factura">Factura</option>
                  <option value="proforma">Proforma</option>
                  <option value="booking">Booking</option>
                  <option value="etiquetas_amazon">Etiquetas Amazon</option>
                  <option value="documento_agl">Documento AGL</option>
                  <option value="otros">Otros</option>
                </select>
              </label>
              <input
                type="file"
                onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-700"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDocumentModalShipment(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void uploadDocument()}
                disabled={!documentFile || linking}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                Subir
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {orderModalShipment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Vincular shipment a orden/proforma
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {orderModalShipment.shipment_id} |{" "}
                  {orderModalShipment.shipment_name ?? "Sin nombre"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOrderModalShipment(null)}
                className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              La vinculacion con orden/proforma solo documenta trazabilidad. No crea
              contenedores, no aplica stock y no modifica estados logisticos.
            </div>

            <div className="mt-4 space-y-3">
              {ordersLoading ? (
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-4 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Buscando ordenes candidatas
                </div>
              ) : orderCandidates.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                  No hay sugerencias por producto/cantidad. Revisa que las lineas del
                  shipment tengan producto ERP matcheado.
                </div>
              ) : (
                <div className="space-y-2">
                  {orderCandidates.map((candidate) => (
                    <label
                      key={candidate.orden_id}
                      className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50"
                    >
                      <input
                        type="radio"
                        name="order-candidate"
                        value={candidate.orden_id}
                        checked={selectedOrderId === candidate.orden_id}
                        onChange={() => setSelectedOrderId(candidate.orden_id)}
                        disabled={candidate.alreadyLinked}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-slate-900">
                            {candidate.numero_orden ?? candidate.orden_id}
                          </span>
                          {candidate.numero_pedido_agente ? (
                            <span className="text-xs text-slate-500">
                              {candidate.numero_pedido_agente}
                            </span>
                          ) : null}
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                            {candidate.confidence} | score {candidate.score}
                          </span>
                          {candidate.alreadyLinked ? (
                            <span className="rounded bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                              ya vinculada
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {candidate.proveedor ?? "Sin proveedor"} | Estado{" "}
                          {candidate.estado ?? "-"} | Orden{" "}
                          {candidate.fecha_orden ?? "-"} | ETA {candidate.eta ?? "-"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {candidate.matchedProducts} producto(s) coinciden | Shipment{" "}
                          {formatNumber(candidate.shipmentUnits)} uds | Orden{" "}
                          {formatNumber(candidate.orderUnits)} uds
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {candidate.reasons.join(" | ")}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              <label className="block text-sm font-medium text-slate-700">
                Notas de vinculacion
                <textarea
                  value={linkNotes}
                  onChange={(event) => setLinkNotes(event.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Motivo, proforma o referencia interna"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOrderModalShipment(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void linkSelectedOrder()}
                disabled={!selectedOrderId || linking}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {linking ? "Vinculando..." : "Confirmar vinculacion"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {linkModalShipment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Vincular shipment a contenedor real
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {linkModalShipment.shipment_id} |{" "}
                  {linkModalShipment.shipment_name ?? "Sin nombre"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLinkModalShipment(null)}
                className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-slate-700">
                Contenedor AGL
                <select
                  value={selectedContainerId}
                  onChange={(event) => setSelectedContainerId(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">
                    {containersLoading
                      ? "Cargando contenedores..."
                      : "Selecciona un contenedor"}
                  </option>
                  {linkableContainers.map((container) => (
                    <option key={container.id} value={container.id}>
                      {container.amazon_shipment_id ? "[vinculado] " : ""}
                      {container.identificador_embarque ?? container.id} | ETA{" "}
                      {container.fecha_eta_estimada ?? "-"} |{" "}
                      {container.order_refs.length > 0
                        ? container.order_refs.join(", ")
                        : "sin ordenes visibles"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Notas de vinculacion
                <textarea
                  value={linkNotes}
                  onChange={(event) => setLinkNotes(event.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Motivo o referencia de la vinculacion manual"
                />
              </label>

              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Opcion avanzada: usala solo si este shipment corresponde a un contenedor
                propio real existente. No cambia stock, estado logistico ni estado_stock.
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLinkModalShipment(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void linkSelectedContainer()}
                disabled={!selectedContainerId || linking}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {linking ? "Vinculando..." : "Confirmar vinculacion"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
