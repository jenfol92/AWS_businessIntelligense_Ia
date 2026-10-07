// modules/inventory/components/InventoryPage.tsx
//
// Vista principal de inventario: lista de productos + detalle responsive.

"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Package,
  RefreshCw,
  Search,
} from "lucide-react";
import { Card, Text, Title } from "@tremor/react";
import { DEFAULT_LOCALE, isLocale } from "@/config/i18n";
import { useGlobalFilters } from "@/shared/filters/useGlobalFilters";
import { localIsoDate } from "@/shared/filters/periodDates";
import { ResponsiveDataCard } from "@/shared/ui/ResponsiveDataCard";
import { ResponsiveTable } from "@/shared/ui/ResponsiveTable";
import {
  forecastMethodLabel,
  riskLabel,
} from "../services/buildInventoryProduct";
import {
  forecastMethodBusinessLabel,
  resolveDisplayForecastMethod,
} from "../services/forecastMethodUi";
import { fetchInventoryProductDetail, fetchInventoryProductForecast } from "../services/inventoryDetailClient";
import { InventoryForecastSimulationPanel } from "./InventoryForecastSimulationPanel";
import { OperationalStockPanel } from "./OperationalStockPanel";
import { InventoryKpiGrid } from "./InventoryKpiGrid";
import { FbmSyncButton } from "./FbmSyncButton";
import { LedgerSyncButton } from "./LedgerSyncButton";
import { ForecastMethodExplanationBox } from "./ForecastMethodExplanationBox";
import { SalesByCountryModal } from "./detail/SalesByCountryModal";
import type { ProductForecastConfigUpsertBody } from "@/modules/planning/types";
import type {
  InventoryComparisonResponse,
  InventoryCountryStockRow,
  InventoryCountryPriceDistributionRow,
  InventoryInboundRow,
  InventoryInboundPlanningKind,
  InventoryLotesResponse,
  InventoryProductCoreResponse,
  InventoryProductForecastResponse,
  InventoryProductDetailResponse,
  InventoryProductSummary,
  InventoryRiskLevel,
} from "../types/inventory.types";
import { inboundPlanningKindLabel } from "@/modules/planner/services/mapForecastInboundToInventoryRow";
import OrderReadonlyModal from "@/modules/orders/components/OrderReadonlyModal";
import { buildInclusiveDateWindow } from "../services/inclusiveDateWindow";

type DetailFail = { ok: false; error: string };

type PriceDistributionResponse =
  | {
      ok: true;
      productId: string;
      country: string;
      channel: "ALL" | "FBA" | "FBM";
      windowDays?: 30 | 90;
      periodLabel?: string;
      rows: InventoryCountryPriceDistributionRow[];
    }
  | DetailFail;

type PriceDistributionModalState = {
  country: string;
  periodLabel: string;
  fromDate?: string;
  toDate?: string;
  loading: boolean;
  error: string | null;
  rows: InventoryCountryPriceDistributionRow[];
} | null;

type InventoryProductLite = {
  id: string;
  sku: string;
  nombre: string | null;
  parent_id: string | null;
  proveedor_id: string | null;
  estado: string | null;
};

type InventoryProductsLiteResponse = {
  ok: true;
  products: InventoryProductLite[];
};
type AmazonCanonicalSyncResponse = {
  ok: true;
  summary: {
    action: "synced" | "skipped_fresh" | "skipped_rate_limit" | "skipped_running";
    finishedAt: string;
    inventory?: { rowsUpserted: number; rowsParsed: number; warnings?: string[] };
    inbound?: { linesUpserted: number; shipmentsProcessed: number; warnings: string[]; errors: string[] };
  };
};

