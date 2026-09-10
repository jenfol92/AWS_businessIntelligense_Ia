"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarRange,
  CircleDollarSign,
  PackageCheck,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { DEFAULT_LOCALE, isLocale } from "@/config/i18n";
import { useGlobalFilters } from "@/shared/filters/useGlobalFilters";
import type {
  InventoryComparisonResponse,
  InventoryProductSummary,
} from "@/modules/inventory/types/inventory.types";

type DashboardError = { ok?: false; error?: string };

function resolveLocale(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

function formatUnits(value: number): string {
  return value.toLocaleString("es-ES", { maximumFractionDigits: 0 });
}

function formatCoverage(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Sin demanda fiable";
  return `${value.toLocaleString("es-ES", { maximumFractionDigits: 0 })} días`;
}

function riskLabel(product: InventoryProductSummary): string {
  if (product.stockTotal <= 0) return "Sin stock";
  if (product.risk === "critico") return "Riesgo crítico";
  if (!product.hasHistory) return "Sin histórico";
  if (product.risk === "bajo") return "Cobertura baja";
  return "Revisar";
}

function riskRank(product: InventoryProductSummary): number {
  if (product.stockTotal <= 0) return 0;
  if (product.risk === "critico") return 1;
  if (!product.hasHistory) return 2;
  if (product.risk === "bajo") return 3;
  return 4;
}

function flattenProducts(products: InventoryProductSummary[]): InventoryProductSummary[] {
  return products.flatMap((product) => [product, ...product.variantes]);
}

function buildInventoryUrl(channel: string): string {
  const query = new URLSearchParams();
  if (channel !== "ALL") query.set("canal", channel);
  return `/api/inventory/comparison?${query.toString()}`;
}

export default function DashboardBI() {
  const params = useParams();
  const locale = resolveLocale(params?.locale);
  const { canal, pais, windowDays } = useGlobalFilters();
  const [data, setData] = useState<InventoryComparisonResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(buildInventoryUrl(canal), {
        cache: "no-store",
      });
      const payload = (await response.json()) as
        | InventoryComparisonResponse
        | DashboardError;

      if (!response.ok || payload.ok !== true) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : `Error HTTP ${response.status}`,
        );
      }

      setData(payload);
      setRefreshedAt(new Date());
    } catch (loadError) {
      setData(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar el centro de decisiones.",
      );
    } finally {
      setLoading(false);
    }
  }, [canal]);
