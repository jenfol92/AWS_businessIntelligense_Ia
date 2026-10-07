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
  currentStock: number;
  inboundConfirmed: number;
  inboundProvisional: number;
  existingInboundDestinations: string[];
  recommendedDestination: string;
  monthlyForecastUnits: number[];
  monthlyInboundUnits: number[];
  moqApplied: boolean;
  forecastMethod: "HISTORICAL_SIMPLE" | "NO_HISTORY" | "NEW_PRODUCT_BENCHMARK";
  monthlyInboundDetails: Array<{
    eta: string;
    units: number;
    orderId: string | null;
    orderNumber: string | null;
    country: string | null;
    channel: string;
    confidence: "confirmed" | "provisional";
  }>;
};

type PlannerStats = {
  annualProductsToOrder: number;
  totalPurchaseCapitalRequired: number;
  annualRecommendedCbm: number;
  suggestedContainerGroups: number;
  goodCandidateGroups: number;
  earliestCriticalDate: string | null;
  dueThisWeekLines?: number;
  capitalAlreadyCommitted?: number;
};

type PlannerFundingSummary={
  purchaseCapitalRequired:number;
  capitalAlreadyCommitted:number;
  operatingCashAvailableAboveReserveEur:number;
  totalCreditAvailableEur:number;
  amazonExpectedEur:number;
  immediateFundingCapacityEur:number;
  capacityIncludingExpectedAmazonEur:number;
  uncoveredImmediateNeedEur:number;
  surplusAfterCorePurchasesEur:number;
  suggestedNewProductBudgetEur:number;
  fundingStatus:"COVERED"|"CREDIT_REQUIRED"|"FUNDING_GAP";
};