function resolveLocale(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

function riskBadgeClass(risk: InventoryRiskLevel): string {
  switch (risk) {
    case "critico":
      return "bg-rose-100 text-rose-800 ring-rose-200";
    case "bajo":
      return "bg-orange-100 text-orange-800 ring-orange-200";
    case "exceso":
      return "bg-yellow-100 text-yellow-800 ring-yellow-200";

    case "sin_ventas":
      return "bg-slate-100 text-slate-600 ring-slate-200";
    default:
      return "bg-emerald-100 text-emerald-800 ring-emerald-200";
  }
}
function fmtNum(
  n: number | null | undefined,
  digits = 0,
): string {
  if (n == null || Number.isNaN(n)) return "—";

  return n.toLocaleString("es-ES", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function fmtCurrency(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-ES");
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-ES", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

const FORECAST_COUNTRY_LABELS: Record<string, string> = {
  ALL: "Todos los países",
  EU: "Unión Europea",
  ES: "España",
  FR: "Francia",
  DE: "Alemania",
  IT: "Italia",
  GB: "Reino Unido",
  PL: "Polonia",
  SE: "Suecia",
  PT: "Portugal",
  NL: "Países Bajos",
  BE: "Bélgica",
  AT: "Austria",
  LU: "Luxemburgo",
  DK: "Dinamarca",
};

function forecastCountryHumanLabel(code: string): string {
  return FORECAST_COUNTRY_LABELS[code.toUpperCase()] ?? code;
}

function forecastChannelHumanLabel(channel: string): string {
  const c = channel.toUpperCase();
  if (c === "ALL") return "Todos los canales";
  if (c === "AMAZON_FBA" || c === "FBA") return "FBA";
  if (c === "AMAZON_FBM" || c === "FBM") return "FBM";
  return channel;
}

function forecastScopeHumanLabel(country: string, channel: string): string {
  return `${forecastCountryHumanLabel(country)} · ${forecastChannelHumanLabel(channel)}`;
}

function countryFlag(code: string): string {
  const country = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return "";
  return String.fromCodePoint(
    ...country.split("").map((char) => 127397 + char.charCodeAt(0)),
  );
}

function buildComparisonUrl(filters: {
  q: string;
  categoria: string;
  proveedor: string;
  canal: string;
  soloCriticos: boolean;
  stockZero: boolean;
  sinHistorico: boolean;
  conInbound: boolean;
}): string {
  const p = new URLSearchParams();
  if (filters.q.trim()) p.set("q", filters.q.trim());
  if (filters.categoria !== "ALL") p.set("categoria", filters.categoria);
  if (filters.proveedor !== "ALL") p.set("proveedor", filters.proveedor);
  if (filters.canal !== "ALL") p.set("canal", filters.canal);
  if (filters.soloCriticos) p.set("soloCriticos", "true");
  if (filters.stockZero) p.set("stockZero", "true");
  if (filters.sinHistorico) p.set("sinHistorico", "true");
  if (filters.conInbound) p.set("conInbound", "true");
  return `/api/inventory/comparison?${p.toString()}`;
}

function flattenProducts(products: InventoryProductSummary[]): InventoryProductSummary[] {
  const out: InventoryProductSummary[] = [];
  for (const p of products) {
    out.push(p);
    for (const v of p.variantes) out.push(v);
  }
  return out;
}

function resolveSelectedProduct(
  products: InventoryProductSummary[],
  selectedId: string | null,
  variantByParent: Record<string, string>,
): InventoryProductSummary | null {
  if (!selectedId) return products[0] ?? null;
  for (const p of products) {
    if (p.productoId === selectedId) {
      const variantId = variantByParent[p.productoId];
      if (variantId) {
        return p.variantes.find((v) => v.productoId === variantId) ?? p;
      }
      return p;
    }
    const variant = p.variantes.find((v) => v.productoId === selectedId);
    if (variant) return variant;
  }
  return products[0] ?? null;
}

export function InventoryPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = resolveLocale(params?.locale);
  const { canal, pais, windowDays, periodFrom, periodTo } = useGlobalFilters();
  const showStockoutDebug =
    process.env.NODE_ENV === "development" &&
    searchParams.get("debugStockout") === "1";

  const [search, setSearch] = useState("");
  const [categoriaFilter, setCategoriaFilter] = useState("ALL");
  const [proveedorFilter, setProveedorFilter] = useState("ALL");
  const [soloCriticos, setSoloCriticos] = useState(false);
  const [stockZero, setStockZero] = useState(false);
  const [sinHistorico, setSinHistorico] = useState(false);
  const [conInbound, setConInbound] = useState(false);

  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listData, setListData] = useState<InventoryComparisonResponse | null>(null);
  const [liteProducts, setLiteProducts] = useState<InventoryProductLite[]>([]);
  const [initialDetailLoaded, setInitialDetailLoaded] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [variantByParent, setVariantByParent] = useState<Record<string, string>>({});

  const [detailLoading, setDetailLoading] = useState(false);
const [detail, setDetail] =
  useState<InventoryProductCoreResponse | null>(null);
const [detailError, setDetailError] = useState<string | null>(null);

const [forecastLoading, setForecastLoading] = useState(false);
const [forecastData, setForecastData] =
  useState<InventoryProductForecastResponse | null>(null);
const [forecastError, setForecastError] = useState<string | null>(null);

const [simulationOverride, setSimulationOverride] =
  useState<ProductForecastConfigUpsertBody | null>(null);

const activeDetailAbortRef = useRef<AbortController | null>(null);
const activeForecastAbortRef = useRef<AbortController | null>(null);
const activeListAbortRef = useRef<AbortController | null>(null);

const detailRequestIdRef = useRef(0);
const forecastRequestIdRef = useRef(0);
  const listRequestIdRef = useRef(0);
  const simulationProductIdRef = useRef<string | null>(null);

  const [expandedPais, setExpandedPais] = useState<string | null>(null);
  const [lotesData, setLotesData] = useState<InventoryLotesResponse | null>(null);
  const [lotesLoading, setLotesLoading] = useState(false);
  const [priceDistributionModal, setPriceDistributionModal] =
    useState<PriceDistributionModalState>(null);
  const [salesModalOpen, setSalesModalOpen] = useState(false);
  const [amazonRefreshLoading, setAmazonRefreshLoading] = useState(false);
  const [amazonRefreshMessage, setAmazonRefreshMessage] = useState<string | null>(null);
  const [amazonRefreshError, setAmazonRefreshError] = useState<string | null>(null);
  const [salesRefreshLoading, setSalesRefreshLoading] = useState(false);
  const [salesRefreshMessage, setSalesRefreshMessage] = useState<string | null>(null);
  const [salesRefreshError, setSalesRefreshError] = useState<string | null>(null);
  const [salesRefreshJob, setSalesRefreshJob] = useState<{jobId: string; fromDate: string; toDate: string} | null>(null);
  const [ordersRefreshLoading, setOrdersRefreshLoading] = useState(false);
  const [ordersRefreshMessage, setOrdersRefreshMessage] = useState<string | null>(null);
  const [ordersRefreshError, setOrdersRefreshError] = useState<string | null>(null);
  const [ordersRefreshJobId, setOrdersRefreshJobId] = useState<string | null>(null);

  const filterState = useMemo(
    () => ({
      q: search,
      categoria: categoriaFilter,
      proveedor: proveedorFilter,
      canal: canal ?? "ALL",
      soloCriticos,
      stockZero,
      sinHistorico,
      conInbound,
    }),
    [
      search,
      categoriaFilter,
      proveedorFilter,
      canal,
      soloCriticos,
      stockZero,
      sinHistorico,
      conInbound,
    ],
  );

  const comparisonUrl = useMemo(
    () => buildComparisonUrl(filterState),
    [filterState],
  );

  const loadList = useCallback(async () => {
    activeListAbortRef.current?.abort();
    const requestId = listRequestIdRef.current + 1;
    listRequestIdRef.current = requestId;
    const controller = new AbortController();
    activeListAbortRef.current = controller;
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch(comparisonUrl, {
        cache: "no-store",
        signal: controller.signal,
      });
      const json = (await res.json()) as InventoryComparisonResponse | DetailFail;
      if (listRequestIdRef.current !== requestId) return;
      if (!res.ok || json.ok === false) {
        setListData(null);
        setListError("error" in json ? json.error : `HTTP ${res.status}`);
        return;
      }
      setListData(json);
      setSelectedId((current) => {
        const flat = flattenProducts(json.products);
        if (!current) return flat[0]?.productoId ?? null;
        return flat.some((p) => p.productoId === current)
          ? current
          : flat[0]?.productoId ?? null;
      });
    } catch (e) {
      if (controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
        return;
      }
      if (listRequestIdRef.current !== requestId) return;
      setListError(e instanceof Error ? e.message : "Error de red");
      setListData(null);
    } finally {
      if (listRequestIdRef.current === requestId) {
        setListLoading(false);
        if (activeListAbortRef.current === controller) {
          activeListAbortRef.current = null;
        }
      }
    }
  }, [comparisonUrl]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadProductsLite() {
      try {
        const res = await fetch("/api/inventory/products-lite", {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = (await res.json()) as InventoryProductsLiteResponse | DetailFail;
        if (controller.signal.aborted) return;
        if (!res.ok || json.ok === false) return;
        setLiteProducts(json.products);
        setSelectedId((current) => current ?? json.products[0]?.id ?? null);
      } catch (e) {
        if (controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
          return;
        }
      }
    }

    void loadProductsLite();
    return () => {
      controller.abort();
    };
  }, []);

  
  /*useEffect(() => {
    if (!initialDetailLoaded) return;
    const timeoutId = window.setTimeout(() => {
      void loadList();
    }, 10000);

    return () => {
      window.clearTimeout(timeoutId);
      activeListAbortRef.current?.abort();
    };
  }, [initialDetailLoaded, loadList]);
  */

  useEffect(() => {
    return () => {
      activeListAbortRef.current?.abort();
      activeDetailAbortRef.current?.abort();
      activeForecastAbortRef.current?.abort();
    };
  }, []);

  const selectedProduct = useMemo(
    () =>
      listData
        ? resolveSelectedProduct(listData.products, selectedId, variantByParent)
        : null,
    [listData, selectedId, variantByParent],
  );
  const selectedProductId = selectedProduct?.productoId ?? selectedId;
  const isSimulationActiveForSelectedProduct =
    simulationOverride != null &&
    selectedProductId != null &&
    simulationProductIdRef.current === selectedProductId;
    const fullDetail = useMemo<InventoryProductDetailResponse | null>(() => {
      if (!detail || !forecastData) return null;
    
      return {
        ...detail,
        ...forecastData,
      };
    }, [detail, forecastData]);

  const loadDetail = useCallback(
    async (
      productId: string,
      forecastOverride?: ProductForecastConfigUpsertBody | null,
    ) => {
      activeDetailAbortRef.current?.abort();
      const requestId = detailRequestIdRef.current + 1;
      detailRequestIdRef.current = requestId;
      const controller = new AbortController();
      activeDetailAbortRef.current = controller;
      setDetailLoading(true);
      setDetailError(null);
      setDetail(null);
      try {
        const json = await fetchInventoryProductDetail(productId, {
          canal,
          pais,
          windowDays,
          periodFrom,
          periodTo,
          forecastOverride: forecastOverride ?? undefined,
          debugStockout: showStockoutDebug,
          signal: controller.signal,
        });
        if (detailRequestIdRef.current !== requestId) return;
        setDetail(json);
        setInitialDetailLoaded(true);
      } catch (e) {
        if (controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
          return;
        }
        if (detailRequestIdRef.current !== requestId) return;
        setDetailError(e instanceof Error ? e.message : "Error de red");
        setDetail(null);
      } finally {
        if (detailRequestIdRef.current === requestId) {
          setDetailLoading(false);
          if (activeDetailAbortRef.current === controller) {
            activeDetailAbortRef.current = null;
          }
        }
      }
    },
    [canal, pais, windowDays, periodFrom, periodTo, showStockoutDebug],
  );
  const loadForecast = useCallback(
    async (
      productId: string,
      forecastOverride?: ProductForecastConfigUpsertBody | null,
    ) => {
      activeForecastAbortRef.current?.abort();
  
      const requestId = forecastRequestIdRef.current + 1;
      forecastRequestIdRef.current = requestId;
  
      const controller = new AbortController();
      activeForecastAbortRef.current = controller;
  

      setForecastLoading(true);
      setForecastError(null);
      setForecastData(null);
  
      try {
        const json = await fetchInventoryProductForecast(productId, {
          canal,
          pais,
          windowDays,
          periodFrom,
          periodTo,
          forecastOverride: forecastOverride ?? undefined,
          debugStockout: showStockoutDebug,
          signal: controller.signal,
        });
  
        if (forecastRequestIdRef.current !== requestId) {
          return;
        }
  
        setForecastData(json);
      } catch (e) {
        if (
          controller.signal.aborted ||
          (e instanceof DOMException && e.name === "AbortError")
        ) {
          return;
        }
  
        if (forecastRequestIdRef.current !== requestId) {
          return;
        }
  
        setForecastError(
          e instanceof Error
            ? e.message
            : "Error cargando forecast",
        );
  
        setForecastData(null);
      } finally {
        if (forecastRequestIdRef.current === requestId) {
          setForecastLoading(false);
  
          if (activeForecastAbortRef.current === controller) {
            activeForecastAbortRef.current = null;
          }
        }
      }
    },
    [
      canal,
      pais,
      windowDays,
      periodFrom,
      periodTo,
      showStockoutDebug,
    ],
  );

  useEffect(() => {
    simulationProductIdRef.current = null;
    setSimulationOverride(null);
    setSalesModalOpen(false);
  }, [selectedId]);

  useEffect(() => {
    return () => {
      activeDetailAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!selectedProductId) return;
  
    void loadDetail(selectedProductId);
  }, [
    selectedProductId,
    loadDetail,
  ]);
  useEffect(() => {
    if (!selectedProductId) return;
    if (!detail) return;
  
    // Evita calcular forecast con el core del producto anterior.
    if (detail.product.productoId !== selectedProductId) return;
  
    const effectiveOverride =
      simulationProductIdRef.current === selectedProductId
        ? simulationOverride
        : null;
  
    void loadForecast(selectedProductId, effectiveOverride);
  }, [
    selectedProductId,
    detail,
    loadForecast,
    simulationOverride,
  ]);

  async function toggleLotes(pais: string) {
    if (expandedPais === pais) {
      setExpandedPais(null);
      setLotesData(null);
      return;
    }
    if (!detail) return;

    setExpandedPais(pais);
    setLotesLoading(true);
    setLotesData(null);
    try {
      const q = new URLSearchParams({
        producto_id: detail.product.productoId,
        pais,
      });
      const res = await fetch(`/api/inventory/lotes?${q.toString()}`);
      const json = (await res.json()) as InventoryLotesResponse | DetailFail;
      if (json.ok) setLotesData(json);
    } finally {
      setLotesLoading(false);
    }
  }

  async function openPriceDistribution(
    country: string,
    range: { label: string; fromDate?: string; toDate?: string; windowDays?: 30 | 90 },
  ) {
    if (!detail) return;

    setPriceDistributionModal({
      country,
      periodLabel: range.label,
      fromDate: range.fromDate,
      toDate: range.toDate,
      loading: true,
      error: null,
      rows: [],
    });

    try {
      const q = new URLSearchParams({
        country,
        channel: "ALL",
      });
      if (range.fromDate) q.set("fromDate", range.fromDate);
      if (range.toDate) q.set("toDate", range.toDate);
      if (range.windowDays) q.set("windowDays", String(range.windowDays));
      const res = await fetch(
        `/api/inventory/products/${detail.product.productoId}/country-price-distribution?${q.toString()}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as PriceDistributionResponse;
      if (!res.ok || json.ok === false) {
      setPriceDistributionModal({
        country,
        periodLabel: range.label,
        fromDate: range.fromDate,
        toDate: range.toDate,
        loading: false,
        error: "error" in json ? json.error : `HTTP ${res.status}`,
          rows: [],
        });
        return;
      }
      setPriceDistributionModal({
        country,
        periodLabel: range.label,
        fromDate: range.fromDate,
        toDate: range.toDate,
        loading: false,
        error: null,
        rows: json.rows,
      });
    } catch (error) {
      setPriceDistributionModal({
        country,
        periodLabel: range.label,
        fromDate: range.fromDate,
        toDate: range.toDate,
        loading: false,
        error: error instanceof Error ? error.message : "Error cargando distribucion.",
        rows: [],
      });
    }
  }

 

  async function refreshAmazonInventory() {
    if (amazonRefreshLoading) return;
    setAmazonRefreshLoading(true);
    setAmazonRefreshMessage(null);
    setAmazonRefreshError(null);
    try {
      const res = await fetch("/api/amazon/inventory/fba-snapshot/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const json = (await res.json().catch(() => ({}))) as
        | AmazonCanonicalSyncResponse
        | (DetailFail & { code?: string });
      if (!res.ok || json.ok === false) {
        const raw = "error" in json ? json.error : `HTTP ${res.status}`;
        setAmazonRefreshError(
          res.status === 429 || ("code" in json && json.code === "rate_limited")
            ? "Amazon ha limitado temporalmente las consultas. Se mantiene el último snapshot válido."
            : raw,
        );
        return;
      }
      const result = json.summary;
      setAmazonRefreshMessage(
        result.action === "skipped_rate_limit"
          ? "Amazon sigue en cooldown por rate limit. Se mantiene el último snapshot válido."
          : result.action === "skipped_running"
          ? "Ya hay una actualización de Amazon en curso. No se ha iniciado una segunda petición."
          : result.action === "skipped_fresh"
          ? "El snapshot sigue fresco; no se ha vuelto a consultar Amazon."
          : `Actualizado: ${result.inventory?.rowsUpserted ?? 0} filas de stock y ${result.inbound?.linesUpserted ?? 0} líneas inbound.`,
      );
      if (selectedProductId) await loadDetail(selectedProductId, simulationOverride);
    } catch (error) {
      setAmazonRefreshError(
        error instanceof Error ? error.message : "Error de red actualizando Amazon.",
      );
    } finally {
      setAmazonRefreshLoading(false);
    }
  }

  /**
   * Importa pedidos Amazon por fecha de compra (FBA+FBM, incluidos pendientes) de los
   * últimos 90 días. Amazon genera el informe en diferido: si queda pendiente, volver
   * a pulsar reanuda el mismo trabajo.
   */
  async function refreshAmazonOrders() {
    if (ordersRefreshLoading) return;
    setOrdersRefreshLoading(true);
    setOrdersRefreshMessage(null);
    setOrdersRefreshError(null);
    try {
      const toDate = localIsoDate();
      const range = buildInclusiveDateWindow(toDate, 90);
      const res = await fetch("/api/amazon/reports/all-orders/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ordersRefreshJobId ? { jobId: ordersRefreshJobId } : range),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        jobId?: string;
        rowsUpserted?: number;
        unmatchedRows?: number;
        error?: string;
      };
      if (res.status === 202 && json.status === "PENDING") {
        if (json.jobId) setOrdersRefreshJobId(json.jobId);
        setOrdersRefreshMessage(
          "Amazon está generando el informe de pedidos. Vuelve a pulsar «Actualizar pedidos Amazon» en un par de minutos.",
        );
        return;
      }
      if (!res.ok || json.status !== "COMPLETED") {
        setOrdersRefreshJobId(null);
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setOrdersRefreshJobId(null);
      setOrdersRefreshMessage(
        `Pedidos Amazon actualizados (${json.rowsUpserted ?? 0} líneas${
          json.unmatchedRows ? `, ${json.unmatchedRows} sin producto enlazado` : ""
        }).`,
      );
      if (selectedProductId) {
        await loadDetail(selectedProductId, simulationOverride);
      }
    } catch (error) {
      setOrdersRefreshError(error instanceof Error ? error.message : "Error actualizando pedidos Amazon.");
    } finally {
      setOrdersRefreshLoading(false);
    }
  }

  async function refreshAmazonSales() {
    if (salesRefreshLoading) return;
    setSalesRefreshLoading(true);
    setSalesRefreshMessage(null);
    setSalesRefreshError(null);
    try {
      const toDate = new Date().toISOString().slice(0, 10);
      const range = salesRefreshJob ?? buildInclusiveDateWindow(toDate, 90);
      const res = await fetch("/api/amazon/reports/fba-sales/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(salesRefreshJob ? {jobId:salesRefreshJob.jobId} : range),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; status?: string; jobId?: string; error?: string };
      if (res.status === 202 && ["PENDING", "PROCESSING", "RATE_LIMITED"].includes(json.status ?? "")) {
        if (json.jobId) setSalesRefreshJob({jobId:json.jobId,fromDate:range.fromDate,toDate:range.toDate});
        setSalesRefreshMessage(`Sincronización Amazon pendiente (${json.status}). Trabajo: ${json.jobId ?? ""}. Las ventas aún no están actualizadas para todo el rango.`);
        return;
      }
      if (json.status !== "COMPLETED" || !res.ok || json.ok !== true) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSalesRefreshJob(null);
      setSalesRefreshMessage(`Ventas Amazon actualizadas: ${range.fromDate} a ${range.toDate}.`);
      if (selectedProductId) {
        await loadDetail(selectedProductId, simulationOverride);
      }
    } catch (error) {
      setSalesRefreshError(error instanceof Error ? error.message : "Error actualizando ventas Amazon.");
    } finally {
      setSalesRefreshLoading(false);
    }
  }

  const flatProducts = listData ? flattenProducts(listData.products) : [];

  const normalizedSearch = search.trim().toLowerCase();
  
  const filteredLiteProducts = useMemo(() => {
    if (!normalizedSearch) return liteProducts;
  
    return liteProducts.filter((product) => {
      const sku = product.sku?.toLowerCase() ?? "";
      const nombre = product.nombre?.toLowerCase() ?? "";
  
      return (
        sku.includes(normalizedSearch) ||
        nombre.includes(normalizedSearch)
      );
    });
  }, [liteProducts, normalizedSearch]);
  
  const showLiteProducts = !listData && liteProducts.length > 0;
  
  const visibleProductsCount = listData
    ? flatProducts.length
    : filteredLiteProducts.length;

  const parentOfSelected = listData?.products.find(
    (p) =>
      p.productoId === selectedId ||
      p.variantes.some((v) => v.productoId === selectedId),
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <Title>Inventario</Title>
        <Text className="mt-1 text-slate-600">
          Stock por país, canal, cobertura y previsión de reposición.
        </Text>
        <Text className="mt-2 text-xs text-slate-500">
          El forecast anual se calcula con el año natural anterior completo. Los
          filtros de país y canal sí se aplican; la ventana global solo afecta a
          KPIs recientes.
        </Text>
      </div>
      {listData?.summary ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            { label: "Productos", value: listData.summary.totalProducts },
            { label: "En riesgo", value: listData.summary.productsAtRisk },
            { label: "Stock 0", value: listData.summary.productsStockZero },
            { label: "Sin histórico", value: listData.summary.productsNoHistory },
            { label: "Con inbound", value: listData.summary.productsWithInbound },
          ].map(({ label, value }) => (
            <Card key={label} className="ring-1 ring-slate-100 p-3">
              <Text className="text-xs text-slate-500">{label}</Text>
              <p className="text-lg font-semibold text-slate-900">{value}</p>
            </Card>
          ))}
        </div>
      ) : null}

      <Card className="ring-1 ring-slate-100 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <Text className="mb-1 text-xs text-slate-500">Buscar SKU / nombre</Text>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="SKU, nombre, proveedor…"
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
              />
            </div>
          </label>
          <label className="block">
            <Text className="mb-1 text-xs text-slate-500">Categoría</Text>
            <select
              value={categoriaFilter}
              onChange={(e) => setCategoriaFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="ALL">Todas</option>
              {(listData?.categorias ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <Text className="mb-1 text-xs text-slate-500">Proveedor</Text>
            <select
              value={proveedorFilter}
              onChange={(e) => setProveedorFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="ALL">Todos</option>
              {(listData?.proveedores ?? []).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <LedgerSyncButton onCompleted={() => {
              if (selectedProductId) void loadDetail(selectedProductId, simulationOverride);
            }} />
            <FbmSyncButton onCompleted={() => {
              void loadList();
              if (selectedProductId) void loadDetail(selectedProductId, simulationOverride);
            }} />
            <button
              type="button"
              onClick={() => void refreshAmazonInventory()}
              disabled={amazonRefreshLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {amazonRefreshLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {amazonRefreshLoading ? "Actualizando Amazon…" : "Actualizar inventario Amazon"}
            </button>
            <button
              type="button"
              onClick={() => void refreshAmazonSales()}
              disabled={salesRefreshLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {salesRefreshLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {salesRefreshLoading ? "Actualizando ventas…" : "Actualizar ventas Amazon"}
            </button>
            <button
              type="button"
              onClick={() => void refreshAmazonOrders()}
              disabled={ordersRefreshLoading}
              title="Pedidos por fecha de compra (FBA + FBM, incluidos pendientes), como Shopkeeper"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {ordersRefreshLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {ordersRefreshLoading ? "Actualizando pedidos…" : "Actualizar pedidos Amazon"}
            </button>
          </div>
        </div>
        {amazonRefreshMessage ? <Text className="mt-3 text-xs text-emerald-700">{amazonRefreshMessage}</Text> : null}
        {amazonRefreshError ? <Text className="mt-3 text-xs text-rose-700">{amazonRefreshError}</Text> : null}
        {salesRefreshMessage ? <Text className="mt-3 text-xs text-emerald-700">{salesRefreshMessage}</Text> : null}
        {salesRefreshError ? <Text className="mt-3 text-xs text-rose-700">{salesRefreshError}</Text> : null}
        {ordersRefreshMessage ? <Text className="mt-3 text-xs text-emerald-700">{ordersRefreshMessage}</Text> : null}
        {ordersRefreshError ? <Text className="mt-3 text-xs text-rose-700">{ordersRefreshError}</Text> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { key: "criticos", label: "Solo críticos", value: soloCriticos, set: setSoloCriticos },
            { key: "stock0", label: "Stock 0", value: stockZero, set: setStockZero },
            { key: "nohist", label: "Sin histórico", value: sinHistorico, set: setSinHistorico },
            { key: "inbound", label: "Con inbound", value: conInbound, set: setConInbound },
          ].map(({ key, label, value, set }) => (
            <button
              key={key}
              type="button"
              onClick={() => set(!value)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                value
                  ? "bg-slate-900 text-white ring-slate-900"
                  : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      {listError ? (
        <Card className="border-rose-200 bg-rose-50 p-4 text-rose-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            {listError}
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="ring-1 ring-slate-100 p-4 lg:col-span-1">
          <Title className="text-base">Productos</Title>
          <Text className="mb-3 text-xs text-slate-500">
            {listLoading && !showLiteProducts
              ? "Cargando…"
              : `${visibleProductsCount} productos visibles`}
          </Text>
          <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
            {listLoading && !showLiteProducts ? (
              <div className="flex items-center justify-center py-8 text-slate-500">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Cargando productos…
              </div>
            ) : listData ? (
              (listData?.products ?? []).map((p) => {
                const active =
                  selectedId === p.productoId ||
                  p.variantes.some((v) => v.productoId === selectedId);
                const worstRisk = [p, ...p.variantes].reduce<InventoryRiskLevel>(
                  (acc, x) => {
                    if (x.risk === "critico") return "critico";
                    if (x.risk === "bajo" && acc !== "critico") return "bajo";
                    return acc;
                  },
                  "saludable",
                );
                return (
                  <button
                    key={p.productoId}
                    type="button"
                    onClick={() => setSelectedId(p.productoId)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      active
                        ? "border-slate-400 bg-slate-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                          {p.imagenUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.imagenUrl}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Package className="h-4 w-4 text-slate-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {p.nombre}
                          </p>
                          <p className="text-xs text-slate-500">
                            {p.sku}
                            {p.variantes.length > 0
                              ? ` · ${p.variantes.length} variantes`
                              : ""}
                          </p>
                          <p className="mt-1 text-[10px] font-medium text-slate-400">
                            {p.hasFbaSnapshot ? "FBA SP-API" : "Legacy país"}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${riskBadgeClass(worstRisk)}`}
                      >
                        {riskLabel(worstRisk)}
                      </span>
                    </div>
                  </button>
                );
              })
            ) : (
            filteredLiteProducts.map((p) => {
                const active = selectedId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      active
                        ? "border-slate-400 bg-slate-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                        <Package className="h-4 w-4 text-slate-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {p.nombre ?? p.sku}
                        </p>
                        <p className="text-xs text-slate-500">{p.sku}</p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {detailLoading && !detail ? (
            <Card className="flex items-center justify-center p-12 ring-1 ring-slate-100">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-slate-500" />
              <Text>Cargando detalle…</Text>
            </Card>
          ) : detailError ? (
            <Card className="border-rose-200 bg-rose-50 p-4 text-rose-800">
              {detailError}
            </Card>
          ) : detail ? (
            <>
              <Card className="ring-1 ring-slate-100 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex gap-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                      {detail.product.imagenUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={detail.product.imagenUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <Package className="h-6 w-6 text-slate-400" />
                        </div>
                      )}
                    </div>
                    <div>
                      <Title className="text-lg">{detail.product.nombre}</Title>
                      <Text className="font-mono text-xs text-slate-500">
                        {detail.product.sku}
                      </Text>
                      <Text className="text-xs text-slate-600">
                        {detail.product.proveedorNombre ?? "Sin proveedor"}
                        {detail.product.categoria
                          ? ` · ${detail.product.categoria}`
                          : ""}
                      </Text>
                      {parentOfSelected && parentOfSelected.variantes.length > 0 ? (
                        <select
                          value={
                            variantByParent[parentOfSelected.productoId] ??
                            selectedProduct?.productoId ??
                            detail.product.productoId
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            simulationProductIdRef.current = null;
                            setSimulationOverride(null);
                            setVariantByParent((prev) => ({
                              ...prev,
                              [parentOfSelected.productoId]: v,
                            }));
                          }}
                          className="mt-2 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                        >
                          <option value={parentOfSelected.productoId}>
                            Padre ({parentOfSelected.sku})
                          </option>
                          {parentOfSelected.variantes.map((v) => (
                            <option key={v.productoId} value={v.productoId}>
                              {v.sku} · {v.nombre}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  </div>
                  <Link
                    href={`/${locale}/productos/${detail.product.productoId}`}
                    className="text-sm text-blue-700 hover:underline"
                  >
                    Ver ficha producto
                  </Link>
                </div>

                <InventoryKpiGrid
                  detail={detail}
                  forecast={forecastData?.forecast}
                  onOpenSales={() => setSalesModalOpen(true)}
                />
              </Card>

              {detail.operationalStock ? (
                <OperationalStockPanel stock={detail.operationalStock} />
              ) : null}

{forecastData?.etaRisk ? (
  <Card className="ring-1 ring-slate-100 p-4">
    <Title className="text-base">Riesgo ETA</Title>

    {forecastData.etaRisk.stockoutBeforeInbound ? (
      <div className="mt-2 text-sm text-rose-700">
        <p className="font-semibold">
          Rotura prevista {fmtDate(forecastData.etaRisk.stockoutDate)}
        </p>

        <p>
          Próxima llegada confirmada:{" "}
          {fmtDate(forecastData.etaRisk.nextRelevantConfirmedEta)}
        </p>

        <p>
          Gap sin stock:{" "}
          {forecastData.etaRisk.gapDays == null
            ? "sin llegada confirmada posterior"
            : `${forecastData.etaRisk.gapDays} días`}
        </p>

        <p className="mt-2 text-xs text-slate-500">
          Acciones informativas: revisar precio · revisar publicidad · acelerar
          reposición.
        </p>
      </div>
    ) : (
      <Text className="mt-2 text-emerald-700">OK</Text>
    )}
  </Card>
) : null}

              <Card className="ring-1 ring-slate-100 p-4">
                <Title className="text-base mb-1">Stock físico por país</Title>
                <Text className="mb-3 text-xs text-slate-500">Distribución logística del Inventory Ledger; no se suma como FBA operativo.</Text>
                <CountryStockTableV2
                  countries={detail.countries}
                  expandedPais={expandedPais}
                  lotesLoading={lotesLoading}
                  lotesData={lotesData}
                  periodLabel={detail.periodLabel}
                  periodFrom={detail.periodFrom}
                  periodTo={detail.periodTo}
                  onToggleLotes={toggleLotes}
                  onOpenPriceDistribution={openPriceDistribution}
                />
              </Card>

              <Card className="ring-1 ring-slate-100 p-4">
                <Title className="text-base mb-1">Entradas previstas</Title>
                <Text className="mb-3 text-xs text-slate-500">
                  Entradas ya registradas en pedidos y logística. El forecast anual las
                  incorpora como stock futuro en la simulación mensual.
                </Text>
                <InboundSection inbound={detail.inbound} locale={locale} />
              </Card>

             
              {forecastLoading && !forecastData ? (
  <Card className="ring-1 ring-slate-100 p-4">
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      Calculando forecast…
    </div>
  </Card>
) : forecastError ? (
  <Card className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
    {forecastError}
  </Card>
) : forecastData ? (
  <Card className="ring-1 ring-slate-100 p-4">
    <Title className="mb-3 text-base">Simulación de forecast</Title>

    <InventoryForecastSimulationPanel
      productId={detail.product.productoId}
      isSimulationActive={isSimulationActiveForSelectedProduct}
      dataAvailability={
        forecastData.annualForecast.methodInfo?.dataAvailability ?? {
          hasOwnSales:
            forecastData.annualForecast.previousYearTotalUnits > 0,
          hasBenchmark: false,
        }
      }
      stockoutRiskHint={
        detail.product.risk === "critico" ||
        detail.product.risk === "bajo"
      }
      onSimulate={async (override) => {
        simulationProductIdRef.current = detail.product.productoId;
        setSimulationOverride(override);
      }}
      onSaved={async () => {
        simulationProductIdRef.current = null;
        setSimulationOverride(null);
      }}
    />
  </Card>
) : null}



  {fullDetail ? (
  <Card className="ring-1 ring-slate-100 p-4">
    <Title className="mb-2 text-base">Forecast / reposición</Title>

    <ForecastPanel
      detail={fullDetail}
      simulationActive={isSimulationActiveForSelectedProduct}
    />
  </Card>
) : null}


{fullDetail ? (
  <Card className="ring-1 ring-slate-100 p-4">
    <Title className="mb-1 text-base">Forecast anual</Title>

    <Text className="mb-3 text-xs text-slate-500">
      Combina histórico del año base, stock operativo actual y entradas
      previstas para proyectar el año en curso.
    </Text>

    <AnnualForecastPanel
      detail={fullDetail}
      simulationActive={isSimulationActiveForSelectedProduct}
      showStockoutDebug={showStockoutDebug}
    />
  </Card>
) : null}

</>
) : (
  <Card className="p-8 text-center text-slate-500 ring-1 ring-slate-100">
    Selecciona un producto para ver el detalle.
  </Card>
)}
</div>
</div>
      <PriceDistributionModal
        state={priceDistributionModal}
        onClose={() => setPriceDistributionModal(null)}
      />
      {detail ? (
        <SalesByCountryModal
          open={salesModalOpen}
          onClose={() => setSalesModalOpen(false)}
          productId={detail.product.productoId}
          productName={detail.product.nombre}
          periodLabel={detail.periodLabel}
          periodFrom={detail.periodFrom}
          periodTo={detail.periodTo}
          canal={canal}
          pais={pais}
          allSourcesUnits={detail.product.salesUnitsPeriod}
        />
      ) : null}
    </div>
  );
}

function CountryStockTableV2({
  countries,
  expandedPais,
  lotesLoading,
  lotesData,
  periodLabel,
  periodFrom,
  periodTo,
  onToggleLotes,
  onOpenPriceDistribution,
}: {
  countries: InventoryCountryStockRow[];
  expandedPais: string | null;
  lotesLoading: boolean;
  lotesData: InventoryLotesResponse | null;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  onToggleLotes: (pais: string) => void;
  onOpenPriceDistribution: (
    pais: string,
    range: { label: string; fromDate?: string; toDate?: string; windowDays?: 30 | 90 },
  ) => void;
}) {
  if (countries.length === 0) {
    return <Text className="text-sm text-slate-500">Sin evidencia Ledger certificada para este producto; pendiente de sincronización.</Text>;
  }

  const latestSnapshot =
    countries
      .map((row) => row.stockFbaLedgerSnapshotDate)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => b.localeCompare(a))[0] ?? null;
  const staleRows = countries.filter((row) => row.stockFbaLedgerStale);
  const oldestStaleSnapshot =
    staleRows
      .map((row) => row.stockFbaLedgerSnapshotDate)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null;
  const today = localIsoDate();
  const totalInTransit = countries.reduce((s, row) => s + (row.stockFbaInTransit ?? 0), 0);
  const totalResale = countries.reduce((s, row) => s + (row.stockFbaResaleSellable ?? 0), 0);
  const totalUnknownCondition = countries.reduce((s, row) => s + (row.stockFbaUnknownConditionSellable ?? 0), 0);

  return (
    <>
      <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        <p className="font-medium">
          Fuente FBA: Inventory Ledger Amazon. Ultimo snapshot:{" "}
          {latestSnapshot ?? "sin evidencia Ledger certificada; pendiente de primera sincronización"}
        </p>
        <p className="mt-1">Saldo físico al cierre del día; no equivale a disponibilidad instantánea.</p>
        {countries.some(row => row.stockFbaLedgerSnapshotDate && !row.stockFbaLedgerCoverageValid) ? (
          <p className="mt-1 text-amber-700">Cobertura incompleta: la ausencia de un país no demuestra stock cero.</p>
        ) : null}
        {totalUnknownCondition > 0 ? (
          <p className="mt-1 text-amber-700">SELLABLE con condición desconocida: {fmtNum(totalUnknownCondition)} uds físicas, separadas del stock nuevo.</p>
        ) : null}
        {totalInTransit > 0 ? (
          <p className="mt-1 text-sky-800">
            En tránsito entre almacenes de Amazon: {fmtNum(totalInTransit)} uds (no suman al stock de ningún país).
          </p>
        ) : null}
        {totalResale > 0 ? (
          <p className="mt-1 text-slate-500">
            Grade &amp; Resell (amzn.gr): {fmtNum(totalResale)} uds vendibles, separadas del stock nuevo.
          </p>
        ) : null}
        {staleRows.length > 0 ? (
          <p className="mt-1 text-amber-700">
            Advertencia: Inventory Ledger FBA no actualizado desde{" "}
            {oldestStaleSnapshot ?? "fecha desconocida"}.
          </p>
        ) : null}
      </div>
      <ResponsiveTable
        desktop={
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="w-8 py-2 pr-2" />
                <th className="py-2 pr-3">Pais</th>
                <th className="py-2 pr-3 text-right">FBA vendible</th>
                <th className="py-2 pr-3 text-right">FBM</th>
                <th className="py-2 pr-3 text-right" title="FBA vendible + FBM">
                  Total
                </th>
                <th className="py-2 pr-3 text-right">
                  <span className="block">Ventas</span>
                  <span className="block text-[10px] font-normal text-slate-400">
                    {periodLabel}
                  </span>
                </th>
                <th className="py-2 pr-3 text-right">Ultima act. FBA</th>
                <th className="py-2 pr-3 text-right">Precio hoy</th>
                <th className="py-2 pr-3 text-right">
                  <span className="block">Precio top</span>
                  <span className="block text-[10px] font-normal text-slate-400">
                    {periodLabel}
                  </span>
                </th>
                <th className="py-2 pr-3 text-right">Cobertura</th>
                <th className="py-2 pr-3">Riesgo</th>
              </tr>
            </thead>
            <tbody>
              {countries.map((row) => (
                <React.Fragment key={row.pais}>
                  <tr className="border-b border-slate-100 align-middle">
                    <td className="py-1.5 pr-2">
                      <button
                        type="button"
                        onClick={() => onToggleLotes(row.pais)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Ver lotes"
                      >
                        {expandedPais === row.pais ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                    <td className="py-1.5 pr-3 font-medium">
                      <div className="flex items-center gap-2">
                        <span className="text-base leading-none">{countryFlag(row.pais)}</span>
                        <div className="flex flex-col">
                          <span>{row.pais.toUpperCase()}</span>
                          {row.stockFbaLedgerStale ? (
                            <span className="text-[10px] font-normal text-amber-700">
                              Ledger {row.stockFbaLedgerSnapshotDate}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium">
                      {fmtNum(row.stockFba)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium">
                      {fmtNum(row.stockFbm)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-semibold text-slate-900">
                      {fmtNum(row.stockTotal)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium">
                      {fmtNum(row.salesUnitsPeriod)}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-slate-700">
                      {row.stockFbaLastImportedAt
                        ? fmtDateTime(row.stockFbaLastImportedAt)
                        : row.stockFbaLedgerSnapshotDate
                          ? fmtDate(row.stockFbaLedgerSnapshotDate)
                          : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <TopPriceMetric
                        price={row.priceToday}
                        units={row.priceTodayUnits}
                        emptyLabel="Sin ventas hoy"
                        onClick={() =>
                          onOpenPriceDistribution(row.pais, {
                            label: "Hoy",
                            fromDate: today,
                            toDate: today,
                          })
                        }
                      />
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <TopPriceMetric
                        price={row.priceTopPeriod}
                        units={row.priceTopPeriodUnits}
                        emptyLabel="Sin ventas"
                        onClick={() =>
                          onOpenPriceDistribution(row.pais, {
                            label: periodLabel,
                            fromDate: periodFrom,
                            toDate: periodTo,
                          })
                        }
                      />
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {row.coverageDays != null ? `${Math.round(row.coverageDays)} d` : "—"}
                    </td>
                    <td className="py-1.5 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${riskBadgeClass(row.risk)}`}
                      >
                        {riskLabel(row.risk)}
                      </span>
                    </td>
                  </tr>
                  {expandedPais === row.pais ? (
                    <tr className="bg-slate-50">
                      <td colSpan={11} className="p-4">
                        <CountryLedgerStockDetail row={row} />
                        <CountryDemandDetail row={row} periodLabel={periodLabel} />
                        <div className="mt-4">
                          <LotesPanel loading={lotesLoading} data={lotesData} />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        }
        mobile={
          <div className="space-y-3">
            {countries.map((row) => (
              <div key={row.pais}>
                <ResponsiveDataCard
                  title={`${countryFlag(row.pais)} ${row.pais.toUpperCase()}`}
                  badges={
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${riskBadgeClass(row.risk)}`}
                    >
                      {riskLabel(row.risk)}
                    </span>
                  }
                  fields={[
                    { label: "FBA vendible", value: fmtNum(row.stockFba) },
                    { label: "FBM", value: fmtNum(row.stockFbm) },
                    { label: "Total", value: fmtNum(row.stockTotal) },
                    { label: `Ventas ${periodLabel}`, value: fmtNum(row.salesUnitsPeriod) },
                    {
                      label: "Ultima act. FBA",
                      value: row.stockFbaLastImportedAt
                        ? fmtDateTime(row.stockFbaLastImportedAt)
                        : row.stockFbaLedgerSnapshotDate
                          ? fmtDate(row.stockFbaLedgerSnapshotDate)
                          : "—",
                    },
                    {
                      label: "Precio hoy",
                      value: (
                        <TopPriceMetric
                          price={row.priceToday}
                          units={row.priceTodayUnits}
                          emptyLabel="Sin ventas hoy"
                          onClick={() =>
                            onOpenPriceDistribution(row.pais, {
                              label: "Hoy",
                              fromDate: today,
                              toDate: today,
                            })
                          }
                        />
                      ),
                    },
                    {
                      label: `Precio top ${periodLabel}`,
                      value: (
                        <TopPriceMetric
                          price={row.priceTopPeriod}
                          units={row.priceTopPeriodUnits}
                          emptyLabel="Sin ventas"
                          onClick={() =>
                            onOpenPriceDistribution(row.pais, {
                              label: periodLabel,
                              fromDate: periodFrom,
                              toDate: periodTo,
                            })
                          }
                        />
                      ),
                    },
                    {
                      label: "Cobertura",
                      value:
                        row.coverageDays != null
                          ? `${Math.round(row.coverageDays)} dias`
                          : "—",
                    },
                  ]}
                  footer={
                    <button
                      type="button"
                      onClick={() => onToggleLotes(row.pais)}
                      className="text-xs font-medium text-blue-700"
                    >
                      {expandedPais === row.pais ? "Ocultar lotes" : "Ver lotes"}
                    </button>
                  }
                />
                {expandedPais === row.pais ? (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <CountryLedgerStockDetail row={row} />
                    <CountryDemandDetail row={row} periodLabel={periodLabel} />
                    <div className="mt-4">
                      <LotesPanel loading={lotesLoading} data={lotesData} />
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        }
      />
    </>
  );
}

function TopPriceMetric({
  price,
  units,
  emptyLabel,
  onClick,
}: {
  price: number | null | undefined;
  units: number | null | undefined;
  emptyLabel: string;
  onClick: () => void;
}) {
  if (price == null) {
    return (
      <span className="inline-flex flex-col items-end text-right">
        <span className="text-slate-400">-</span>
        <span className="text-[10px] font-normal text-slate-400">{emptyLabel}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex flex-col items-end rounded px-1.5 py-0.5 text-right font-medium text-blue-700 hover:bg-blue-50"
      title="Ver distribucion de precios"
    >
      <span>{fmtCurrency(price)}</span>
      {units != null ? (
        <span className="text-[10px] font-normal text-slate-500">
          {fmtNum(units)} uds
        </span>
      ) : null}
    </button>
  );
}

function CountryStockTable({
  countries,
  expandedPais,
  lotesLoading,
  lotesData,
  onToggleLotes,
  onOpenPriceDistribution,
}: {
  countries: InventoryCountryStockRow[];
  expandedPais: string | null;
  lotesLoading: boolean;
  lotesData: InventoryLotesResponse | null;
  onToggleLotes: (pais: string) => void;
  onOpenPriceDistribution: (pais: string, windowDays: 30 | 90) => void;
}) {
  if (countries.length === 0) {
    return <Text className="text-sm text-slate-500">Sin inventario por país.</Text>;
  }

  const latestSnapshot =
    countries
      .map((row) => row.stockFbaLedgerSnapshotDate)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => b.localeCompare(a))[0] ?? null;
  const staleRows = countries.filter((row) => row.stockFbaLedgerStale);
  const oldestStaleSnapshot =
    staleRows
      .map((row) => row.stockFbaLedgerSnapshotDate)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null;

  return (
    <>
      <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <p className="font-medium">
          Fuente FBA: Inventory Ledger Amazon. Ultimo snapshot:{" "}
          {latestSnapshot ?? "sin snapshot"}
        </p>
        {staleRows.length > 0 ? (
          <p className="mt-1 text-amber-700">
            Advertencia: Inventory Ledger FBA no actualizado desde{" "}
            {oldestStaleSnapshot ?? "fecha desconocida"}.
          </p>
        ) : null}
      </div>
      <ResponsiveTable
        desktop={
          <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-2 w-8" />
              <th className="py-2 pr-3">País</th>
              <th
                className="py-2 pr-3 text-right"
                title="Stock FBA vendible desde el ultimo Inventory Ledger por ubicacion, disposition SELLABLE."
              >
                FBA vendible
              </th>
              <th
                className="py-2 pr-3 text-right"
                title="Stock FBA no apto desde el ultimo Inventory Ledger por ubicacion: damaged, defective u otras disposiciones no SELLABLE."
              >
                FBA no apto
              </th>
              <th
                className="py-2 pr-3 text-right"
                title="Stock fisico FBA total: vendible + no apto."
              >
                FBA fisico
              </th>
              <th className="py-2 pr-3 text-right">FBM</th>
              <th className="py-2 pr-3 text-right">Total</th>

              <th
                className="py-2 pr-3 text-right"
                title="Unidades FBA enviadas agrupadas por marketplace de venta, según sales-channel del informe Amazon."
              >
                Ventas 30d
              </th>
              <th
                className="py-2 pr-3 text-right"
                title="Unidades FBA enviadas agrupadas por marketplace de venta, según sales-channel del informe Amazon."
              >
                Ventas 90d
              </th>
              <th className="py-2 pr-3 text-right">Ultima act. FBA</th>
              <th className="py-2 pr-3 text-right">Precio top 30d</th>
              <th className="py-2 pr-3 text-right">Precio top 90d</th>
              <th className="py-2 pr-3 text-right">Cobertura</th>
              <th className="py-2 pr-3">Riesgo</th>
            </tr>
          </thead>
          <tbody>
            {countries.map((row) => (
              <React.Fragment key={row.pais}>
                <tr className="border-b border-slate-100">
                  <td className="py-2 pr-2">
                    <button
                      type="button"
                      onClick={() => onToggleLotes(row.pais)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label="Ver lotes"
                    >
                      {expandedPais === row.pais ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                  <td className="py-2 pr-3 font-medium">
                    <div className="flex flex-col">
                      <span>{row.pais}</span>
                      {row.stockFbaLedgerStale ? (
                        <span className="text-[11px] font-normal text-amber-700">
                          Ledger {row.stockFbaLedgerSnapshotDate}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right">{fmtNum(row.stockFba)}</td>
                  <td className="py-2 pr-3 text-right">{fmtNum(row.stockFbaUnsellable)}</td>
                  <td className="py-2 pr-3 text-right">{fmtNum(row.stockFbaPhysicalTotal)}</td>
                  <td className="py-2 pr-3 text-right">{fmtNum(row.stockFbm)}</td>
                  <td className="py-2 pr-3 text-right">{fmtNum(row.stockTotal)}</td>
                  <td className="py-2 pr-3 text-right">{fmtNum(row.marketplaceSalesUnits30)}</td>
                  <td className="py-2 pr-3 text-right">{fmtNum(row.marketplaceSalesUnits90)}</td>
                  <td className="py-2 pr-3 text-right">
                    {row.stockFbaLastImportedAt
                      ? fmtDateTime(row.stockFbaLastImportedAt)
                      : row.stockFbaLedgerSnapshotDate
                        ? fmtDate(row.stockFbaLedgerSnapshotDate)
                        : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <TopPriceButton
                      price={row.priceTop30d}
                      units={row.priceTop30dUnits}
                      onClick={() => onOpenPriceDistribution(row.pais, 30)}
                    />
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <TopPriceButton
                      price={row.priceTop90d}
                      units={row.priceTop90dUnits}
                      onClick={() => onOpenPriceDistribution(row.pais, 90)}
                    />
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {row.coverageDays != null
                      ? `${Math.round(row.coverageDays)} d`
                      : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ring-1 ${riskBadgeClass(row.risk)}`}
                    >
                      {riskLabel(row.risk)}
                    </span>
                  </td>
                </tr>
                {expandedPais === row.pais ? (
                  <tr className="bg-slate-50">
                    <td colSpan={16} className="p-4">
                      <CountryLedgerStockDetail row={row} />
                      <CountryDemandDetail row={row} />
                      <div className="mt-4">
                        <LotesPanel loading={lotesLoading} data={lotesData} />
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      }
      mobile={
        <div className="space-y-3">
          {countries.map((row) => (
            <div key={row.pais}>
              <ResponsiveDataCard
                title={row.pais}
                badges={
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${riskBadgeClass(row.risk)}`}
                  >
                    {riskLabel(row.risk)}
                  </span>
                }
                fields={[
                  { label: "FBA vendible", value: fmtNum(row.stockFba) },
                  { label: "FBA no apto", value: fmtNum(row.stockFbaUnsellable) },
                  {
                    label: "FBA fisico",
                    value: fmtNum(row.stockFbaPhysicalTotal),
                  },
                  { label: "FBM", value: fmtNum(row.stockFbm) },
                  { label: "Total operativo", value: fmtNum(row.stockTotal) },

                  {
                    label: "Ventas 30d",
                    value: fmtNum(row.marketplaceSalesUnits30),
                  },
                  {
                    label: "Ventas 90d",
                    value: fmtNum(row.marketplaceSalesUnits90),
                  },
                  {
                    label: "Ultima act. FBA",
                    value: row.stockFbaLastImportedAt
                      ? fmtDateTime(row.stockFbaLastImportedAt)
                      : row.stockFbaLedgerSnapshotDate
                        ? fmtDate(row.stockFbaLedgerSnapshotDate)
                        : "—",
                  },
                  {
                    label: "Precio top 30d",
                    value: (
                      <TopPriceButton
                        price={row.priceTop30d}
                        units={row.priceTop30dUnits}
                        onClick={() => onOpenPriceDistribution(row.pais, 30)}
                      />
                    ),
                  },
                  {
                    label: "Precio top 90d",
                    value: (
                      <TopPriceButton
                        price={row.priceTop90d}
                        units={row.priceTop90dUnits}
                        onClick={() => onOpenPriceDistribution(row.pais, 90)}
                      />
                    ),
                  },
                  {
                    label: "Cobertura",
                    value:
                      row.coverageDays != null
                        ? `${Math.round(row.coverageDays)} días`
                        : "—",
                  },
                ]}
                footer={
                  <button
                    type="button"
                    onClick={() => onToggleLotes(row.pais)}
                    className="text-xs font-medium text-blue-700"
                  >
                    {expandedPais === row.pais ? "Ocultar lotes" : "Ver lotes"}
                  </button>
                }
              />
              {expandedPais === row.pais ? (
                <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <CountryLedgerStockDetail row={row} />
                  <CountryDemandDetail row={row} />
                  <div className="mt-4">
                    <LotesPanel loading={lotesLoading} data={lotesData} />
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      }
      />
    </>
  );
}

function CountryLedgerStockDetail({ row }: { row: InventoryCountryStockRow }) {
  const hasLedger = row.stockFbaLedgerSnapshotDate != null;
  const appDiff = row.stockFbaApp - row.stockFba;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            Stock FBA Inventory Ledger
          </p>
          <p className="text-xs text-slate-500">
            Vendible usa solo disposition SELLABLE. No apto queda separado y no
            alimenta cobertura.
          </p>
        </div>
        <div className="text-left text-xs text-slate-600 sm:text-right">
          <p>
            Snapshot: {row.stockFbaLedgerSnapshotDate ?? "sin ledger por ubicacion"}
          </p>
          <p>
            Ultima importacion:{" "}
            {row.stockFbaLastImportedAt
              ? fmtDateTime(row.stockFbaLastImportedAt)
              : "sin fecha"}
          </p>
          {row.stockFbaLedgerStale ? (
            <p className="font-medium text-amber-700">
              Ledger FBA desactualizado: ultimo snapshot{" "}
              {row.stockFbaLedgerSnapshotDate}
              {row.stockFbaLedgerStaleDays != null
                ? ` (${fmtNum(row.stockFbaLedgerStaleDays)} dias)`
                : ""}
            </p>
          ) : null}
          <p>
            inventario_paises.stock_fba: {fmtNum(row.stockFbaApp)} uds
            {hasLedger ? ` | diff vs vendible: ${fmtNum(appDiff)} uds` : ""}
          </p>
        </div>
      </div>

      {(row.stockFbaInTransit ?? 0) > 0 || (row.stockFbaResaleSellable ?? 0) > 0 ? (
        <p className="mt-2 text-xs text-slate-600">
          {(row.stockFbaInTransit ?? 0) > 0
            ? `En tránsito entre almacenes: ${fmtNum(row.stockFbaInTransit)} uds. `
            : ""}
          {(row.stockFbaResaleSellable ?? 0) > 0
            ? `Grade & Resell vendible: ${fmtNum(row.stockFbaResaleSellable)} uds.`
            : ""}
        </p>
      ) : null}
      {hasLedger ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">FBA vendible</p>
            <p className="text-sm font-semibold text-slate-900">
              {fmtNum(row.stockFba)} uds
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">FBA no apto</p>
            <p className="text-sm font-semibold text-slate-900">
              {fmtNum(row.stockFbaUnsellable)} uds
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">FBA fisico</p>
            <p className="text-sm font-semibold text-slate-900">
              {fmtNum(row.stockFbaPhysicalTotal)} uds
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-amber-700">
          Sin ledger por ubicacion para este pais; se conserva el fallback de
          inventario_paises.
        </p>
      )}
    </div>
  );
}

function CountryDemandDetail({
  row,
  periodLabel,
}: {
  row: InventoryCountryStockRow;
  periodLabel?: string;
}) {
  const channelLabel =
    row.marketplaceSalesChannels.length > 0
      ? row.marketplaceSalesChannels.join(", ")
      : `Marketplace ${row.pais}`;
  const hasMarketplaceDemand =
    row.marketplaceSalesUnits30 !== 0 || row.marketplaceSalesUnits90 !== 0;
  const label = periodLabel ?? "periodo";

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            Marketplace vs entrega
          </p>
          <p className="text-xs text-slate-500">
            Marketplace agrupa por sales-channel; entrega agrupa por pais del
            cliente.
          </p>
        </div>
        <div className="text-left text-xs text-slate-600 sm:text-right">
          <p>
            {channelLabel}: {fmtNum(row.marketplaceSalesUnits30)} uds {label} /{" "}
            {fmtNum(row.marketplaceSalesUnits90)} uds 90d
          </p>
          <p>
            Entregado a {row.pais}: {fmtNum(row.salesUnitsPeriod)} uds {label} /{" "}
            {fmtNum(row.salesUnits90)} uds 90d
          </p>
        </div>
      </div>

      {hasMarketplaceDemand && row.marketplaceDeliveryBreakdown.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-500">
                <th className="py-1.5 pr-3">Entrega cliente</th>
                <th className="py-1.5 pr-3 text-right">30d</th>
                <th className="py-1.5 pr-3 text-right">90d</th>
                <th className="py-1.5 pr-3 text-right">Importe 30d</th>
                <th className="py-1.5 pr-3 text-right">Importe 90d</th>
              </tr>
            </thead>
            <tbody>
              {row.marketplaceDeliveryBreakdown.map((breakdown) => (
                <tr
                  key={breakdown.shipCountry}
                  className="border-b border-slate-50 last:border-0"
                >
                  <td className="py-1.5 pr-3 font-medium text-slate-700">
                    {breakdown.shipCountry}
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    {fmtNum(breakdown.units30)}
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    {fmtNum(breakdown.units90)}
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    {fmtCurrency(breakdown.amount30)}
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    {fmtCurrency(breakdown.amount90)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">
          Sin ventas FBA raw por marketplace para este pais en la ventana
          reciente.
        </p>
      )}
    </div>
  );
}

function TopPriceButton({
  price,
  units,
  emptyLabel = "Sin ventas",
  onClick,
}: {
  price: number | null | undefined;
  units: number | null | undefined;
  emptyLabel?: string;
  onClick: () => void;
}) {
  if (price == null) {
    return <span className="text-slate-400">—</span>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex flex-col items-end rounded px-1.5 py-0.5 text-right font-medium text-blue-700 hover:bg-blue-50"
      title="Ver distribucion de precios"
    >
      <span>{fmtCurrency(price)}</span>
      {units != null ? (
        <span className="text-[10px] font-normal text-slate-500">
          {fmtNum(units)} uds
        </span>
      ) : null}
    </button>
  );
}

function PriceDistributionModal({
  state,
  onClose,
}: {
  state: PriceDistributionModalState;
  onClose: () => void;
}) {
  if (!state) return null;

  const totalUnits = state.rows.reduce((sum, row) => sum + row.units, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Distribucion de precios marketplace {state.country} - {state.periodLabel}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              FBA: precio unitario calculado desde item-price del informe GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL, agrupado por marketplace de venta (sales-channel), no por pais de entrega.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cerrar
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto p-4">
          {state.loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando distribucion...
            </div>
          ) : state.error ? (
            <p className="text-sm text-rose-700">{state.error}</p>
          ) : state.rows.length === 0 ? (
            <p className="text-sm text-slate-500">
              Sin precio real disponible para este pais y ventana. No se usa promedio diario.
            </p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-3 text-right">Precio</th>
                  <th className="py-2 pr-3 text-right">Unidades</th>
                  <th className="py-2 pr-3 text-right">Bruto</th>
                  <th className="py-2 pr-3 text-right">%</th>
                  <th className="py-2 pr-3">Ultima venta</th>
                  <th className="py-2 pr-3">Fuente</th>
                </tr>
              </thead>
              <tbody>
                {state.rows.map((row) => (
                  <tr
                    key={`${row.source}-${row.unitPrice}-${row.lastSaleDate ?? ""}`}
                    className="border-b border-slate-100"
                  >
                    <td className="py-2 pr-3 text-right font-medium">
                      {fmtCurrency(row.unitPrice)}
                    </td>
                    <td className="py-2 pr-3 text-right">{fmtNum(row.units)}</td>
                    <td className="py-2 pr-3 text-right">{fmtCurrency(row.grossAmount)}</td>
                    <td className="py-2 pr-3 text-right">
                      {fmtNum(row.percentageUnits ?? (totalUnits ? (row.units / totalUnits) * 100 : 0), 1)}%
                    </td>
                    <td className="py-2 pr-3">{fmtDate(row.lastSaleDate)}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function LotesPanel({
  loading,
  data,
}: {
  loading: boolean;
  data: InventoryLotesResponse | null;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando lotes…
      </div>
    );
  }
  if (!data || data.lotes.length === 0) {
    return (
      <Text className="text-xs text-slate-500">
        No hay lotes registrados para este país.
      </Text>
    );
  }
  return (
    <div className="space-y-2">
      {data.lotes.map((l) => (
        <div
          key={l.lote}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
        >
          <span className="font-mono font-medium">{l.lote}</span>
          <span>{fmtNum(l.unidades)} uds</span>
          <span>
            {l.costoUnitario != null ? `€${l.costoUnitario.toFixed(2)}/ud` : "—"}
          </span>
          <span className="text-slate-500">{l.contenedorIdentificador ?? "—"}</span>
        </div>
      ))}
      <Text className="text-[10px] text-slate-400">
        Total: {fmtNum(data.resumen.totalUnidades)} uds · Coste{" "}
        {data.resumen.costoTotal > 0
          ? `€${data.resumen.costoTotal.toFixed(2)}`
          : "—"}
      </Text>
    </div>
  );
}

function inboundTypeLabel(row: InventoryInboundRow): string {
  if (row.planningKind) return inboundPlanningKindLabel(row.planningKind);
  if (row.confidence === "provisional") return "Orden provisional";
  if (row.confidence === "confirmed") return "Contenedor confirmado";
  return "—";
}

function inboundTypeBadgeClass(kind?: InventoryInboundPlanningKind): string {
  switch (kind) {
    case "CONTAINER_CONFIRMED":
      return "rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800";
    case "PURCHASE_ORDER_CONFIRMED":
      return "rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-800";
    case "PURCHASE_ORDER_PROVISIONAL":
      return "rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800";
    default:
      return "rounded bg-slate-50 px-1.5 py-0.5 text-xs text-slate-700";
  }
}

function inboundSeguimiento(row: InventoryInboundRow): string {
  if (row.logisticsKind === "amazon_inbound") {
    return row.amazonShipmentId ?? row.seguimiento ?? "Sin seguimiento";
  }
  if (row.logisticsKind === "contenedor_propio" || row.contenedorId) {
    return row.seguimiento ?? row.contenedorIdentificador ?? row.contenedorId ?? "Sin seguimiento";
  }
  return row.seguimiento ?? "Sin seguimiento";
}

function InboundSection({
  inbound,
  locale,
}: {
  inbound: InventoryInboundRow[];
  locale: string;
}) {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedLogisticsRow, setSelectedLogisticsRow] =
    useState<InventoryInboundRow | null>(null);

  if (inbound.length === 0) {
    return (
      <Text className="text-sm text-slate-500">
        No hay pedidos confirmados pendientes de recepción.
      </Text>
    );
  }

  return (
    <>
      <ResponsiveTable
        desktop={
          <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-3">Orden</th>
              <th className="py-2 pr-3">Pedido agente</th>
              <th className="py-2 pr-3">Seguimiento</th>
              <th className="py-2 pr-3">ETA</th>
              <th className="py-2 pr-3">Tipo de entrada</th>
              <th className="py-2 pr-3 text-right">Uds</th>
              <th className="py-2 pr-3">Estado</th>
              <th className="py-2 pr-3">Enlace</th>
            </tr>
          </thead>
          <tbody>
            {inbound.map((row) => (
              <tr key={`${row.ordenId}-${row.ordenItemId ?? row.loteProducto ?? ""}`} className="border-b border-slate-100">
                <td className="py-2 pr-3">{row.numeroOrden ?? row.ordenId.slice(0, 8)}</td>
                <td className="py-2 pr-3">{row.numeroPedidoAgente ?? "—"}</td>
                <td className="py-2 pr-3">{inboundSeguimiento(row)}</td>
                <td className="py-2 pr-3">
                  {fmtDate(row.eta)}
                  {row.etaSource === "container" ? (
                    <span className="ml-1 text-[10px] text-emerald-700">(contenedor)</span>
                  ) : row.confidence === "provisional" ? (
                    <span className="ml-1 text-[10px] text-amber-700">(orden)</span>
                  ) : null}
                </td>
                <td className="py-2 pr-3">
                  <span className={inboundTypeBadgeClass(row.planningKind)}>
                    {inboundTypeLabel(row)}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right">{fmtNum(row.cantidadPendiente)}</td>
                <td className="py-2 pr-3 capitalize">{row.estado}</td>
                <td className="py-2 pr-3">
                  <button
                    type="button"
                    onClick={() => setSelectedOrderId(row.ordenId)}
                    className="text-blue-700 hover:underline"
                  >
                    Pedido
                  </button>
                  {row.contenedorId || row.logisticsKind === "amazon_inbound" ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        onClick={() => setSelectedLogisticsRow(row)}
                        className="text-blue-700 hover:underline"
                      >
                        Logística
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      mobile={
        <div className="space-y-3">
          {inbound.map((row) => (
            <ResponsiveDataCard
              key={`${row.ordenId}-${row.ordenItemId ?? row.loteProducto ?? ""}`}
              title={row.numeroOrden ?? row.ordenId.slice(0, 8)}
              subtitle={row.numeroPedidoAgente ?? undefined}
              fields={[
                { label: "Seguimiento", value: inboundSeguimiento(row) },
                {
                  label: "ETA",
                  value: `${fmtDate(row.eta)}${row.confidence === "provisional" ? " (orden)" : row.etaSource === "container" ? " (contenedor)" : ""}`,
                },
                { label: "Tipo de entrada", value: inboundTypeLabel(row) },
                { label: "Unidades", value: fmtNum(row.cantidadPendiente) },
                { label: "Estado", value: row.estado },
              ]}
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => setSelectedOrderId(row.ordenId)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
                  >
                    Ver pedido
                  </button>
                  {row.contenedorId || row.logisticsKind === "amazon_inbound" ? (
                    <button
                      type="button"
                      onClick={() => setSelectedLogisticsRow(row)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
                    >
                      Logística
                    </button>
                  ) : null}
                </>
              }
            />
          ))}
        </div>
        }
      />
      {selectedOrderId ? (
        <OrderReadonlyModal
          ordenId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
        />
      ) : null}
      {selectedLogisticsRow ? (
        <InventoryLogisticsModal
          row={selectedLogisticsRow}
          locale={locale}
          onClose={() => setSelectedLogisticsRow(null)}
        />
      ) : null}
    </>
  );
}

function InventoryLogisticsModal({
  row,
  locale,
  onClose,
}: {
  row: InventoryInboundRow;
  locale: string;
  onClose: () => void;
}) {
  const isAmazon = row.logisticsKind === "amazon_inbound";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isAmazon ? "Envío Amazon inbound" : "Seguimiento logístico"}
            </h2>
            <p className="mt-1 font-mono text-xs text-slate-500">
              {inboundSeguimiento(row)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500"
          >
            Cerrar
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          {[
            { label: "Orden", value: row.numeroOrden ?? row.ordenId.slice(0, 8) },
            { label: "Pedido agente", value: row.numeroPedidoAgente ?? "—" },
            { label: "Tipo", value: isAmazon ? "Amazon inbound/FBA" : "Contenedor propio" },
            { label: "Seguimiento", value: inboundSeguimiento(row) },
            { label: "ETA", value: fmtDate(row.eta) },
            { label: "Unidades pendientes", value: fmtNum(row.cantidadPendiente) },
            { label: "Estado", value: isAmazon ? row.amazonStatus ?? "—" : row.estado },
            {
              label: "Destino",
              value: isAmazon
                ? row.amazonDestinationCenter ?? "—"
                : row.destinoOrden ?? "—",
            },
            ...(isAmazon
              ? [{ label: "Nombre shipment", value: row.amazonShipmentName ?? "—" }]
              : [{ label: "Contenedor", value: row.contenedorIdentificador ?? "—" }]),
          ].map((item) => (
            <div key={item.label}>
              <p className="text-[10px] font-medium uppercase text-slate-400">
                {item.label}
              </p>
              <p className="mt-0.5 text-slate-800">{item.value}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          {isAmazon ? (
            <Link
              href={`/${locale}/amazon/envios`}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700"
            >
              Abrir Amazon Envíos
            </Link>
          ) : row.contenedorId ? (
            <Link
              href={`/${locale}/logistica?containerId=${encodeURIComponent(row.contenedorId)}`}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700"
            >
              Abrir página completa
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const MONTH_LABELS = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

function replenishmentStatusLabel(status: string): string {
  switch (status) {
    case "URGENT":
      return "URGENTE";
    case "OVERDUE":
      return "FECHA VENCIDA";
    case "DUE":
      return "PEDIDO PRÓXIMO";
    case "OK":
      return "OK";
    default:
      return status;
  }
}

function demandSourceLabel(source?: string): string {
  switch (source) {
    case "ANNUAL_FORECAST_CORRECTED":
      return "Forecast corregido por rotura histórica";
    case "ANNUAL_FORECAST_MONTH":
      return "Forecast mensual anual";
    case "RECENT_30D":
      return "Ventas recientes 30 días";
    case "RECENT_90D":
      return "Ventas recientes 90 días";
    case "ANNUAL_AVERAGE":
      return "Media anual";
    case "BENCHMARK":
      return "Benchmark competidor";
    default:
      return source ?? "—";
  }
}

function fmtOrderDeadline(iso: string | null | undefined): string {
  if (!iso) return "—";
  const today = new Date().toISOString().slice(0, 10);
  if (iso.slice(0, 10) <= today) return "vencida";
  return fmtDate(iso);
}

function purchaseCycleReasonLabel(reason: string): string {
  switch (reason) {
    case "URGENT_REORDER":
      return "Pedido urgente";
    case "STOCKOUT_RECOVERY":
      return "Recuperación de rotura";
    case "CALENDAR_PREVENTIVE":
      return "Preventivo calendario logístico";
    case "REORDER_POINT":
      return "Punto de pedido";
    case "CALENDAR_IMPACT":
      return "Impacto calendario logístico";
    default:
      return reason;
  }
}

function monthlyLineHasInboundSplit(
  line: InventoryProductDetailResponse["annualForecast"]["monthlyPlan"][number],
): boolean {
  return (
    (line.monthlyInboundFirstDate != null && (line.inboundUnits ?? 0) > 0) ||
    (line.lostSalesBeforeFirstInbound ?? 0) > 0
  );
}

function monthlyInboundDetailRows(
  line: InventoryProductDetailResponse["annualForecast"]["monthlyPlan"][number],
): Array<{ label: string; value: string; tone?: "loss" | "inbound" | "normal" }> {
  if (line.isPastMonth) {
    return [
      {
        label: "Estado",
        value: "Mes pasado (histórico)",
      },
      {
        label: "Ventas mismo mes año base",
        value: fmtNum(line.previousYearSalesUnits),
      },
    ];
  }

  if (!monthlyLineHasInboundSplit(line)) {
    const rows: Array<{ label: string; value: string; tone?: "loss" | "inbound" | "normal" }> = [];
    if ((line.inboundUnits ?? 0) > 0 && line.monthlyInboundFirstDate) {
      rows.push({
        label: "Entrada prevista",
        value: `${fmtNum(line.inboundUnits)} uds el ${fmtDate(line.monthlyInboundFirstDate)}`,
        tone: "inbound",
      });
    } else if ((line.inboundUnits ?? 0) === 0) {
      rows.push({
        label: "Entradas registradas",
        value: "Sin entradas previstas este mes",
      });
    }
    rows.push(
      { label: "Ventas servidas", value: fmtNum(line.servedUnits) },
      {
        label: "Ventas perdidas",
        value: line.lostSalesUnits > 0 ? fmtNum(line.lostSalesUnits) : "—",
        tone: line.lostSalesUnits > 0 ? "loss" : undefined,
      },
    );
    return rows;
  }

  return [
    {
      label: "Entrada prevista",
      value: `${fmtNum(line.inboundUnits)} uds el ${fmtDate(line.monthlyInboundFirstDate)}`,
      tone: "inbound",
    },
    {
      label: "Pérdidas antes de entrada",
      value:
        (line.lostSalesBeforeFirstInbound ?? 0) > 0
          ? `${fmtNum(line.lostSalesBeforeFirstInbound)} uds`
          : "—",
      tone: (line.lostSalesBeforeFirstInbound ?? 0) > 0 ? "loss" : undefined,
    },
    {
      label: "Ventas servidas tras entrada",
      value: `${fmtNum(line.servedAfterInbound ?? 0)} uds`,
    },
    {
      label: "Cierre estimado",
      value: `${fmtNum(line.closingPhysicalStock)} uds`,
    },
  ];
}

function purchaseCycleStatusLabel(status: string): string {
  switch (status) {
    case "URGENT":
      return "URGENTE";
    case "OVERDUE":
      return "VENCIDO";
    case "PLANNED":
      return "PLANIFICADO";
    case "OK":
      return "OK";
    default:
      return status;
  }
}

function purchaseCycleStatusClass(status: string): string {
  switch (status) {
    case "URGENT":
    case "OVERDUE":
      return "bg-rose-100 text-rose-800 ring-rose-200";
    case "PLANNED":
      return "bg-blue-100 text-blue-800 ring-blue-200";
    default:
      return "bg-emerald-100 text-emerald-800 ring-emerald-200";
  }
}

function ReplenishmentUnifiedPanel({
  replenishment,
}: {
  replenishment: NonNullable<InventoryProductDetailResponse["forecast"]["replenishment"]>;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const statusLabel = replenishmentStatusLabel(replenishment.replenishmentStatus);
  const deadlineDate =
    replenishment.latestSafeOrderDate ?? replenishment.latestOrderDate;
  const deadline = fmtOrderDeadline(deadlineDate);
  const isOverdue =
    replenishment.isOrderAlreadyLate === true ||
    replenishment.replenishmentStatus === "URGENT" ||
    replenishment.replenishmentStatus === "OVERDUE" ||
    deadline === "vencida";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800 space-y-3">
      <p className="font-semibold text-slate-900">Reposición</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
          <p className="text-[10px] uppercase text-slate-400">Estado</p>
          <p className={`mt-1 text-base font-semibold ${isOverdue ? "text-rose-700" : "text-slate-900"}`}>
            {statusLabel}
          </p>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
          <p className="text-[10px] uppercase text-slate-400">Stock actual</p>
          <p className="mt-1 text-base font-semibold">
            {fmtNum(replenishment.currentStock ?? 0)} uds
          </p>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
          <p className="text-[10px] uppercase text-slate-400">Demanda diaria</p>
          <p className="mt-1 text-base font-semibold">
            {replenishment.dailyDemand?.toLocaleString("es-ES", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }) ?? "—"}{" "}
            uds/día
          </p>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
          <p className="text-[10px] uppercase text-slate-400">Rotura prevista</p>
          <p className={`mt-1 text-base font-semibold ${replenishment.estimatedStockoutDate ? "text-rose-700" : ""}`}>
            {fmtDate(replenishment.estimatedStockoutDate)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
          <p className="text-[10px] uppercase text-slate-400">Fecha límite para pedir</p>
          <p className={`mt-1 text-base font-semibold ${isOverdue ? "text-rose-700" : ""}`}>
            {deadline}
          </p>
          {isOverdue ? (
            <p className="mt-0.5 text-xs text-rose-600">Acción: pedir ya</p>
          ) : null}
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
          <p className="text-[10px] uppercase text-slate-400">Si pides hoy, llegada est.</p>
          <p className="mt-1 text-base font-semibold">
            {fmtDate(replenishment.orderTodayEta)}
          </p>
          {(replenishment.orderTodayCalendarDelayDays ?? 0) > 0 ? (
            <p className="mt-0.5 text-xs text-amber-700">
              Retraso calendario: +{replenishment.orderTodayCalendarDelayDays} d
            </p>
          ) : null}
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
          <p className="text-[10px] uppercase text-slate-400">Ventas perdidas antes de llegada</p>
          <p className={`mt-1 text-base font-semibold ${(replenishment.orderTodayLostSalesBeforeArrival ?? 0) > 0 ? "text-rose-700" : ""}`}>
            {fmtNum(replenishment.orderTodayLostSalesBeforeArrival ?? 0)} uds
          </p>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
          <p className="text-[10px] uppercase text-slate-400">Punto de pedido</p>
          <p className="mt-1 text-base font-semibold">
            {fmtNum(replenishment.reorderPointUnits)} uds
          </p>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
          <p className="text-[10px] uppercase text-slate-400">Pedir</p>
          <p className="mt-1 text-base font-semibold">
            {replenishment.recommendedOrderUnits != null &&
            replenishment.recommendedOrderUnits > 0
              ? `${fmtNum(replenishment.recommendedOrderUnits)} uds`
              : "—"}
          </p>
        </div>
        {replenishment.additionalCapitalRequired != null &&
        replenishment.additionalCapitalRequired > 0 ? (
          <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 sm:col-span-2 lg:col-span-3">
            <p className="text-[10px] uppercase text-slate-400">Capital estimado</p>
            <p className="mt-1 text-base font-semibold">
              {fmtNum(replenishment.additionalCapitalRequired)} €
            </p>
          </div>
        ) : null}
      </div>

      {(replenishment.calendarWarnings?.length ?? 0) > 0 ? (
        <ul className="space-y-1">
          {replenishment.calendarWarnings!.map((w) => (
            <li
              key={w}
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
            >
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
      >
        {showDetails ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        Cómo se calcula
      </button>

      {showDetails ? (
        <div className="space-y-1 border-t border-slate-200 pt-2 text-xs text-slate-600">
          <p>
            Demanda durante lead time: {fmtNum(replenishment.leadTimeDemandUnits)} uds
          </p>
          <p>
            Buffer seguridad: {replenishment.safetyBufferDays} días ={" "}
            {fmtNum(replenishment.safetyStockUnits)} uds
          </p>
          <p>Lead time: {replenishment.leadTimeDays} días</p>
          <p>
            Producción: {replenishment.productionDays} · Tránsito:{" "}
            {replenishment.transitDays} · Aduana: {replenishment.customsDays}
            {(replenishment.calendarDelayDays ?? 0) > 0
              ? ` · Calendario: +${replenishment.calendarDelayDays} d`
              : ""}
          </p>
          {replenishment.requiredArrivalDate ? (
            <p>Fecha objetivo de llegada: {fmtDate(replenishment.requiredArrivalDate)}</p>
          ) : null}
          {replenishment.estimatedStockoutDate ? (
            <p>Rotura proyectada: {fmtDate(replenishment.estimatedStockoutDate)}</p>
          ) : null}
          {replenishment.warnings.length > 0 ? (
            <ul className="mt-1 list-disc pl-4 text-amber-800">
              {replenishment.warnings
                .filter(
                  (w) =>
                    !w.includes("producto_supply_config") &&
                    !w.includes("default_"),
                )
                .map((w) => (
                  <li key={w}>{w}</li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StockoutHistoricalCorrectionPanel({
  correction,
  baseYear,
}: {
  correction: NonNullable<InventoryProductDetailResponse["annualForecast"]["stockoutCorrection"]>;
  baseYear: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const correctedMonths = correction.monthly.filter(
    (m) => m.estimatedLostDemandUnits > 0,
  );

  return (
    <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-3 text-xs text-violet-950 space-y-2">
      <p className="font-semibold">Base histórica corregida {baseYear}</p>
      <p className="text-violet-900">
        Esta tabla recalcula la demanda del año base. Parte de las ventas reales de{" "}
        {baseYear} y estima ventas perdidas cuando hubo días sin stock. No es una
        simulación futura.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <p>Ventas reales {baseYear}: {fmtNum(correction.totalActualSales)} uds</p>
        <p>Demanda corregida {baseYear}: {fmtNum(correction.totalCorrectedSales)} uds</p>
        <p>Demanda no servida estimada: {fmtNum(correction.totalEstimatedLostDemand)} uds</p>
        <p>Meses con rotura: {correction.correctedMonthsCount}</p>
      </div>
      {correction.warnings.length > 0 ? (
        <ul className="list-disc pl-4 text-amber-900">
          {correction.warnings.slice(0, 4).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {correctedMonths.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-violet-800 hover:text-violet-950"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Desglose mensual año base {baseYear}
          </button>
          {expanded ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-[11px]">
                <thead>
                  <tr className="border-b border-violet-200 text-left">
                    <th className="py-1 pr-2">Mes</th>
                    <th className="py-1 pr-2 text-right">Ventas reales {baseYear}</th>
                    <th className="py-1 pr-2 text-right">Días c/stock</th>
                    <th className="py-1 pr-2 text-right">Días rotura</th>
                    <th className="py-1 pr-2 text-right">Demanda corr. {baseYear}</th>
                    <th className="py-1 pr-2 text-right">Demanda no servida est.</th>
                    <th className="py-1 pr-2">Conf.</th>
                  </tr>
                </thead>
                <tbody>
                  {correction.monthly.map((m) => (
                    <tr key={m.monthIndex} className="border-b border-violet-100">
                      <td className="py-1 pr-2">{MONTH_LABELS[m.monthIndex - 1]}</td>
                      <td className="py-1 pr-2 text-right">{fmtNum(m.actualSalesUnits)}</td>
                      <td className="py-1 pr-2 text-right">{fmtNum(m.daysWithStock)}</td>
                      <td className="py-1 pr-2 text-right">{fmtNum(m.stockoutDays)}</td>
                      <td className="py-1 pr-2 text-right font-medium">
                        {fmtNum(m.correctedSalesUnits)}
                      </td>
                      <td className="py-1 pr-2 text-right">
                        {m.estimatedLostDemandUnits > 0
                          ? fmtNum(m.estimatedLostDemandUnits)
                          : "—"}
                      </td>
                      <td className="py-1 pr-2">{m.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ForecastPanel({
  detail,
  simulationActive = false,
}: {
  detail: InventoryProductDetailResponse;
  simulationActive?: boolean;
}) {
  const f = detail.forecast;
  const methodInfo = f.methodInfo;
  const displayMethod = methodInfo
    ? forecastMethodBusinessLabel(
        resolveDisplayForecastMethod(
          methodInfo.configuredMethod,
          methodInfo.effectiveMethod,
        ),
      )
    : forecastMethodLabel(f.method);
  const correctionSummary = detail.annualForecast.stockoutCorrection?.applied
    ? {
        totalActualSales: detail.annualForecast.stockoutCorrection.totalActualSales,
        totalCorrectedSales:
          detail.annualForecast.stockoutCorrection.totalCorrectedSales,
        totalEstimatedLostDemand:
          detail.annualForecast.stockoutCorrection.totalEstimatedLostDemand,
        correctedMonthsCount:
          detail.annualForecast.stockoutCorrection.correctedMonthsCount,
      }
    : null;

  return (
    <div className="space-y-3">
      {simulationActive ? (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900">
          Resultados de simulación (no guardados en BD).
        </p>
      ) : null}
      {methodInfo ? (
        <ForecastMethodExplanationBox
          info={methodInfo}
          variant="compact"
          stockoutCorrectionSummary={correctionSummary}
        />
      ) : null}
      <Text className="text-xs text-slate-500">
        Corto plazo · ventana {detail.recentWindowDays} días · Alcance:{" "}
        {forecastScopeHumanLabel(
          detail.annualForecast.country,
          detail.annualForecast.channel,
        )}
      </Text>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-100 p-2">
          <Text className="text-[10px] uppercase text-slate-400">Método</Text>
          <p className="text-sm font-semibold">{displayMethod}</p>
        </div>
        <div className="rounded-lg border border-slate-100 p-2">
          <Text className="text-[10px] uppercase text-slate-400">Media diaria</Text>
          <p className="text-sm font-semibold">{f.averageDailySales.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border border-slate-100 p-2">
          <Text className="text-[10px] uppercase text-slate-400">Forecast mes 1</Text>
          <p className="text-sm font-semibold">{fmtNum(f.forecastUnitsMonth1)} uds</p>
        </div>
        <div className="rounded-lg border border-slate-100 p-2">
          <Text className="text-[10px] uppercase text-slate-400">Uds recomendadas</Text>
          <p className="text-sm font-semibold">
            {f.recommendedOrderUnits != null
              ? fmtNum(f.recommendedOrderUnits)
              : "—"}
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {f.explanations.map((ex) => (
          <li
            key={ex.code}
            className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
          >
            <span className="font-semibold text-slate-800">{ex.label}: </span>
            <span className="text-slate-600">{ex.detail}</span>
          </li>
        ))}
      </ul>
      {f.recommendedOrderDate ? (
        <Text className="text-xs text-slate-500">
          Fecha límite: {fmtOrderDeadline(f.recommendedOrderDate)}
          {f.replenishment?.replenishmentStatus === "URGENT" ||
          f.replenishment?.replenishmentStatus === "OVERDUE"
            ? " · pedir ya"
            : ""}
        </Text>
      ) : null}
      {f.replenishment ? (
        <ReplenishmentUnifiedPanel replenishment={f.replenishment} />
      ) : null}
    </div>
  );
}

function annualReasonLabel(reason: string): string {
  switch (reason) {
    case "PREVIOUS_YEAR_SEASONAL":
      return "Histórico año anterior";
    case "NEW_PRODUCT_BENCHMARK":
      return "Benchmark competidor";
    case "FAMILY_VARIANT_BENCHMARK":
      return "Variantes hermanas";
    case "STOCKOUT_RISK":
      return "Riesgo rotura";
    case "LOW_STOCK":
      return "Stock bajo";
    case "MANUAL_FORECAST_PENDING":
      return "Manual pendiente";
    case "BENCHMARK_UNAVAILABLE":
      return "Sin benchmark";
    default:
      return "Sin histórico";
  }
}

function AnnualForecastPanel({
  detail,
  simulationActive = false,
  showStockoutDebug = false,
}: {
  detail: InventoryProductDetailResponse;
  simulationActive?: boolean;
  showStockoutDebug?: boolean;
}) {
  const af = detail.annualForecast;
  const methodInfo = af.methodInfo;
  const displayMethod = methodInfo
    ? forecastMethodBusinessLabel(
        resolveDisplayForecastMethod(
          methodInfo.configuredMethod,
          methodInfo.effectiveMethod,
        ),
      )
    : forecastMethodLabel(af.method);
  const channelLabel =
    af.channel === "AMAZON_FBA"
      ? "FBA"
      : af.channel === "AMAZON_FBM"
        ? "FBM"
        : "ALL";
  const scopeHumanLabel = forecastScopeHumanLabel(af.country, af.channel);
  const usesStockoutCorrectedMethod =
    af.stockoutCorrection?.applied === true ||
    displayMethod.toLowerCase().includes("corregido");

  const operationalMonthlyPlan = af.monthlyPlan.filter(
    (line) => line.isOperationalMonth !== false,
  );

  return (
    <div className="space-y-3">
      {simulationActive ? (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900">
          Plan anual recalculado con la simulación activa.
        </p>
      ) : null}
      {af.methodInfo ? (
        <ForecastMethodExplanationBox
          info={af.methodInfo}
          variant="compact"
          stockoutCorrectionSummary={
            af.stockoutCorrection?.applied
              ? {
                  totalActualSales: af.stockoutCorrection.totalActualSales,
                  totalCorrectedSales: af.stockoutCorrection.totalCorrectedSales,
                  totalEstimatedLostDemand:
                    af.stockoutCorrection.totalEstimatedLostDemand,
                  correctedMonthsCount: af.stockoutCorrection.correctedMonthsCount,
                }
              : null
          }
        />
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-100 p-2 sm:col-span-2">
          <Text className="text-[10px] uppercase text-slate-400">Alcance</Text>
          <p className="text-sm font-semibold">{scopeHumanLabel}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            Filtro técnico: {af.country} / {channelLabel}
          </p>
        </div>
        <div className="rounded-lg border border-slate-100 p-2">
          <Text className="text-[10px] uppercase text-slate-400">Año base</Text>
          <p className="text-sm font-semibold">{af.baseYear}</p>
        </div>
        <div className="rounded-lg border border-slate-100 p-2">
          <Text className="text-[10px] uppercase text-slate-400">
            Ventas reales año base {af.baseYear}
          </Text>
          <p className="text-sm font-semibold">{fmtNum(af.previousYearTotalUnits)} uds</p>
          {af.stockoutCorrection?.applied ? (
            <p className="mt-1 text-[10px] text-slate-600">
              Demanda corregida usada:{" "}
              {fmtNum(af.stockoutCorrection.totalCorrectedSales)} uds/año
            </p>
          ) : null}
        </div>
        <div className="rounded-lg border border-slate-100 p-2 sm:col-span-2">
          <Text className="text-[10px] uppercase text-slate-400">
            Stock inicial usado en simulación
          </Text>
          <p className="text-sm font-semibold">{fmtNum(af.currentOpeningStock)} uds</p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            Punto de partida: stock operativo actual al calcular el plan.
          </p>
        </div>
        <div className="rounded-lg border border-slate-100 p-2 sm:col-span-2">
          <Text className="text-[10px] uppercase text-slate-400">Plan futuro</Text>
          <p className="text-sm font-semibold">Simulación {af.forecastYear}</p>
        </div>
      </div>

      <div className="space-y-1">
        <Text className="text-xs text-slate-500">
          Método del plan: {displayMethod} · Plan {af.forecastYear}
        </Text>
        {usesStockoutCorrectedMethod ? (
          <Text className="text-xs text-slate-500">
            Usa ventas reales del año anterior y corrige los meses donde hubo rotura de
            stock.
          </Text>
        ) : null}
      </div>

      {af.stockoutCorrection?.applied ? (
        <StockoutHistoricalCorrectionPanel
          correction={af.stockoutCorrection}
          baseYear={af.baseYear}
        />
      ) : null}

      {showStockoutDebug && af.stockoutCorrectionDebug ? (
        <details className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px]">
          <summary className="cursor-pointer font-medium text-slate-700">
            Debug corrección (dev)
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-slate-600">
            {JSON.stringify(af.stockoutCorrectionDebug, null, 2)}
          </pre>
        </details>
      ) : null}

      {(af.purchaseCyclePlan?.cycles.length ??
        af.purchaseCycles?.length ??
        af.purchaseCyclePlan?.planningInbound.used.length ??
        0) > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <AnnualPurchasePlanPanel
            plan={
              af.purchaseCyclePlan ?? {
                cycles: af.purchaseCycles ?? [],
                capitalAlreadyCommitted: null,
                additionalCapitalRequired: (af.purchaseCycles ?? []).reduce(
                  (s, c) => s + (c.capitalRequired ?? 0),
                  0,
                ),
                totalCapitalExposure: null,
                planningInbound: { used: [], ignored: [] },
                warnings: [],
              }
            }
          />
        </div>
      ) : null}

      {af.warnings.length > 0 ? (
        <ul className="space-y-1">
          {af.warnings.map((w) => (
            <li key={w} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600">
          Simulación mensual de stock {af.forecastYear}
        </summary>
        <div className="border-t border-slate-100 p-2">
          <p className="mb-2 px-1 text-[11px] text-slate-500">
            Esta tabla proyecta el stock mes a mes usando el stock actual, el forecast
            mensual y las entradas previstas ya registradas en pedidos/logística. Las
            pérdidas del mes pueden producirse antes de una entrada prevista dentro del
            mismo mes. El plan de compras arriba es la referencia para decidir pedidos.
          </p>
      <ResponsiveTable
        desktop={
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-2">Mes</th>
                  <th className="py-2 pr-2 text-right" title="Ventas del mismo mes en el año base">
                    Ventas año base
                  </th>
                  <th className="py-2 pr-2 text-right" title="Demanda prevista del mes">
                    Demanda prevista
                  </th>
                  <th className="py-2 pr-2 text-right" title="Stock al inicio del mes">
                    Stock inicio mes
                  </th>
                  <th
                    className="py-2 pr-2"
                    title="Entradas registradas, ventas servidas y ventas perdidas"
                  >
                    Movimiento del mes
                  </th>
                  <th className="py-2 pr-2 text-right" title="Stock estimado al final del mes">
                    Stock fin mes
                  </th>
                  <th className="py-2 pr-2 text-right">Días rotura</th>
                  <th className="py-2 pr-2">F. rotura</th>
                  <th className="py-2 pr-2 text-right" title="Pedido recomendado">
                    Pedido rec.
                  </th>
                  <th className="py-2 pr-2" title="Motivo del cálculo">
                    Motivo
                  </th>
                </tr>
              </thead>
              <tbody>
                {operationalMonthlyPlan.map((line) => {
                  const detailRows = monthlyInboundDetailRows(line);
                  return (
                  <tr key={line.month} className="border-b border-slate-100 align-top">
                    <td className="py-1.5 pr-2 font-medium">
                      {MONTH_LABELS[line.month - 1]}
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      {fmtNum(line.previousYearSalesUnits)}
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      {fmtNum(line.forecastSalesUnits)}
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      {fmtNum(line.openingPhysicalStock)}
                    </td>
                    <td className="py-1.5 pr-2">
                      <ul className="space-y-0.5">
                        {detailRows.map((row) => (
                          <li
                            key={row.label}
                            className={
                              row.tone === "loss"
                                ? "text-red-700"
                                : row.tone === "inbound"
                                  ? "text-sky-800"
                                  : "text-slate-700"
                            }
                          >
                            <span className="text-slate-500">{row.label}: </span>
                            {row.value}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="py-1.5 pr-2 text-right font-medium">
                      {fmtNum(line.closingPhysicalStock)}
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      {line.stockoutDays > 0 ? fmtNum(line.stockoutDays) : "—"}
                    </td>
                    <td className="py-1.5 pr-2">
                      {line.stockoutStartDate ? fmtDate(line.stockoutStartDate) : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-semibold text-slate-900">
                      {line.recommendedPurchaseUnits > 0
                        ? fmtNum(line.recommendedPurchaseUnits)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-slate-600">
                      {annualReasonLabel(line.reason)}
                    </td>
                  </tr>
                );
                })}
              </tbody>
            </table>
          </div>
        }
        mobile={
          <div className="space-y-2">
            {operationalMonthlyPlan.map((line) => {
              const detailRows = monthlyInboundDetailRows(line);
              return (
              <ResponsiveDataCard
                key={line.month}
                title={MONTH_LABELS[line.month - 1] ?? `Mes ${line.month}`}
                subtitle={annualReasonLabel(line.reason)}
                fields={[
                  { label: "Ventas mismo mes año base", value: fmtNum(line.previousYearSalesUnits) },
                  { label: "Demanda prevista mes", value: fmtNum(line.forecastSalesUnits) },
                  { label: "Stock al inicio del mes", value: fmtNum(line.openingPhysicalStock) },
                  ...detailRows.map((row) => ({ label: row.label, value: row.value })),
                  { label: "Stock fin de mes", value: fmtNum(line.closingPhysicalStock) },
                  {
                    label: "Días rotura",
                    value: line.stockoutDays > 0 ? fmtNum(line.stockoutDays) : "—",
                  },
                  {
                    label: "Pedido recomendado",
                    value:
                      line.recommendedPurchaseUnits > 0
                        ? fmtNum(line.recommendedPurchaseUnits)
                        : "—",
                  },
                ]}
              />
            );
            })}
          </div>
        }
      />
        </div>
      </details>
    </div>
  );
}

function AnnualPurchasePlanPanel({
  plan,
}: {
  plan: NonNullable<InventoryProductDetailResponse["annualForecast"]["purchaseCyclePlan"]>;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">Plan anual de compras</p>
        <div className="flex flex-wrap gap-3 text-xs text-slate-600">
          {plan.capitalAlreadyCommitted != null ? (
            <span>Capital ya comprometido: {fmtNum(plan.capitalAlreadyCommitted)} €</span>
          ) : plan.planningInbound.used.length > 0 ? (
            <span className="text-amber-800">
              Capital ya comprometido: no calculado por falta de coste
            </span>
          ) : null}
          <span>Capital adicional: {fmtNum(plan.additionalCapitalRequired)} €</span>
          {plan.totalCapitalExposure != null ? (
            <span className="font-medium text-slate-800">
              Exposición total: {fmtNum(plan.totalCapitalExposure)} €
            </span>
          ) : null}
        </div>
      </div>

      {plan.planningInbound.used.length > 0 ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
          <p className="font-medium">Ya hay entradas previstas</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {plan.planningInbound.used.map((entry) => (
              <li key={`${entry.eta}-${entry.planningKind}-${entry.units}`}>
                {fmtNum(entry.units)} uds el {fmtDate(entry.eta)}
                {entry.planningKind
                  ? ` · ${inboundPlanningKindLabel(entry.planningKind)}`
                  : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.planningInbound.ignored.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <p className="font-medium">Inbound no usado en planificación</p>
          <ul className="mt-1 space-y-0.5">
            {plan.planningInbound.ignored.map((entry) => (
              <li key={`ignored-${entry.eta}-${entry.units}`}>
                {fmtNum(entry.units)} uds el {fmtDate(entry.eta)} — orden provisional o sin ETA
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.warnings.length > 0 ? (
        <ul className="space-y-1">
          {plan.warnings.map((w) => (
            <li
              key={w}
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
            >
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-3">
        {plan.cycles.length === 0 ? (
          <p className="text-sm text-slate-600">
            No se recomiendan pedidos nuevos: las entradas previstas cubren la demanda
            proyectada en el horizonte.
          </p>
        ) : null}
        {plan.cycles.map((cycle) => {
          const statusLabel = purchaseCycleStatusLabel(cycle.status);
          const deadlineLate =
            cycle.latestOrderDate.slice(0, 10) <
            new Date().toISOString().slice(0, 10);
          const isPreventive = cycle.reason === "CALENDAR_PREVENTIVE";
          const preventiveEvent = cycle.calendarEvents[0];

          return (
            <div
              key={`cycle-${cycle.cycleNumber}-${cycle.orderDate}`}
              className={`rounded-xl border bg-white p-4 shadow-sm ${
                isPreventive
                  ? "border-violet-200 ring-1 ring-violet-100"
                  : "border-slate-200"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-slate-900">
                  {isPreventive
                    ? `Pedido preventivo${preventiveEvent ? ` — ${preventiveEvent.name}` : ""}`
                    : `Pedido ${cycle.cycleNumber}`}
                </p>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ${
                    isPreventive
                      ? "bg-violet-100 text-violet-800 ring-violet-200"
                      : purchaseCycleStatusClass(cycle.status)
                  }`}
                >
                  {isPreventive
                    ? purchaseCycleReasonLabel(cycle.reason)
                    : statusLabel}
                </span>
              </div>

              {isPreventive && cycle.businessMessage ? (
                <p className="mt-2 text-xs text-violet-900">{cycle.businessMessage}</p>
              ) : null}

              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-[10px] uppercase text-slate-400">
                    {isPreventive ? "Pedir antes de" : "Pedir"}
                  </p>
                  <p className="text-sm font-semibold">
                    {isPreventive
                      ? fmtDate(cycle.latestOrderDate)
                      : cycle.status === "URGENT" || cycle.status === "OVERDUE"
                        ? deadlineLate
                          ? `Hoy · vencido desde ${fmtDate(cycle.latestOrderDate)}`
                          : "Hoy"
                        : fmtDate(cycle.orderDate)}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-[10px] uppercase text-slate-400">
                    {isPreventive ? "Llegada estimada (antes cierre)" : "Llegada estimada"}
                  </p>
                  <p className="text-sm font-semibold">
                    {fmtDate(cycle.estimatedArrivalDate)}
                  </p>
                  {cycle.calendarDelayDays > 0 ? (
                    <p className="text-[10px] text-amber-700">
                      +{cycle.calendarDelayDays} d calendario
                    </p>
                  ) : null}
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-[10px] uppercase text-slate-400">Unidades</p>
                  <p className="text-sm font-semibold">{fmtNum(cycle.units)} uds</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-[10px] uppercase text-slate-400">Capital</p>
                  <p className="text-sm font-semibold">
                    {cycle.capitalRequired != null
                      ? `${fmtNum(cycle.capitalRequired)} €`
                      : "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-[10px] uppercase text-slate-400">
                    {isPreventive ? "Periodo protegido" : "Cubre hasta"}
                  </p>
                  <p className="text-sm font-semibold">
                    {isPreventive
                      ? `${fmtDate(cycle.demandWindowFrom ?? cycle.coversFrom)} → ${fmtDate(cycle.demandWindowTo ?? cycle.coversTo)}`
                      : fmtDate(cycle.coversTo)}
                  </p>
                  {isPreventive ? (
                    <p className="text-[10px] text-slate-500">
                      Demanda considerada en el cálculo del pedido
                    </p>
                  ) : (
                    <p className="text-[10px] text-slate-500">
                      {fmtNum(cycle.coverageDays)} días · {fmtNum(cycle.demandCoveredUnits)} uds
                    </p>
                  )}
                </div>
                {isPreventive ? (
                  <>
                    <div className="rounded-lg bg-slate-50 p-2">
                      <p className="text-[10px] uppercase text-slate-400">
                        Este pedido cubre desde
                      </p>
                      <p className="text-sm font-semibold">
                        {fmtDate(cycle.effectiveCoverageFrom ?? cycle.estimatedArrivalDate)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2">
                      <p className="text-[10px] uppercase text-slate-400">Cubre hasta</p>
                      <p className="text-sm font-semibold">
                        {fmtDate(cycle.effectiveCoverageTo ?? cycle.coversTo)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2">
                      <p className="text-[10px] uppercase text-slate-400">
                        Stock previo antes de llegada
                      </p>
                      <p className="text-sm font-semibold">
                        {cycle.stockCoverageBeforeArrival === true
                          ? cycle.stockCoveredUntilBeforeArrival
                            ? `Sí · hasta ${fmtDate(cycle.stockCoveredUntilBeforeArrival)}`
                            : "Sí"
                          : cycle.stockCoverageBeforeArrival === false
                            ? "No"
                            : "—"}
                      </p>
                    </div>
                  </>
                ) : null}
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-[10px] uppercase text-slate-400">
                    Ventas perdidas antes de llegada
                  </p>
                  <p
                    className={`text-sm font-semibold ${cycle.estimatedLostSalesBeforeArrival > 0 ? "text-rose-700" : ""}`}
                  >
                    {fmtNum(cycle.estimatedLostSalesBeforeArrival)} uds
                  </p>
                </div>
              </div>

              <p className="mt-3 text-xs text-slate-600">{cycle.businessMessage}</p>
              <p className="mt-1 text-xs text-slate-500">
                {purchaseCycleReasonLabel(cycle.reason)}
                {cycle.projectedStockoutDate
                  ? ` · Rotura prevista: ${fmtDate(cycle.projectedStockoutDate)}`
                  : ""}
              </p>

              {(cycle.calendarEvents?.length ?? 0) > 0 ? (
                <ul className="mt-2 space-y-1">
                  {cycle.calendarEvents.map((ev) => (
                    <li
                      key={`${ev.type}-${ev.startDate}`}
                      className="rounded border border-amber-100 bg-amber-50 px-2 py-1 text-[11px] text-amber-900"
                    >
                      {ev.name}: +{ev.impactDays} d
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
