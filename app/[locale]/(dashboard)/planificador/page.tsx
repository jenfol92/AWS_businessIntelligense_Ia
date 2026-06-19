"use client";

import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Select,
  SelectItem,
  Text,
  Title,
} from "@tremor/react";
import {
  AlertCircle,
  Calendar,
  Check,
  Container,
  Euro,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Truck,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import OrderDraftBasket from "@/modules/orders/components/OrderDraftBasket";
import { useOrderDraftBasket } from "@/modules/orders/hooks/useOrderDraftBasket";
import { CONTAINER_CBM_LIMIT } from "@/modules/orders/types/draftBasket.types";
import ContainerOptimizationCard from "@/modules/planner/components/ContainerOptimizationCard";
import type { ContainerOptimizationGroup } from "@/modules/planner/types/planner.types";
import {
  containerGroupToBasketItems,
  getConsolidationSuggestionsForProduct,
  plannerLineToBasketItem,
  type PlannerLineForBasket,
} from "@/modules/planner/utils/plannerBasketMappers";

type EnrichedLine = PlannerLineForBasket & {
  supplierId?: string | null;
  supplierPreferredPortId?: string | null;
  displayPortName?: string;
  recommendedOrderDate: string | null;
  estimatedArrivalDate: string | null;
  recommendationExplanation: string;
  businessImpact: string;
  urgencyLabel: string;
  readableTiming: string;
};

type PlannerStats = {
  annualProductsToOrder: number;
  totalPurchaseCapitalRequired: number;
  annualRecommendedCbm: number;
  suggestedContainerGroups: number;
  goodCandidateGroups: number;
  earliestCriticalDate: string | null;
  dueThisWeekLines?: number;
};

type PlannerSummarySuccess = {
  ok: true;
  stats: PlannerStats;
  annualPurchasePlan: { lines: EnrichedLine[] };
  purchasePlan: { containerGroups: ContainerOptimizationGroup[] };
};

type PlannerFilters = {
  scenario: "conservative" | "base" | "optimistic";
  windowDays: 30 | 60 | 90 | 180;
  horizonMonths: 6 | 12 | 18 | 24;
  includeNewProducts: boolean;
};

const DEFAULT_FILTERS: PlannerFilters = {
  scenario: "base",
  windowDays: 90,
  horizonMonths: 12,
  includeNewProducts: true,
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function formatEur(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
}

function formatNum(n: number | null | undefined, d = 0): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
}

function formatFactoryPort(line: {
  supplierPreferredPortName?: string;
  displayPortName?: string;
}): string {
  const name = line.displayPortName ?? line.supplierPreferredPortName;
  if (!name || name === "Puerto sin definir") return "Puerto pendiente";
  return name;
}

function categoryLabel(line: EnrichedLine): string {
  const r = line.recommendationReasonLabel ?? "";
  if (line.urgencyLabel === "Crítico" || line.urgencyLabel === "Urgente") return "Urgente";
  if (r.includes("Año Nuevo")) return "Año Nuevo Chino";
  if (r.includes("Pico")) return "Pico ventas";
  if (r.includes("nuevo") || r.includes("benchmark")) return "Producto nuevo";
  if (line.urgencyLabel === "Planificado") return "Planificado";
  return "Recomendado";
}

function categoryBadgeColor(cat: string): "rose" | "amber" | "emerald" | "sky" | "violet" | "gray" {
  const m: Record<string, "rose" | "amber" | "emerald" | "sky" | "violet" | "gray"> = {
    Urgente: "rose",
    "Año Nuevo Chino": "amber",
    "Pico ventas": "sky",
    "Producto nuevo": "violet",
    Planificado: "emerald",
    Recomendado: "gray",
  };
  return m[cat] ?? "gray";
}

function buildSummaryUrl(filters: PlannerFilters): string {
  const q = new URLSearchParams({
    windowDays: String(filters.windowDays),
    country: "ALL",
    channel: "ALL",
    scenario: filters.scenario,
    horizonMonths: String(filters.horizonMonths),
    includeNewProducts: String(filters.includeNewProducts),
  });
  return `/api/planner/summary?${q.toString()}`;
}

function ToggleAddButton({
  selected,
  onClick,
}: {
  selected: boolean;
  onClick: () => void;
}) {
  if (selected) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200 text-sm font-medium hover:bg-emerald-200"
      >
        <Check className="h-4 w-4" />
        Añadido
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white text-blue-700 border border-blue-200 text-sm font-medium hover:bg-blue-50"
    >
      <Plus className="h-4 w-4" />
      Añadir
    </button>
  );
}

