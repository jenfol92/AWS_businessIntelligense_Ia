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
import { fetchInventoryProductDetail } from "../services/inventoryDetailClient";
import { InventoryForecastSimulationPanel } from "./InventoryForecastSimulationPanel";
import { ForecastMethodExplanationBox } from "./ForecastMethodExplanationBox";
import type { ProductForecastConfigUpsertBody } from "@/modules/planning/types";
import type {
  InventoryComparisonResponse,
  InventoryCountryStockRow,
  InventoryInboundRow,
  InventoryInboundPlanningKind,
  InventoryLotesResponse,
  InventoryProductDetailResponse,
  InventoryProductSummary,
  InventoryRiskLevel,
} from "../types/inventory.types";
import { inboundPlanningKindLabel } from "@/modules/planner/services/mapForecastInboundToInventoryRow";
import OrderReadonlyModal from "@/modules/orders/components/OrderReadonlyModal";

type DetailFail = { ok: false; error: string };

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

function resolveLocale(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

function riskBadgeClass(risk: InventoryRiskLevel): string {
  switch (risk) {
    case "critico":
      return "bg-rose-100 text-rose-800 ring-rose-200";
    case "bajo":
      return "bg-amber-100 text-amber-800 ring-amber-200";
    case "sin_ventas":
      return "bg-slate-100 text-slate-600 ring-slate-200";
    default:
      return "bg-emerald-100 text-emerald-800 ring-emerald-200";
  }
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("es-ES", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
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
  const { canal, pais, windowDays } = useGlobalFilters();
  const showStockoutDebug =
    process.env.NODE_ENV === "development" &&
    searchParams.get("debugStockout") === "1";
  const showAmazonImportDiagnostics =
    process.env.NODE_ENV === "development" ||
    searchParams.get("debugAmazonImports") === "1";

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
  const [detail, setDetail] = useState<InventoryProductDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [simulationOverride, setSimulationOverride] =
    useState<ProductForecastConfigUpsertBody | null>(null);
  const activeDetailAbortRef = useRef<AbortController | null>(null);
  const activeListAbortRef = useRef<AbortController | null>(null);
  const detailRequestIdRef = useRef(0);
  const listRequestIdRef = useRef(0);
  const simulationProductIdRef = useRef<string | null>(null);

  const [expandedPais, setExpandedPais] = useState<string | null>(null);
  const [lotesData, setLotesData] = useState<InventoryLotesResponse | null>(null);
  const [lotesLoading, setLotesLoading] = useState(false);
  const [amazonImportLoading, setAmazonImportLoading] = useState<string | null>(null);
  const [amazonImportMessage, setAmazonImportMessage] = useState<string | null>(null);

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

  useEffect(() => {
    if (!initialDetailLoaded) return;
    const timeoutId = window.setTimeout(() => {
      void loadList();
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
      activeListAbortRef.current?.abort();
    };
  }, [initialDetailLoaded, loadList]);

  useEffect(() => {
    return () => {
      activeListAbortRef.current?.abort();
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
      try {
        const json = await fetchInventoryProductDetail(productId, {
          canal,
          pais,
          windowDays,
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
    [canal, pais, windowDays, showStockoutDebug],
  );

  useEffect(() => {
    simulationProductIdRef.current = null;
    setSimulationOverride(null);
  }, [selectedId]);

  useEffect(() => {
    return () => {
      activeDetailAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!selectedProductId) return;
    const effectiveOverride =
      simulationProductIdRef.current === selectedProductId
        ? simulationOverride
        : null;
    void loadDetail(selectedProductId, effectiveOverride);
  }, [
    selectedProductId,
    loadDetail,
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

  type AmazonForecastImportKind = "sales" | "salesAlt" | "snapshot" | "ledger";

  function formatAmazonImportResult(
    label: string,
    json: {
      ok: boolean;
      error?: string;
      summary?: {
        reportId?: string;
        status?: string;
        processingStatus?: string | null;
        rowsUpserted?: number;
        ventasDiariasUpserted?: number;
        warnings?: string[];
        error?: string;
      };
    },
  ): string {
    const summary = json.summary;
    return [
      `${label}: ${fmtNum(summary?.rowsUpserted ?? 0)} filas actualizadas`,
      summary?.ventasDiariasUpserted != null
        ? `ventas_diarias ${fmtNum(summary.ventasDiariasUpserted)}`
        : null,
      summary?.status ? `status ${summary.status}` : null,
      summary?.processingStatus ? `processing ${summary.processingStatus}` : null,
      summary?.reportId ? `reportId ${summary.reportId}` : null,
      json.error || summary?.error ? `error ${json.error ?? summary?.error}` : null,
      ...(summary?.warnings?.slice(0, 3).map((warning) => `warning ${warning}`) ?? []),
    ]
      .filter(Boolean)
      .join(" · ");
  }

  async function runAmazonForecastImport(kind: AmazonForecastImportKind) {
    const labels = {
      sales: "ventas FBA",
      salesAlt: "ventas FBA alt.",
      snapshot: "stock FBA",
      ledger: "ledger FBA",
    };
    const confirmed = window.confirm(
      `Importar ${labels[kind]} desde SP-API. No se tocará inventario_paises ni stock manual.`,
    );
    if (!confirmed) return;

    const toDate = new Date().toISOString().slice(0, 10);
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const fromDate = from.toISOString().slice(0, 10);

    const endpoint =
      kind === "sales" || kind === "salesAlt"
        ? "/api/amazon/reports/fba-sales/import"
        : kind === "snapshot"
          ? "/api/amazon/inventory/fba-snapshot/import"
          : "/api/amazon/reports/fba-ledger/import";

    const body =
      kind === "snapshot"
        ? {}
        : {
            fromDate,
            toDate,
            ...(kind === "salesAlt"
              ? { reportType: "GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL" }
              : {}),
          };

    setAmazonImportLoading(kind);
    setAmazonImportMessage(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        summary?: {
          rowsParsed?: number;
          rowsUpserted?: number;
          ventasDiariasUpserted?: number;
          reportId?: string;
          status?: string;
          processingStatus?: string | null;
          warnings?: string[];
          error?: string;
        };
      };
      if (!res.ok || !json.ok) {
        setAmazonImportMessage(formatAmazonImportResult(labels[kind], json));
        return;
      }
      const summary = json.summary;
      setAmazonImportMessage(
        `${labels[kind]}: ${fmtNum(summary?.rowsUpserted ?? 0)} filas actualizadas` +
          (summary?.ventasDiariasUpserted != null
            ? ` · ventas_diarias ${fmtNum(summary.ventasDiariasUpserted)}`
            : "") +
          (summary?.status ? ` · estado ${summary.status}` : ""),
      );
      if (selectedProductId) {
        await loadDetail(selectedProductId, simulationOverride);
      }
    } catch (error) {
      setAmazonImportMessage(
        error instanceof Error ? error.message : "Importación SP-API fallida.",
      );
    } finally {
      setAmazonImportLoading(null);
    }
  }

  const flatProducts = listData ? flattenProducts(listData.products) : [];
  const showLiteProducts = !listData && liteProducts.length > 0;
  const visibleProductsCount = listData ? flatProducts.length : liteProducts.length;
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

      {showAmazonImportDiagnostics ? (
      <Card className="ring-1 ring-amber-100 bg-amber-50/30 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Title className="text-base">Diagnóstico SP-API</Title>
            <Text className="text-xs text-slate-500">
              Acción manual de diagnóstico. El stock FBA debe actualizarse por tarea programada.
              No actualiza inventario_paises ni ejecuta cron.
            </Text>
            {amazonImportMessage ? (
              <Text className="mt-1 text-xs text-slate-600">{amazonImportMessage}</Text>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { key: "sales" as const, label: "Importar ventas FBA" },
              { key: "salesAlt" as const, label: "Importar ventas FBA alt." },
              { key: "snapshot" as const, label: "Importar stock FBA" },
              { key: "ledger" as const, label: "Importar ledger FBA" },
            ].map((action) => (
              <button
                key={action.key}
                type="button"
                onClick={() => void runAmazonForecastImport(action.key)}
                disabled={amazonImportLoading != null}
                className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {amazonImportLoading === action.key ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </Card>
      ) : null}

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
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void loadList()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
            >
              <RefreshCw className={`h-4 w-4 ${listLoading ? "animate-spin" : ""}`} />
              Actualizar
            </button>
          </div>
        </div>
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
                  "ok",
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
              liteProducts.map((p) => {
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

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Stock total", value: fmtNum(detail.product.stockTotal) },
                    { label: "FBA", value: fmtNum(detail.product.stockFba) },
                    { label: "FBM", value: fmtNum(detail.product.stockFbm) },
                    {
                      label: `Ventas ${detail.recentWindowDays}d`,
                      value: fmtNum(detail.product.salesUnits30),
                    },
                    {
                      label: "Ventas 90d",
                      value: fmtNum(detail.product.salesUnits90),
                    },
                    {
                      label: "Cobertura",
                      value:
                        detail.product.coverageDays != null
                          ? `${Math.round(detail.product.coverageDays)} d`
                          : "—",
                    },
                    {
                      label: "Riesgo",
                      value: riskLabel(detail.product.risk),
                    },
                    {
                      label: "Inbound conf.",
                      value: fmtNum(detail.inboundUnitsConfirmedTotal ?? detail.inboundUnitsTotal),
                    },
                    {
                      label: "Inbound prov.",
                      value: fmtNum(detail.inboundUnitsProvisionalTotal ?? 0),
                    },
                    {
                      label: "Forecast",
                      value: forecastMethodLabel(detail.forecast.method),
                    },
                  ].map(({ label, value }) => (
                    <div
                      key={label}
                      className="rounded-lg border border-slate-100 bg-slate-50/60 p-2"
                    >
                      <Text className="text-[10px] uppercase text-slate-400">
                        {label}
                      </Text>
                      <p className="text-sm font-semibold text-slate-900">{value}</p>
                    </div>
                  ))}
                </div>
              </Card>

              {detail.operationalStock ? (
                <OperationalStockPanel stock={detail.operationalStock} />
              ) : null}

              <Card className="ring-1 ring-slate-100 p-4">
                <Title className="text-base mb-3">Stock por país</Title>
                <CountryStockTable
                  countries={detail.countries}
                  expandedPais={expandedPais}
                  lotesLoading={lotesLoading}
                  lotesData={lotesData}
                  onToggleLotes={toggleLotes}
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

              <Card className="ring-1 ring-slate-100 p-4">
                <Title className="text-base mb-3">Simulación de forecast</Title>
                <InventoryForecastSimulationPanel
                  productId={detail.product.productoId}
                  isSimulationActive={isSimulationActiveForSelectedProduct}
                  dataAvailability={
                    detail.annualForecast.methodInfo?.dataAvailability ?? {
                      hasOwnSales: detail.annualForecast.previousYearTotalUnits > 0,
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

              <Card className="ring-1 ring-slate-100 p-4">
                <Title className="text-base mb-2">Forecast / reposición</Title>
                <ForecastPanel
                  detail={detail}
                  simulationActive={isSimulationActiveForSelectedProduct}
                />
              </Card>

              <Card className="ring-1 ring-slate-100 p-4">
                <Title className="text-base mb-1">Forecast anual</Title>
                <Text className="mb-3 text-xs text-slate-500">
                  Combina histórico del año base, stock operativo actual y entradas
                  previstas para proyectar el año en curso.
                </Text>
                <AnnualForecastPanel
                  detail={detail}
                  simulationActive={isSimulationActiveForSelectedProduct}
                  showStockoutDebug={showStockoutDebug}
                />
              </Card>
            </>
          ) : (
            <Card className="p-8 text-center text-slate-500 ring-1 ring-slate-100">
              Selecciona un producto para ver el detalle.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function operationalFbaSourceLabel(
  source: NonNullable<InventoryProductDetailResponse["operationalStock"]>["stockOperationalFbaSource"],
): string {
  switch (source) {
    case "fba_inventory_snapshot":
      return "snapshot FBA operativo";
    case "country_inventory":
      return "stock por país actualizado";
    case "ledger":
      return "ledger FBA";
    default:
      return "sin stock FBA registrado";
  }
}

function OperationalStockPanel({
  stock,
}: {
  stock: NonNullable<InventoryProductDetailResponse["operationalStock"]>;
}) {
  const syncStatus = stock.fbaInventorySyncStatus;
  const countrySummary = stock.stockFbaAppByCountry
    .map((row) => `${row.pais} ${fmtNum(row.stockFba + row.stockFbm)}`)
    .join(" · ");

  return (
    <Card className="ring-1 ring-slate-100 p-4">
      <Title className="text-base mb-3">Stock operativo</Title>
      <div className="space-y-2 text-sm text-slate-800">
        <p>
          <span className="text-slate-500">Stock FBA operativo usado: </span>
          <span className="font-semibold text-slate-900">
            {fmtNum(stock.stockOperationalFba)} uds
          </span>
        </p>
        <p className="text-xs text-slate-500">
          Fuente: {operationalFbaSourceLabel(stock.stockOperationalFbaSource)}
        </p>
        <p className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-950">
          El stock FBA se actualiza automáticamente por tarea programada. Esta
          pantalla muestra el último snapshot disponible.
        </p>
        {stock.stockFbaLatestSnapshot != null && stock.stockFbaLatestSnapshotAt ? (
          <p className="text-xs text-slate-500">
            Snapshot FBA operativo: {fmtNum(stock.stockFbaLatestSnapshot)} uds ·{" "}
            {fmtDate(stock.stockFbaLatestSnapshotAt)}
            <span className="block text-[11px] text-slate-400">
              Fuente principal: {stock.stockFbaLatestSnapshotSource ?? "SP-API FBA Inventory"}. FBA Country queda como distribución auxiliar.
            </span>
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            Sin snapshot FBA operativo importado. Se usa fallback ledger/stock por país.
          </p>
        )}
        {syncStatus ? (
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <p className="font-medium text-slate-800">Sincronización automática FBA</p>
            <p>Última ejecución: {fmtDateTime(syncStatus.lastRunAt)}</p>
            <p>Último éxito: {fmtDateTime(syncStatus.lastSuccessAt)}</p>
            <p>Estado: {syncStatus.lastStatus ?? "—"}</p>
            <p>Filas actualizadas: {fmtNum(syncStatus.lastRowsUpserted)}</p>
            {syncStatus.nextRunHint ? <p>Próxima ejecución: {syncStatus.nextRunHint}</p> : null}
            {syncStatus.lastError ? (
              <p className="mt-1 text-rose-700">Error: {syncStatus.lastError}</p>
            ) : null}
          </div>
        ) : null}
        <p>
          <span className="text-slate-500">FBM: </span>
          <span className="font-semibold">{fmtNum(stock.stockOperationalFbm)} uds</span>
        </p>
        <p>
          <span className="text-slate-500">Total operativo (forecast ALL/ALL): </span>
          <span className="font-semibold text-slate-900">
            {fmtNum(stock.stockOperationalTotal)} uds
          </span>
        </p>
        <p className="text-xs text-slate-500">
          Stock por país (inventario_paises): {countrySummary || "—"}
        </p>
        {stock.stockFbaLatestLedger != null && stock.stockFbaLatestLedgerDate ? (
          <p className="text-xs text-slate-500">
            Referencia ledger FBA: {fmtNum(stock.stockFbaLatestLedger)} uds ·{" "}
            {fmtDate(stock.stockFbaLatestLedgerDate)}
            <span className="block text-[11px] text-slate-400">
              Solo auditoría; no es el stock FBA operativo actual.
            </span>
          </p>
        ) : (
          <p className="text-xs text-slate-500">Sin referencia ledger FBA importada.</p>
        )}
        {stock.stockFbaDiscrepancy ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            {stock.discrepancyMessage}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function CountryStockTable({
  countries,
  expandedPais,
  lotesLoading,
  lotesData,
  onToggleLotes,
}: {
  countries: InventoryCountryStockRow[];
  expandedPais: string | null;
  lotesLoading: boolean;
  lotesData: InventoryLotesResponse | null;
  onToggleLotes: (pais: string) => void;
}) {
  if (countries.length === 0) {
    return <Text className="text-sm text-slate-500">Sin inventario por país.</Text>;
  }

  return (
    <>
      <ResponsiveTable
        desktop={
          <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-2 w-8" />
              <th className="py-2 pr-3">País</th>
              <th className="py-2 pr-3 text-right">FBA</th>
              <th className="py-2 pr-3 text-right">FBM</th>
              <th className="py-2 pr-3 text-right">Total</th>
              <th className="py-2 pr-3 text-right">V.30d</th>
              <th className="py-2 pr-3 text-right">V.90d</th>
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
                  <td className="py-2 pr-3 font-medium">{row.pais}</td>
                  <td className="py-2 pr-3 text-right">{fmtNum(row.stockFba)}</td>
                  <td className="py-2 pr-3 text-right">{fmtNum(row.stockFbm)}</td>
                  <td className="py-2 pr-3 text-right">{fmtNum(row.stockTotal)}</td>
                  <td className="py-2 pr-3 text-right">{fmtNum(row.salesUnits30)}</td>
                  <td className="py-2 pr-3 text-right">{fmtNum(row.salesUnits90)}</td>
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
                    <td colSpan={9} className="p-4">
                      <LotesPanel loading={lotesLoading} data={lotesData} />
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
                  { label: "FBA", value: fmtNum(row.stockFba) },
                  { label: "FBM", value: fmtNum(row.stockFbm) },
                  { label: "Total", value: fmtNum(row.stockTotal) },
                  { label: "Ventas 30d", value: fmtNum(row.salesUnits30) },
                  { label: "Ventas 90d", value: fmtNum(row.salesUnits90) },
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
                  <LotesPanel loading={lotesLoading} data={lotesData} />
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
