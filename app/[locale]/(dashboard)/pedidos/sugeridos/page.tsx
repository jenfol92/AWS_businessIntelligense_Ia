"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Metric,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
  Title,
} from "@tremor/react";
import {
  AlertCircle,
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Euro,
  Layers,
  Loader2,
  Package,
  RefreshCw,
  ShoppingCart,
  Truck,
  XCircle,
} from "lucide-react";
import { formatCurrency, formatNumber } from "@/shared/utils/formatters";

// ─── DTOs ─────────────────────────────────────────────────────────────────────

type OrderTimingStatus = "OVERDUE" | "DUE_NOW" | "ON_TIME";

type ItemPreviewDTO = {
  sku: string;
  productName: string | undefined;
  quantity: number;
  cbmTotal: number | null;
  lineCostEur: number | null;
  orderTimingStatus: OrderTimingStatus;
  daysLate: number;
};

type WarningDTO = {
  code: string;
  message: string;
};

type DraftPreviewDTO = {
  groupKey: string;
  supplierName: string | null;
  agentName: string | null;
  originPortId: string | null;
  productCount: number;
  totalUnits: number;
  totalCbm: number;
  totalWeightKg: number;
  totalPurchaseCapitalRequired: number;
  estimatedDepositAmount: number;
  estimatedBalanceAmount: number;
  earliestOrderDate: string | null;
  latestOrderDate: string | null;
  orderTimingStatus: OrderTimingStatus;
  isReadyToSubmit: boolean;
  warnings: WarningDTO[];
  itemsPreview: ItemPreviewDTO[];
};

type SummaryDTO = {
  totalGroups: number;
  totalLines: number;
  totalUnits: number;
  totalCbm: number;
  totalWeightKg: number;
  totalPurchaseCapitalRequired: number;
  groupsWithContainer: number;
  groupsWithIncompleteData: number;
  groupsOverdue: number;
  groupsDueNow: number;
};

type StatsDTO = {
  count: number;
  annualProductsToOrder: number;
  overduePurchaseLines: number;
  dueNowPurchaseLines: number;
  annualRecommendedUnits: number;
  annualRecommendedCbm: number;
};

type PreviewResponse =
  | { ok: true; stats: StatsDTO; summary: SummaryDTO; drafts: DraftPreviewDTO[] }
  | { ok: false; error: string };

type CreateResponse =
  | { ok: true; orden: { id: string; numero_orden: string | null }; groupKey: string }
  | { ok: false; error: string; code?: string; warnings?: WarningDTO[] };

// ─── Filters ──────────────────────────────────────────────────────────────────

type PreviewFilters = {
  scenario: "conservative" | "base" | "optimistic";
  windowDays: 30 | 60 | 90 | 180;
  horizonMonths: 6 | 12 | 18 | 24;
  includeNewProducts: boolean;
};