export default function PlanificadorPage() {
  const basket = useOrderDraftBasket();
  const [filters, setFilters] = useState<PlannerFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<PlannerSummarySuccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftToast, setDraftToast] = useState<string | null>(null);
  const [consolidationOpen, setConsolidationOpen] = useState<string | null>(null);
  const [reviewGroupId, setReviewGroupId] = useState<string | null>(null);

  const summaryUrl = useMemo(() => buildSummaryUrl(filters), [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(summaryUrl);
      const json = (await res.json()) as PlannerSummarySuccess | { ok: false; error: string };
      if (!res.ok || json.ok === false) {
        const msg =
          json.ok === false ? json.error : `Error HTTP ${res.status}`;
        setData(null);
        setError("error" in json ? json.error : `HTTP ${res.status}`);
        return;
      }
      setData(json);
      const carlyRows = json.annualPurchasePlan.lines.filter((l) =>
        (l.sku ?? "").toUpperCase().includes("CARLY"),
      );
      if (carlyRows.length > 0) {
        console.table(
          carlyRows.map((l) => ({
            sku: l.sku,
            proveedor_id: l.supplierId ?? null,
            puerto_preferido_id: l.supplierPreferredPortId,
            supplierPreferredPortName: l.supplierPreferredPortName,
            displayPortName: l.displayPortName,
          })),
        );
      }
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, [summaryUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const lines = data?.annualPurchasePlan.lines ?? [];
  const groups = data?.purchasePlan.containerGroups ?? [];
  const stats = data?.stats;

  const reviewGroup = groups.find((g) => g.groupId === reviewGroupId) ?? null;

  return (
    <div className="space-y-6 pb-4">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Title>Planificador de compras</Title>
          <Text className="mt-1 text-slate-700">
            Selecciona productos para tu orden en preparación. Revisa y guarda un único borrador.
          </Text>
        </div>
        <Flex className="flex-wrap gap-2" justifyContent="end">
          <Select
            value={filters.scenario}
            onValueChange={(v) => setFilters((f) => ({ ...f, scenario: v as PlannerFilters["scenario"] }))}
            disabled={loading}
          >
            <SelectItem value="base">Base</SelectItem>
            <SelectItem value="conservative">Conservador</SelectItem>
            <SelectItem value="optimistic">Optimista</SelectItem>
          </Select>
          <Button variant="secondary" icon={RefreshCw} onClick={() => void load()} loading={loading} size="xs">
            Actualizar
          </Button>
        </Flex>
      </div>

      {error && <Callout title="Error" icon={AlertCircle} color="rose">{error}</Callout>}
      {draftToast && (
        <Callout title="Borrador creado" color="emerald">
          <Flex justifyContent="between" alignItems="start" className="gap-2">
            <span>{draftToast}</span>
            <button type="button" onClick={() => setDraftToast(null)} aria-label="Cerrar">
              <X className="h-4 w-4 text-emerald-700" />
            </button>
          </Flex>
        </Callout>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { icon: Package, label: "Líneas", value: loading ? "—" : stats?.annualProductsToOrder },
          { icon: AlertCircle, label: "Urgentes", value: loading ? "—" : stats?.dueThisWeekLines ?? 0 },
          { icon: Euro, label: "Capital", value: loading ? "—" : formatEur(stats?.totalPurchaseCapitalRequired) },
          { icon: Truck, label: "CBM total", value: loading ? "—" : formatNum(stats?.annualRecommendedCbm, 1) },
          { icon: Container, label: "Grupos", value: loading ? "—" : stats?.suggestedContainerGroups },
          { icon: Calendar, label: "Fecha crítica", value: loading ? "—" : formatDate(stats?.earliestCriticalDate) },
        ].map(({ icon: Icon, label, value }) => (
          <Card key={label} className="ring-1 ring-slate-100 p-3">
            <Flex className="gap-2" justifyContent="start">
              <Icon className="h-5 w-5 text-slate-500 shrink-0" />
              <div>
                <Text className="text-xs">{label}</Text>
                <p className="text-lg font-semibold text-slate-900">{value}</p>
              </div>
            </Flex>
          </Card>
        ))}
      </div>

      {/* Tabla principal — desktop */}
      <section>
        <Title className="text-base mb-3">Necesidades de compra</Title>

        {loading ? (
          <Flex className="py-12 gap-2" justifyContent="center">
            <Loader2 className="h-5 w-5 animate-spin" />
            <Text>Cargando…</Text>
          </Flex>
        ) : lines.length === 0 ? (
          <Card className="p-8 text-center text-slate-600">Sin líneas recomendadas.</Card>
        ) : (
          <>
            {/* Móvil: cards */}
            <div className="md:hidden space-y-3">
              {lines.map((row) => {
                const cat = categoryLabel(row);
                const suggestions = getConsolidationSuggestionsForProduct(row.productId, groups, lines);
                const showConsolidation = (row.cbmTotal ?? 0) < CONTAINER_CBM_LIMIT && suggestions.length > 0;
                return (
                  <Card key={row.productId} className="ring-1 ring-slate-200 p-4">
                    <Flex justifyContent="between" className="gap-2">
                      <Badge color={categoryBadgeColor(cat)} size="sm">{cat}</Badge>
                      <ToggleAddButton
                        selected={basket.isSelected(row.productId)}
                        onClick={() => basket.toggle(plannerLineToBasketItem(row))}
                      />
                    </Flex>
                    <p className="font-semibold text-slate-900 mt-2">{row.productName}</p>
                    <p className="text-xs font-mono text-slate-500">{row.sku}</p>
                    {row.supplierName && <p className="text-xs text-slate-500">{row.supplierName}</p>}
                    <div className="grid grid-cols-2 gap-2 mt-3 text-sm text-slate-700">
                      <span>{formatNum(row.recommendedOrderUnits)} uds</span>
                      <span>{formatNum(row.cbmTotal, 2)} m³</span>
                      <span>{formatEur(row.purchaseCapitalRequired)}</span>
                      <span>Puerto fábrica: {formatFactoryPort(row)}</span>
                    </div>
                    <p className="text-sm text-slate-800 mt-2">{row.readableTiming}</p>
                    <p className="text-xs text-slate-600 mt-1">{row.recommendationExplanation}</p>
                    {showConsolidation && (
                      <button
                        type="button"
                        className="mt-2 text-sm text-blue-700 font-medium"
                        onClick={() => setConsolidationOpen(consolidationOpen === row.productId ? null : row.productId)}
                      >
                        Ver sugerencias de consolidación
                      </button>
                    )}
                    {consolidationOpen === row.productId && (
                      <ConsolidationPanel
                        suggestions={suggestions}
                        basket={basket}
                        lines={lines}
                        onAddAll={() => {
                          basket.addMany(
                            suggestions
                              .map((s) => lines.find((l) => l.productId === s.productId))
                              .filter((l): l is EnrichedLine => !!l)
                              .map(plannerLineToBasketItem),
                          );
                        }}
                      />
                    )}
                  </Card>
                );
              })}
            </div>

            {/* Desktop: tabla */}
            <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Categoría</th>
                    <th className="px-3 py-2 text-left">Producto</th>
                    <th className="px-3 py-2 text-right">Cant.</th>
                    <th className="px-3 py-2 text-right">CBM</th>
                    <th className="px-3 py-2 text-right">Capital</th>
                    <th className="px-3 py-2 text-left">Puerto fábrica</th>
                    <th className="px-3 py-2 text-left">Fecha límite</th>
                    <th className="px-3 py-2 text-left">ETA</th>
                    <th className="px-3 py-2 text-left">Argumento</th>
                    <th className="px-3 py-2 text-left">Agente</th>
                    <th className="px-3 py-2 text-center">Acción</th>
                    <th className="px-3 py-2 text-left">Consolidación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((row) => {
                    const cat = categoryLabel(row);
                    const suggestions = getConsolidationSuggestionsForProduct(row.productId, groups, lines);
                    const showConsolidation = (row.cbmTotal ?? 0) < CONTAINER_CBM_LIMIT && suggestions.length > 0;
                    const isOpen = consolidationOpen === row.productId;
                    return (
                      <Fragment key={row.productId}>
                        <tr className="hover:bg-slate-50/80">
                          <td className="px-3 py-2">
                            <Badge color={categoryBadgeColor(cat)} size="xs">{cat}</Badge>
                          </td>
                          <td className="px-3 py-2 max-w-[200px]">
                            <p className="font-medium text-slate-900">{row.productName}</p>
                            <p className="text-xs font-mono text-slate-500">{row.sku}</p>
                            {row.supplierName && (
                              <p className="text-xs text-slate-400 truncate">{row.supplierName}</p>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">{formatNum(row.recommendedOrderUnits)}</td>
                          <td className="px-3 py-2 text-right">{formatNum(row.cbmTotal, 2)}</td>
                          <td className="px-3 py-2 text-right">{formatEur(row.purchaseCapitalRequired)}</td>
                          <td className="px-3 py-2 text-slate-800">
                            {formatFactoryPort(row)}
                          </td>
                          <td className="px-3 py-2 text-slate-800">{row.readableTiming}</td>
                          <td className="px-3 py-2">{formatDate(row.estimatedArrivalDate)}</td>
                          <td className="px-3 py-2 text-slate-700 max-w-[180px]">{row.recommendationReasonLabel}</td>
                          <td className="px-3 py-2 text-slate-700">{row.agentContact}</td>
                          <td className="px-3 py-2 text-center">
                            <ToggleAddButton
                              selected={basket.isSelected(row.productId)}
                              onClick={() => basket.toggle(plannerLineToBasketItem(row))}
                            />
                          </td>
                          <td className="px-3 py-2">
                            {showConsolidation ? (
                              <button
                                type="button"
                                className="text-xs text-blue-700 hover:underline"
                                onClick={() => setConsolidationOpen(isOpen ? null : row.productId)}
                              >
                                {isOpen ? "Ocultar" : "Ver sugerencias"}
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={12} className="px-4 py-3 bg-blue-50/50">
                              <ConsolidationPanel
                                suggestions={suggestions}
                                basket={basket}
                                lines={lines}
                                onAddAll={() => {
                                  basket.addMany(
                                    suggestions
                                      .map((s) => lines.find((l) => l.productId === s.productId))
                                      .filter((l): l is EnrichedLine => !!l)
                                      .map(plannerLineToBasketItem),
                                  );
                                }}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Grupos de optimización */}
      <section>
        <Title className="text-base mb-2">Grupos sugeridos para optimizar contenedor</Title>
        <Text className="text-slate-600 mb-4 text-sm">
          Añade un grupo completo a la orden en preparación. Usa «Revisar orden» en la barra inferior cuando termines.
        </Text>
        {loading ? null : groups.length === 0 ? (
          <Text className="text-slate-500">Sin grupos.</Text>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-min">
            {groups.map((g) => (
              <div key={g.groupId} className="max-w-full">
                <ContainerOptimizationCard
                  group={g}
                  onReview={(grp) => setReviewGroupId(reviewGroupId === grp.groupId ? null : grp.groupId)}
                  onAddGroupToBasket={(grp) => basket.addMany(containerGroupToBasketItems(grp))}
                />
              </div>
            ))}
          </div>
        )}
        {reviewGroup && (
          <Callout className="mt-3" title={`Grupo: ${reviewGroup.recommendedPortName}`} color="blue">
            <p className="text-sm">{reviewGroup.explanation}</p>
          </Callout>
        )}
      </section>

      <OrderDraftBasket
        basket={basket}
        onDraftSaved={() => {
          setDraftToast("Borrador creado correctamente");
          void load();
        }}
      />
    </div>
  );
}

function ConsolidationPanel({
  suggestions,
  basket,
  lines,
  onAddAll,
}: {
  suggestions: ReturnType<typeof getConsolidationSuggestionsForProduct>;
  basket: ReturnType<typeof useOrderDraftBasket>;
  lines: PlannerLineForBasket[];
  onAddAll: () => void;
}) {
  if (suggestions.length === 0) {
    return <p className="text-sm text-slate-600">No hay productos compatibles para consolidar.</p>;
  }

  return (
    <div className="space-y-2">
      <Flex justifyContent="between" alignItems="center" className="flex-wrap gap-2">
        <Text className="text-sm font-semibold text-slate-800">
          Productos que podrían consolidarse ({suggestions.length})
        </Text>
        <button
          type="button"
          onClick={onAddAll}
          className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          Añadir consolidación completa
        </button>
      </Flex>
      <ul className="space-y-2">
        {suggestions.map((s) => {
          const line = lines.find((l) => l.productId === s.productId);
          if (!line) return null;
          return (
            <li
              key={s.productId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{s.productName}</p>
                <p className="text-xs text-slate-500">
                  {s.recommendedUnits} uds · {formatNum(s.cbmTotal, 2)} m³ · {s.supplierName ?? "—"}
                  {" · "}Puerto fábrica: {s.supplierPreferredPortName}
                  {" · "}Puerto grupo: {s.recommendedPortName}
                  {s.distanceKm != null ? ` · ${Math.round(s.distanceKm)} km` : ""}
                </p>
                <p className="text-xs text-blue-800">{s.reason}</p>
              </div>
              <ToggleAddButton
                selected={basket.isSelected(s.productId)}
                onClick={() => basket.toggle(plannerLineToBasketItem(line))}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