type PlannerSummarySuccess = {
  ok: true;
  stats: PlannerStats;
  annualPurchasePlan: { lines: EnrichedLine[] };
  purchasePlan: { containerGroups: ContainerOptimizationGroup[] };
  funding: PlannerFundingSummary | null;
  fundingWarning?: string | null;
  annualChart: {
    investmentQuarter: string | null;
    months: Array<{
      monthIndex: number;
      yearMonth: string;
      confirmedInboundUnits: number;
      confirmedInboundRetailValueEur: number;
      inboundValueIncomplete: boolean;
      replenishmentUnits: number;
      replenishmentCostEur: number;
      newProductInvestmentBudgetEur: number;
      inboundItems: Array<{ productId:string; sku:string; productName:string; units:number; retailValueEur:number|null; eta:string; orderId:string|null; orderNumber:string|null; country:string|null }>;
      replenishmentItems: Array<{ productId:string; sku:string; productName:string; units:number; orderDate:string; estimatedArrivalDate:string|null; destination:string; purchaseCostEur:number|null; logisticsCalendarRisk:boolean; warnings:string[] }>;
    }>;
  };
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
  const [selectedPlanMonth, setSelectedPlanMonth] = useState<number | null>(null);
  const monthlyPlan = data?.annualChart.months ?? [];
  const monthlyUnitsMax=Math.max(1,...monthlyPlan.flatMap(month=>[month.replenishmentUnits,month.confirmedInboundUnits]));
  const monthlyInvestmentMax=Math.max(1,...monthlyPlan.map(month=>month.newProductInvestmentBudgetEur));
  const selectedMonth=selectedPlanMonth==null?null:monthlyPlan[selectedPlanMonth];

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

      {data?.funding ? (
        <Card className="ring-1 ring-slate-200 p-4">
          <Flex justifyContent="between" alignItems="start" className="gap-3 flex-wrap">
            <div>
              <Title className="text-base">Capacidad para ejecutar el plan</Title>
              <Text className="mt-1 text-slate-600">La caja disponible ya excluye la reserva operativa. Las órdenes existentes sin llegada se mantienen como capital comprometido y como inbound del cálculo de la próxima fecha.</Text>
            </div>
            <Badge color={data.funding.fundingStatus==="COVERED"?"emerald":data.funding.fundingStatus==="CREDIT_REQUIRED"?"amber":"rose"}>
              {data.funding.fundingStatus==="COVERED"?"Cubierto con caja":data.funding.fundingStatus==="CREDIT_REQUIRED"?"Necesita crédito":"Falta financiación"}
            </Badge>
          </Flex>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <div><Text className="text-xs">Compras recomendadas</Text><p className="font-semibold text-slate-900">{formatEur(data.funding.purchaseCapitalRequired)}</p></div>
            <div><Text className="text-xs">Ya comprometido</Text><p className="font-semibold text-slate-900">{formatEur(data.funding.capitalAlreadyCommitted)}</p></div>
            <div><Text className="text-xs">Caja sobre reserva</Text><p className="font-semibold text-emerald-700">{formatEur(data.funding.operatingCashAvailableAboveReserveEur)}</p></div>
            <div><Text className="text-xs">Crédito disponible</Text><p className="font-semibold text-indigo-700">{formatEur(data.funding.totalCreditAvailableEur)}</p></div>
            <div><Text className="text-xs">Cobros Amazon previstos</Text><p className="font-semibold text-sky-700">{formatEur(data.funding.amazonExpectedEur)}</p></div>
            <div><Text className="text-xs">Necesidad no cubierta hoy</Text><p className="font-semibold text-rose-700">{formatEur(data.funding.uncoveredImmediateNeedEur)}</p></div>
            <div><Text className="text-xs">Pruebas producto nuevo</Text><p className="font-semibold text-violet-700">{formatEur(data.funding.suggestedNewProductBudgetEur)}</p></div>
          </div>
        </Card>
      ):data?.fundingWarning?<Callout title="Capacidad financiera no disponible" color="amber">El plan de unidades continúa visible, pero la validación de caja y crédito necesita revisión.</Callout>:null}

      {monthlyPlan.length>0?(
        <Card className="ring-1 ring-slate-200 p-4">
          <Flex justifyContent="between" className="gap-3 flex-wrap"><div><Title className="text-base">Plan anual de reposición e inversión</Title><Text className="mt-1 text-slate-600">Haz clic en un mes para auditar cada producto, orden y fecha.</Text></div><div className="flex flex-wrap gap-3 text-xs text-slate-600"><span><i className="inline-block h-2 w-2 rounded-sm bg-blue-600 mr-1"/>Reposición necesaria (uds)</span><span><i className="inline-block h-2 w-2 rounded-sm bg-emerald-500 mr-1"/>Inbound confirmado (uds)</span><span><i className="inline-block h-2 w-2 rounded-sm bg-violet-500 mr-1"/>Nuevos productos (€)</span></div></Flex>
          <Callout title="Qué significa cada barra" color="slate" className="mt-3">
            <strong>Reposición</strong> es lo que habría que pedir en ese mes después de proyectar ventas, stock disponible, inbound confirmado por ETA, cobertura, lead time, stock de seguridad, MOQ, cajas y cubicaje. Los periodos de <code>logistics_calendar</code> amplían el lead time y se señalan como riesgo. <strong>Inbound</strong> sólo incluye órdenes confirmadas y muestra también su valor potencial de venta. <strong>Nuevos productos</strong> es presupuesto de inversión, no unidades ni órdenes creadas, reservado en meses sin reposición del primer trimestre disponible.
          </Callout>
          <div className="mt-4 grid grid-cols-6 gap-2 md:grid-cols-12" aria-label="Gráfica anual de reposición, inbound confirmado e inversión en nuevos productos">
            {monthlyPlan.map(month=>{const date=new Date(`${month.yearMonth}-01T00:00:00Z`);return <button type="button" key={month.yearMonth} onClick={()=>setSelectedPlanMonth(month.monthIndex)} className={`min-w-0 rounded p-1 text-left hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 ${selectedPlanMonth===month.monthIndex?"bg-blue-50 ring-2 ring-blue-500":""}`} aria-label={`Ver detalle de ${month.yearMonth}`}><div className="mb-1 space-y-0.5 text-center text-[9px] leading-tight"><p className="font-semibold text-blue-700">{formatNum(month.replenishmentUnits)} u</p><p className="font-semibold text-emerald-700">{formatNum(month.confirmedInboundUnits)} u</p><p className="font-semibold text-violet-700">{formatEur(month.newProductInvestmentBudgetEur)}</p></div><div className="flex h-28 items-end justify-center gap-0.5 rounded bg-slate-50 px-1"><span className="w-1/3 bg-blue-600" style={{height:`${month.replenishmentUnits===0?0:Math.max(2,month.replenishmentUnits/monthlyUnitsMax*100)}%`}}/><span className="w-1/3 bg-emerald-500" style={{height:`${month.confirmedInboundUnits===0?0:Math.max(2,month.confirmedInboundUnits/monthlyUnitsMax*100)}%`}}/><span className="w-1/3 bg-violet-500" style={{height:`${month.newProductInvestmentBudgetEur===0?0:Math.max(2,month.newProductInvestmentBudgetEur/monthlyInvestmentMax*100)}%`}}/></div><p className="mt-1 text-center text-[10px] text-slate-500">{new Intl.DateTimeFormat("es-ES",{month:"short",year:"2-digit",timeZone:"UTC"}).format(date)}</p></button>})}
          </div>
          {selectedMonth?(
            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
              <Flex justifyContent="between"><Title className="text-sm">Detalle de {new Intl.DateTimeFormat("es-ES",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${selectedMonth.yearMonth}-01T00:00:00Z`))}</Title><button type="button" onClick={()=>setSelectedPlanMonth(null)} aria-label="Cerrar detalle"><X className="h-4 w-4 text-slate-500"/></button></Flex>
              <div className="mt-3 grid gap-4 lg:grid-cols-3">
                <div><p className="font-semibold text-blue-700">Reposición · {formatNum(selectedMonth.replenishmentUnits)} uds · {formatEur(selectedMonth.replenishmentCostEur)}</p><div className="mt-2 max-h-52 space-y-2 overflow-auto">{selectedMonth.replenishmentItems.length?selectedMonth.replenishmentItems.map(item=><div key={item.productId} className="rounded bg-blue-50 p-2 text-xs"><p className="font-medium text-slate-800">{item.productName} · {formatNum(item.units)} uds</p><p className="text-slate-600">Pedir {formatDate(item.orderDate)} · llegada {formatDate(item.estimatedArrivalDate)}</p><p className="text-slate-500">Destino: {item.destination} · {formatEur(item.purchaseCostEur)}</p>{item.logisticsCalendarRisk?<p className="mt-1 font-semibold text-amber-700">Fecha afectada por logistics_calendar</p>:null}</div>):<Text>Este mes no necesita reposición.</Text>}</div></div>
                <div><p className="font-semibold text-emerald-700">Inbound confirmado · {formatNum(selectedMonth.confirmedInboundUnits)} uds · {formatEur(selectedMonth.confirmedInboundRetailValueEur)}{selectedMonth.inboundValueIncomplete?" + valor pendiente":""}</p><div className="mt-2 max-h-52 space-y-2 overflow-auto">{selectedMonth.inboundItems.length?selectedMonth.inboundItems.map((item,index)=><div key={`${item.productId}-${item.orderId}-${item.eta}-${index}`} className="rounded bg-emerald-50 p-2 text-xs"><p className="font-medium text-slate-800">{item.productName} · {formatNum(item.units)} uds · {formatEur(item.retailValueEur)}</p><p className="text-slate-600">Orden {item.orderNumber??item.orderId??"sin número"} · ETA {formatDate(item.eta)}</p><p className="text-slate-500">Destino: {item.country??"pendiente"}</p></div>):<Text>Sin órdenes confirmadas con ETA este mes.</Text>}</div></div>
                <div><p className="font-semibold text-violet-700">Nuevos productos · {formatEur(selectedMonth.newProductInvestmentBudgetEur)}</p><div className="mt-2 rounded bg-violet-50 p-3 text-xs text-slate-600">{selectedMonth.newProductInvestmentBudgetEur>0?<>Presupuesto disponible para validar nuevos productos. Se reserva en {data?.annualChart.investmentQuarter??"el trimestre seleccionado"} y no representa una orden hasta aprobar productos, MOQ y rentabilidad.</>:<>No se asigna inversión este mes porque hay reposición prevista o está fuera del trimestre de inversión.</>}</div></div>
              </div>
            </div>
          ):null}
        </Card>
      ):null}

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
                      <span>Stock: {formatNum(row.currentStock)} uds</span>
                      <span>Inbound: {formatNum(row.inboundConfirmed)} uds</span>
                      <span>{formatNum(row.recommendedOrderUnits)} uds{row.moqApplied?<small className="block text-amber-700">MOQ mínimo aplicado</small>:null}</span>
                      <span>{formatNum(row.cbmTotal, 2)} m³</span>
                      <span>{formatEur(row.purchaseCapitalRequired)}</span>
                      <span>Puerto fábrica: {formatFactoryPort(row)}</span>
                      <span>Destino: {row.recommendedDestination}</span>
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
                    <th className="px-3 py-2 text-right">Stock</th>
                    <th className="px-3 py-2 text-right">Inbound</th>
                    <th className="px-3 py-2 text-right">Cant.</th>
                    <th className="px-3 py-2 text-right">CBM</th>
                    <th className="px-3 py-2 text-right">Capital</th>
                    <th className="px-3 py-2 text-left">Puerto fábrica</th>
                    <th className="px-3 py-2 text-left">Destino</th>
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
                          <td className="px-3 py-2 text-right"><span className="font-medium">{formatNum(row.currentStock)}</span><span className="block text-[10px] text-slate-400">actual</span></td>
                          <td className="px-3 py-2 text-right"><span className="font-medium text-emerald-700">{formatNum(row.inboundConfirmed)}</span>{row.inboundProvisional>0?<span className="block text-[10px] text-amber-600">+{formatNum(row.inboundProvisional)} provisional</span>:null}{row.existingInboundDestinations.length?<span className="block text-[10px] text-slate-400">{row.existingInboundDestinations.join(" + ")}</span>:null}</td>
                          <td className="px-3 py-2 text-right"><span className="font-medium">{formatNum(row.recommendedOrderUnits)}</span>{row.moqApplied?<span className="block text-[10px] font-medium text-amber-700">MOQ mín. 100</span>:null}</td>
                          <td className="px-3 py-2 text-right">{formatNum(row.cbmTotal, 2)}</td>
                          <td className="px-3 py-2 text-right">{formatEur(row.purchaseCapitalRequired)}</td>
                          <td className="px-3 py-2 text-slate-800">
                            {formatFactoryPort(row)}
                          </td>
                          <td className="px-3 py-2 text-slate-800 max-w-[150px]">{row.recommendedDestination}</td>
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
                            <td colSpan={15} className="px-4 py-3 bg-blue-50/50">
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