const DEFAULT_FILTERS: PreviewFilters = {
  scenario: "base",
  windowDays: 90,
  horizonMonths: 12,
  includeNewProducts: true,
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function formatDateUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function buildPreviewUrl(f: PreviewFilters): string {
  const q = new URLSearchParams({
    scenario: f.scenario,
    windowDays: String(f.windowDays),
    horizonMonths: String(f.horizonMonths),
    country: "ALL",
    channel: "ALL",
    includeNewProducts: String(f.includeNewProducts),
  });
  return `/api/orders/planner-preview?${q.toString()}`;
}

// ─── Small presentational components ─────────────────────────────────────────

function TimingBadge({ status }: { status: OrderTimingStatus }) {
  if (status === "OVERDUE") return <Badge color="rose" size="xs">Retrasado</Badge>;
  if (status === "DUE_NOW") return <Badge color="amber" size="xs">Urgente</Badge>;
  return <Badge color="emerald" size="xs">En plazo</Badge>;
}

function ReadyBadge({ ready }: { ready: boolean }) {
  if (ready) {
    return (
      <Flex justifyContent="start" className="gap-1">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <Text className="text-xs text-emerald-700">Listo</Text>
      </Flex>
    );
  }
  return (
    <Flex justifyContent="start" className="gap-1">
      <XCircle className="h-4 w-4 text-rose-500" />
      <Text className="text-xs text-rose-600">No listo</Text>
    </Flex>
  );
}

const WARNING_LABELS: Record<string, string> = {
  NO_SUPPLIER: "Sin proveedor",
  NO_ORIGIN_PORT: "Sin puerto",
  MISSING_CBM_DATA: "Sin CBM",
  MISSING_COST_DATA: "Sin coste",
  OVERDUE_LINES: "Líneas retrasadas",
  BALANCE_DATE_BEFORE_TODAY: "Balance vencido",
  DEPOSIT_DATE_BEFORE_TODAY: "Depósito vencido",
  BALANCE_DATE_BEFORE_DEPOSIT_DATE: "Fechas inversas",
};

function WarningTag({ code }: { code: string }) {
  return (
    <Badge color="rose" size="xs">
      {WARNING_LABELS[code] ?? code}
    </Badge>
  );
}

// ─── Items detail sub-table ───────────────────────────────────────────────────

function ItemsDetailTable({ items }: { items: ItemPreviewDTO[] }) {
  if (items.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-slate-500">
        Sin productos para mostrar.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto border-t border-slate-100 bg-slate-50">
      <Table className="min-w-[700px]">
        <TableHead>
          <TableRow className="bg-slate-100">
            <TableHeaderCell>SKU</TableHeaderCell>
            <TableHeaderCell>Producto</TableHeaderCell>
            <TableHeaderCell className="text-right">Cantidad</TableHeaderCell>
            <TableHeaderCell className="text-right">CBM total</TableHeaderCell>
            <TableHeaderCell className="text-right">Coste línea</TableHeaderCell>
            <TableHeaderCell>Estado</TableHeaderCell>
            <TableHeaderCell className="text-right">Retraso (días)</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item, idx) => (
            <TableRow key={`${item.sku}-${String(idx)}`} className="bg-white">
              <TableCell className="font-mono text-xs">{item.sku}</TableCell>
              <TableCell className="max-w-[200px]">
                <span className="line-clamp-2 text-sm" title={item.productName}>
                  {item.productName ?? "—"}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(item.quantity)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(item.cbmTotal, 4)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(item.lineCostEur)}
              </TableCell>
              <TableCell>
                <TimingBadge status={item.orderTimingStatus} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {item.daysLate > 0 ? formatNumber(item.daysLate) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Expanded detail panel ────────────────────────────────────────────────────

function DetailPanel({
  draft,
  rowError,
}: {
  draft: DraftPreviewDTO;
  rowError: string | undefined;
}) {
  return (
    <TableRow>
      <TableCell colSpan={15} className="p-0">
        <div className="border-l-4 border-sky-300">
          {draft.warnings.length > 0 && (
            <div className="flex flex-wrap items-start gap-2 bg-amber-50 px-4 py-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              {draft.warnings.map((w, wi) => (
                <div key={`w-${String(wi)}`} className="flex items-center gap-1.5">
                  <WarningTag code={w.code} />
                  <span className="text-xs text-amber-800">{w.message}</span>
                </div>
              ))}
            </div>
          )}
          {rowError && (
            <div className="flex items-center gap-2 bg-rose-50 px-4 py-2 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {rowError}
            </div>
          )}
          <ItemsDetailTable items={draft.itemsPreview} />
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PedidosSugeridosPage() {
  const [filters, setFilters] = useState<PreviewFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<{
    stats: StatsDTO;
    summary: SummaryDTO;
    drafts: DraftPreviewDTO[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Map<string, string>>(new Map());
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const previewUrl = useMemo(() => buildPreviewUrl(filters), [filters]);

  // ── Load preview ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRowErrors(new Map());
    try {
      const res = await fetch(previewUrl);
      const json = (await res.json()) as PreviewResponse;
      if (!res.ok || !json.ok) {
        setData(null);
        setError(json.ok === false ? json.error : `Error HTTP ${res.status}`);
        return;
      }
      setData({ stats: json.stats, summary: json.summary, drafts: json.drafts });
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "No se pudo cargar el preview.");
    } finally {
      setLoading(false);
    }
  }, [previewUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Create order ──────────────────────────────────────────────────────────

  const handleCreate = useCallback(
    async (groupKey: string) => {
      setCreatingKey(groupKey);
      setRowErrors((prev) => {
        const next = new Map(prev);
        next.delete(groupKey);
        return next;
      });
      try {
        const res = await fetch("/api/orders/create-from-planner", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            groupKey,
            scenario: filters.scenario,
            windowDays: filters.windowDays,
            horizonMonths: filters.horizonMonths,
            country: "ALL",
            channel: "ALL",
            includeNewProducts: filters.includeNewProducts,
          }),
        });
        const json = (await res.json()) as CreateResponse;
        if (!res.ok || !json.ok) {
          setRowErrors((prev) =>
            new Map(prev).set(
              groupKey,
              json.ok === false ? json.error : `Error HTTP ${res.status}`,
            ),
          );
          return;
        }
        const numeroOrden = json.orden.numero_orden;
        const msg = numeroOrden ? `Orden creada: ${numeroOrden}` : "Orden creada correctamente.";
        setSuccessMsg(msg);
        if (successTimer.current) clearTimeout(successTimer.current);
        successTimer.current = setTimeout(() => setSuccessMsg(null), 6000);
        void load();
      } catch (e) {
        setRowErrors((prev) =>
          new Map(prev).set(
            groupKey,
            e instanceof Error ? e.message : "Error al crear la orden.",
          ),
        );
      } finally {
        setCreatingKey(null);
      }
    },
    [filters, load],
  );

  // ── Toggle row ────────────────────────────────────────────────────────────

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const drafts = data?.drafts ?? [];
  const summary = data?.summary;
  const stats = data?.stats;

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">

      {/* Header + filters */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Title>Pedidos sugeridos</Title>
          <Text className="mt-1 text-slate-600">
            Grupos de compra recomendados por el planner. Revisa cada grupo y
            crea la orden en borrador cuando estés listo.
          </Text>
        </div>

        <Flex className="w-full flex-col gap-3 lg:w-auto lg:flex-row lg:items-end">
          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-row lg:flex-wrap lg:gap-3">
            <div className="min-w-[9rem]">
              <Text className="mb-1 text-xs text-slate-500">Escenario</Text>
              <Select
                value={filters.scenario}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, scenario: v as PreviewFilters["scenario"] }))
                }
                disabled={loading}
              >
                <SelectItem value="conservative">Conservador</SelectItem>
                <SelectItem value="base">Base</SelectItem>
                <SelectItem value="optimistic">Optimista</SelectItem>
              </Select>
            </div>

            <div className="min-w-[9rem]">
              <Text className="mb-1 text-xs text-slate-500">Ventana (días)</Text>
              <Select
                value={String(filters.windowDays)}
                onValueChange={(v) =>
                  setFilters((f) => ({
                    ...f,
                    windowDays: Number(v) as PreviewFilters["windowDays"],
                  }))
                }
                disabled={loading}
              >
                <SelectItem value="30">30</SelectItem>
                <SelectItem value="60">60</SelectItem>
                <SelectItem value="90">90</SelectItem>
                <SelectItem value="180">180</SelectItem>
              </Select>
            </div>

            <div className="min-w-[9rem]">
              <Text className="mb-1 text-xs text-slate-500">Horizonte (meses)</Text>
              <Select
                value={String(filters.horizonMonths)}
                onValueChange={(v) =>
                  setFilters((f) => ({
                    ...f,
                    horizonMonths: Number(v) as PreviewFilters["horizonMonths"],
                  }))
                }
                disabled={loading}
              >
                <SelectItem value="6">6</SelectItem>
                <SelectItem value="12">12</SelectItem>
                <SelectItem value="18">18</SelectItem>
                <SelectItem value="24">24</SelectItem>
              </Select>
            </div>

            <label className="flex min-h-[42px] cursor-pointer items-center gap-2 rounded-tremor-default border border-tremor-border bg-white px-3 py-2 text-sm text-tremor-content-strong shadow-tremor-input">
              <input
                type="checkbox"
                checked={filters.includeNewProducts}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, includeNewProducts: e.target.checked }))
                }
                disabled={loading}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>Incluir nuevos</span>
            </label>
          </div>

          <Button
            variant="secondary"
            icon={RefreshCw}
            onClick={() => void load()}
            loading={loading}
            className="shrink-0"
          >
            Actualizar
          </Button>
        </Flex>
      </div>

      {/* Success */}
      {successMsg !== null && (
        <Callout title="Orden creada" icon={CheckCircle2} color="emerald">
          {successMsg}
        </Callout>
      )}

      {/* Error */}
      {error !== null && (
        <Callout title="Error al cargar el preview" icon={AlertCircle} color="rose">
          {error}
        </Callout>
      )}

      {/* KPI cards */}
      <Grid numItems={2} numItemsSm={3} numItemsLg={4} className="gap-4">
        <Card className="ring-1 ring-slate-100">
          <Flex justifyContent="start" className="space-x-3">
            <div className="rounded-tremor-small bg-sky-50 p-2">
              <Layers className="h-5 w-5 text-sky-700" />
            </div>
            <div>
              <Text>Grupos sugeridos</Text>
              <Metric className="mt-1">
                {loading ? "—" : formatNumber(summary?.totalGroups)}
              </Metric>
            </div>
          </Flex>
        </Card>

        <Card className="ring-1 ring-slate-100">
          <Flex justifyContent="start" className="space-x-3">
            <div className="rounded-tremor-small bg-violet-50 p-2">
              <Package className="h-5 w-5 text-violet-700" />
            </div>
            <div>
              <Text>Líneas totales</Text>
              <Metric className="mt-1">
                {loading ? "—" : formatNumber(summary?.totalLines)}
              </Metric>
            </div>
          </Flex>
        </Card>

        <Card className="ring-1 ring-slate-100">
          <Flex justifyContent="start" className="space-x-3">
            <div className="rounded-tremor-small bg-indigo-50 p-2">
              <ShoppingCart className="h-5 w-5 text-indigo-700" />
            </div>
            <div>
              <Text>Unidades totales</Text>
              <Metric className="mt-1">
                {loading ? "—" : formatNumber(summary?.totalUnits)}
              </Metric>
            </div>
          </Flex>
        </Card>

        <Card className="ring-1 ring-slate-100">
          <Flex justifyContent="start" className="space-x-3">
            <div className="rounded-tremor-small bg-cyan-50 p-2">
              <Truck className="h-5 w-5 text-cyan-700" />
            </div>
            <div>
              <Text>CBM total</Text>
              <Metric className="mt-1">
                {loading ? "—" : formatNumber(summary?.totalCbm, 2)}
              </Metric>
            </div>
          </Flex>
        </Card>

        <Card className="ring-1 ring-slate-100">
          <Flex justifyContent="start" className="space-x-3">
            <div className="rounded-tremor-small bg-emerald-50 p-2">
              <Euro className="h-5 w-5 text-emerald-700" />
            </div>
            <div>
              <Text>Capital compra</Text>
              <Metric className="mt-1 text-base sm:text-xl">
                {loading ? "—" : formatCurrency(summary?.totalPurchaseCapitalRequired)}
              </Metric>
            </div>
          </Flex>
        </Card>

        <Card className="ring-1 ring-slate-100">
          <Flex justifyContent="start" className="space-x-3">
            <div className="rounded-tremor-small bg-rose-50 p-2">
              <Clock className="h-5 w-5 text-rose-700" />
            </div>
            <div>
              <Text>Grupos retrasados</Text>
              <Metric className="mt-1">
                {loading ? "—" : formatNumber(summary?.groupsOverdue)}
              </Metric>
            </div>
          </Flex>
        </Card>

        <Card className="ring-1 ring-slate-100">
          <Flex justifyContent="start" className="space-x-3">
            <div className="rounded-tremor-small bg-amber-50 p-2">
              <AlertTriangle className="h-5 w-5 text-amber-700" />
            </div>
            <div>
              <Text>Grupos urgentes</Text>
              <Metric className="mt-1">
                {loading ? "—" : formatNumber(summary?.groupsDueNow)}
              </Metric>
            </div>
          </Flex>
        </Card>

        <Card className="ring-1 ring-slate-100">
          <Flex justifyContent="start" className="space-x-3">
            <div className="rounded-tremor-small bg-slate-100 p-2">
              <Banknote className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <Text>Datos incompletos</Text>
              <Metric className="mt-1">
                {loading ? "—" : formatNumber(summary?.groupsWithIncompleteData)}
              </Metric>
            </div>
          </Flex>
        </Card>
      </Grid>

      {/* Drafts table */}
      <Card className="overflow-hidden ring-1 ring-slate-100">
        <div className="border-b border-tremor-border px-4 py-3">
          <Title className="text-base">Grupos de pedido sugeridos</Title>
          {loading ? (
            <Flex className="mt-1 gap-2" justifyContent="start">
              <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
              <Text>Analizando planner…</Text>
            </Flex>
          ) : (
            <Text className="mt-0.5">
              {drafts.length} grupo{drafts.length !== 1 ? "s" : ""}
              {stats !== undefined
                ? ` · ${formatNumber(stats.annualProductsToOrder)} productos a pedir`
                : ""}
            </Text>
          )}
        </div>

        {!loading && error === null && drafts.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Package className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            <Text className="text-slate-500">
              No hay grupos de compra con los filtros actuales. Prueba otros
              parámetros o amplía el horizonte.
            </Text>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[1400px]">
              <TableHead>
                <TableRow>
                  <TableHeaderCell className="w-8" />
                  <TableHeaderCell>Estado</TableHeaderCell>
                  <TableHeaderCell>Proveedor</TableHeaderCell>
                  <TableHeaderCell>Agente</TableHeaderCell>
                  <TableHeaderCell>Puerto origen</TableHeaderCell>
                  <TableHeaderCell className="text-right">Productos</TableHeaderCell>
                  <TableHeaderCell className="text-right">Unidades</TableHeaderCell>
                  <TableHeaderCell className="text-right">CBM</TableHeaderCell>
                  <TableHeaderCell className="text-right">Capital compra</TableHeaderCell>
                  <TableHeaderCell className="text-right">Depósito est.</TableHeaderCell>
                  <TableHeaderCell className="text-right">Balance est.</TableHeaderCell>
                  <TableHeaderCell>F. pedido mín.</TableHeaderCell>
                  <TableHeaderCell>F. pedido máx.</TableHeaderCell>
                  <TableHeaderCell>Listo</TableHeaderCell>
                  <TableHeaderCell>Acción</TableHeaderCell>
                </TableRow>
              </TableHead>

              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={15}>
                      <Flex justifyContent="center" className="gap-2 py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                        <Text>Cargando grupos…</Text>
                      </Flex>
                    </TableCell>
                  </TableRow>
                ) : (
                  drafts.map((draft) => {
                    const isExpanded = expandedKeys.has(draft.groupKey);
                    const isCreating = creatingKey === draft.groupKey;
                    const rowError = rowErrors.get(draft.groupKey);

                    return (
                      <React.Fragment key={draft.groupKey}>
                        <TableRow>
                          {/* Expand toggle */}
                          <TableCell className="pr-0">
                            <button
                              type="button"
                              onClick={() => toggleExpand(draft.groupKey)}
                              className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                              aria-label={isExpanded ? "Colapsar detalle" : "Expandir detalle"}
                            >
                              {isExpanded
                                ? <ChevronDown className="h-4 w-4" />
                                : <ChevronRight className="h-4 w-4" />
                              }
                            </button>
                          </TableCell>

                          {/* Status */}
                          <TableCell>
                            <TimingBadge status={draft.orderTimingStatus} />
                          </TableCell>

                          {/* Supplier */}
                          <TableCell className="max-w-[180px]">
                            {draft.supplierName !== null ? (
                              <span className="line-clamp-2 font-medium" title={draft.supplierName}>
                                {draft.supplierName}
                              </span>
                            ) : (
                              <span className="italic text-rose-500">Sin proveedor</span>
                            )}
                          </TableCell>

                          {/* Agent */}
                          <TableCell className="max-w-[140px]">
                            <span className="line-clamp-1 text-slate-600">
                              {draft.agentName ?? "—"}
                            </span>
                          </TableCell>

                          {/* Port */}
                          <TableCell className="font-mono text-xs">
                            {draft.originPortId ?? <span className="italic text-slate-400">—</span>}
                          </TableCell>

                          {/* Numeric cells */}
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(draft.productCount)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(draft.totalUnits)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(draft.totalCbm, 2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(draft.totalPurchaseCapitalRequired)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sky-700">
                            {formatCurrency(draft.estimatedDepositAmount)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-indigo-700">
                            {formatCurrency(draft.estimatedBalanceAmount)}
                          </TableCell>

                          {/* Dates */}
                          <TableCell className="whitespace-nowrap">
                            {formatDateUtc(draft.earliestOrderDate)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatDateUtc(draft.latestOrderDate)}
                          </TableCell>

                          {/* Ready */}
                          <TableCell>
                            <ReadyBadge ready={draft.isReadyToSubmit} />
                          </TableCell>

                          {/* Action */}
                          <TableCell>
                            <Button
                              size="xs"
                              color="sky"
                              icon={ShoppingCart}
                              disabled={
                                !draft.isReadyToSubmit ||
                                creatingKey !== null
                              }
                              loading={isCreating}
                              onClick={() => void handleCreate(draft.groupKey)}
                            >
                              Crear borrador
                            </Button>
                          </TableCell>
                        </TableRow>

                        {/* Expanded detail panel */}
                        {isExpanded && (
                          <DetailPanel draft={draft} rowError={rowError} />
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

    </div>
  );
}