/*
  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);
*/
  const decisionProducts = useMemo(() => {
    if (!data) return [];
    return flattenProducts(data.products)
      .filter(
        (product) =>
          product.stockTotal <= 0 ||
          product.risk === "critico" ||
          product.risk === "bajo" ||
          !product.hasHistory,
      )
      .sort((left, right) => {
        const rank = riskRank(left) - riskRank(right);
        if (rank !== 0) return rank;
        return (
          (left.coverageDays ?? Number.POSITIVE_INFINITY) -
          (right.coverageDays ?? Number.POSITIVE_INFINITY)
        );
      })
      .slice(0, 8);
  }, [data]);

  const summary = data?.summary;
  const scopeLabel = `${pais === "ALL" ? "Todos los países" : pais} · ${
    canal === "ALL" ? "Todos los canales" : canal
  } · ${windowDays} días`;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-indigo-600">
            <Sparkles className="h-4 w-4" aria-hidden />
            Centro de decisiones
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Qué requiere atención hoy
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Excepciones operativas calculadas con el inventario actual. No ejecuta compras ni pagos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            {scopeLabel}
          </span>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            disabled={loading}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            Actualizar
          </button>
        </div>
      </header>

      {error ? (
        <section role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" aria-hidden />
            <div>
              <h2 className="text-sm font-semibold text-rose-950">Datos no disponibles</h2>
              <p className="mt-1 text-sm text-rose-800">{error}</p>
            </div>
          </div>
        </section>
      ) : null}

      <section aria-label="Indicadores de excepción" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DecisionMetric label="Productos con riesgo" value={summary?.productsAtRisk} note="Requieren revisar reposición" icon={AlertTriangle} tone="danger" loading={loading} />
        <DecisionMetric label="Stock cero" value={summary?.productsStockZero} note="Prioridad operativa máxima" icon={Boxes} tone="danger" loading={loading} />
        <DecisionMetric label="Sin histórico" value={summary?.productsNoHistory} note="Forecast con evidencia limitada" icon={ShieldAlert} tone="warning" loading={loading} />
        <DecisionMetric label="Con inbound" value={summary?.productsWithInbound} note="Entradas ya identificadas" icon={PackageCheck} tone="positive" loading={loading} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.7fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Cola de decisiones de inventario</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Ordenada por falta de stock, riesgo, ausencia de histórico y cobertura.
              </p>
            </div>
            <Link href={`/${locale}/inventario`} className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-700 hover:text-indigo-600">
              Abrir inventario <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          {loading ? (
            <div className="space-y-3 p-4" aria-label="Cargando decisiones">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="h-14 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : decisionProducts.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No hay excepciones de inventario para los filtros actuales.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {decisionProducts.map((product) => (
                <article key={product.productoId} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_120px_120px] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-slate-900">{product.nombre}</h3>
                      <span className={riskBadgeClass(product)}>{riskLabel(product)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {product.sku} · {product.proveedorNombre ?? "Proveedor no informado"}
                    </p>
                  </div>
                  <MetricValue label="Stock operativo" value={`${formatUnits(product.stockTotal)} u.`} />
                  <MetricValue label="Cobertura" value={formatCoverage(product.coverageDays)} />
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-3">
          <NavigationCard href={`/${locale}/planificador`} title="Planificar reposición" description="Revisar cantidad, fecha límite, calendario logístico y consolidación." icon={CalendarRange} />
          <NavigationCard href={`/${locale}/finanzas/planificacion`} title="Validar financiación" description="Comprobar caja, vencimientos y crédito antes de aprobar una compra." icon={CircleDollarSign} />
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
            <div className="font-semibold text-slate-800">Límite de esta vista</div>
            <p className="mt-1 leading-5">
              Solo prioriza excepciones. Las recomendaciones detalladas y cualquier ejecución permanecen en sus módulos propietarios.
            </p>
            {refreshedAt ? (
              <p className="mt-2 text-[11px] text-slate-500">
                Lectura actualizada: {refreshedAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function MetricValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

type MetricTone = "danger" | "warning" | "positive";

function DecisionMetric({ label, value, note, icon: Icon, tone, loading }: {
  label: string;
  value: number | undefined;
  note: string;
  icon: typeof AlertTriangle;
  tone: MetricTone;
  loading: boolean;
}) {
  const toneClass = {
    danger: "bg-rose-50 text-rose-700 ring-rose-100",
    warning: "bg-amber-50 text-amber-700 ring-amber-100",
    positive: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  }[tone];

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-950">
            {loading ? "—" : formatUnits(value ?? 0)}
          </div>
        </div>
        <span className={`grid h-9 w-9 place-items-center rounded-lg ring-1 ${toneClass}`}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-500">{note}</p>
    </article>
  );
}

function riskBadgeClass(product: InventoryProductSummary): string {
  const base = "rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset";
  if (product.stockTotal <= 0 || product.risk === "critico") {
    return `${base} bg-rose-50 text-rose-700 ring-rose-200`;
  }
  if (!product.hasHistory || product.risk === "bajo") {
    return `${base} bg-amber-50 text-amber-700 ring-amber-200`;
  }
  return `${base} bg-slate-50 text-slate-600 ring-slate-200`;
}

function NavigationCard({ href, title, description, icon: Icon }: {
  href: string;
  title: string;
  description: string;
  icon: typeof CalendarRange;
}) {
  return (
    <Link href={href} className="group block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-200 hover:shadow-md">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-indigo-600" aria-hidden />
      </div>
    </Link>
  );
}
