/**
 * GET /api/orders/planner-preview
 *
 * Read-only preview of what orders would be created from the current
 * AnnualPurchasePlan. Designed to feed the "Pedidos desde planner" dashboard
 * view where the user reviews DraftOrderGroups and picks which one to convert.
 *
 * No DB writes. No order creation. Pure projection.
 *
 * Query params (all optional — defaults below):
 *   scenario          conservative | base | optimistic   (default: base)
 *   windowDays        1–365                              (default: 90)
 *   horizonMonths     1–24                               (default: 12)
 *   country           ISO code or ALL                    (default: ALL)
 *   channel           AMAZON_FBA | AMAZON_FBM | ALL      (default: ALL)
 *   includeNewProducts true | false                      (default: true)
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { analyzeProducts } from "@/modules/planner/services/analyzeProducts";
import { createDraftOrdersFromAnnualPlan } from "@/modules/orders/services/createDraftOrdersFromAnnualPlan";
import { createOrderDraftFromGroup } from "@/modules/orders/services/createOrderDraftFromGroup";
import type { PlannerParams } from "@/modules/planner/types/planner.types";
import type { OrderDraftWarning } from "@/modules/orders/types/order.types";
import type { DraftOrderGroup } from "@/modules/orders/types";

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PARAMS = {
  windowDays: 90,
  horizonMonths: 12,
  scenario: "base" as const,
  country: "ALL",
  channel: "ALL" as const,
  includeNewProducts: true,
} satisfies PlannerParams;

// TODO: Replace with real supplier lookup once suppliers module is implemented.
const DEFAULT_PAYMENT = {
  depositPercentage: 30,
  balanceDaysBeforeArrival: 10,
  balanceConditionsText:
    "The balance will be paid 10 days before the vessel arrives at the port",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Query param validation
// ─────────────────────────────────────────────────────────────────────────────

const VALID_SCENARIOS = new Set<PlannerParams["scenario"]>([
  "conservative",
  "base",
  "optimistic",
]);

const VALID_CHANNELS = new Set<PlannerParams["channel"]>([
  "AMAZON_FBA",
  "AMAZON_FBM",
  "ALL",
]);

type ParseQueryResult =
  | { ok: true; params: PlannerParams }
  | { ok: false; error: string };

function parseOptionalInt(
  raw: string | null,
  label: string,
  min: number,
  max: number,
): { value?: number; error?: string } {
  if (raw === null || raw === "") return {};
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    return { error: `${label} debe ser un entero entre ${min} y ${max}.` };
  }
  return { value: n };
}

function parseQueryParams(url: URL): ParseQueryResult {
  const params: PlannerParams = { ...DEFAULT_PARAMS };

  const wd = parseOptionalInt(url.searchParams.get("windowDays"), "windowDays", 1, 365);
  if (wd.error) return { ok: false, error: wd.error };
  if (wd.value !== undefined) params.windowDays = wd.value;

  const hm = parseOptionalInt(url.searchParams.get("horizonMonths"), "horizonMonths", 1, 24);
  if (hm.error) return { ok: false, error: hm.error };
  if (hm.value !== undefined) params.horizonMonths = hm.value;

  const scenarioRaw = url.searchParams.get("scenario")?.trim();
  if (scenarioRaw) {
    if (!VALID_SCENARIOS.has(scenarioRaw as PlannerParams["scenario"])) {
      return { ok: false, error: "scenario inválido. Use: conservative | base | optimistic." };
    }
    params.scenario = scenarioRaw as PlannerParams["scenario"];
  }

  const country = url.searchParams.get("country")?.trim();
  if (country) params.country = country;

  const channelRaw = url.searchParams.get("channel")?.trim();
  if (channelRaw) {
    if (!VALID_CHANNELS.has(channelRaw as PlannerParams["channel"])) {
      return { ok: false, error: "channel inválido. Use: AMAZON_FBA | AMAZON_FBM | ALL." };
    }
    params.channel = channelRaw as PlannerParams["channel"];
  }

  const incRaw = url.searchParams.get("includeNewProducts");
  if (incRaw !== null && incRaw !== "") {
    if (incRaw !== "true" && incRaw !== "false") {
      return { ok: false, error: "includeNewProducts debe ser true o false." };
    }
    params.includeNewProducts = incRaw === "true";
  }

  return { ok: true, params };
}

// ─────────────────────────────────────────────────────────────────────────────
// Response shape
// ─────────────────────────────────────────────────────────────────────────────

type ItemPreview = {
  sku: string;
  productName: string | undefined;
  quantity: number;
  cbmTotal: number | null;
  lineCostEur: number | null;
  orderTimingStatus: "ON_TIME" | "DUE_NOW" | "OVERDUE";
  daysLate: number;
};

type DraftPreview = {
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
  orderTimingStatus: DraftOrderGroup["orderTimingStatus"];
  isReadyToSubmit: boolean;
  warnings: OrderDraftWarning[];
  itemsPreview: ItemPreview[];
};

function buildDraftPreview(group: DraftOrderGroup): DraftPreview {
  const draft = createOrderDraftFromGroup(group, DEFAULT_PAYMENT);

  const itemsPreview: ItemPreview[] = draft.items.map((item) => ({
    sku: item.sku,
    productName: item.productName,
    quantity: item.quantity,
    cbmTotal: item.cbmTotal,
    lineCostEur: item.lineCostEur,
    orderTimingStatus: item.orderTimingStatus,
    daysLate: item.daysLate,
  }));

  return {
    groupKey: group.groupKey,
    supplierName: group.supplierName,
    agentName: group.agentName,
    originPortId: group.originPortId,
    productCount: group.productCount,
    totalUnits: group.totalUnits,
    totalCbm: group.totalCbm,
    totalWeightKg: group.totalWeightKg,
    totalPurchaseCapitalRequired: group.totalPurchaseCapitalRequired,
    estimatedDepositAmount: draft.estimatedDepositAmount,
    estimatedBalanceAmount: draft.estimatedBalanceAmount,
    earliestOrderDate: group.earliestOrderDate,
    latestOrderDate: group.latestOrderDate,
    orderTimingStatus: group.orderTimingStatus,
    isReadyToSubmit: draft.isReadyToSubmit,
    warnings: draft.warnings,
    itemsPreview,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { ok: false, error: "No autorizado." },
      { status: 401 },
    );
  }

  // ── 2. Parse query params ─────────────────────────────────────────────────
  const url = new URL(req.url);
  const parsed = parseQueryParams(url);
  if (!parsed.ok) {
    const { error } = parsed as Extract<ParseQueryResult, { ok: false }>;
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }

  const { params } = parsed as Extract<ParseQueryResult, { ok: true }>;

  // ── 3. Run planner analysis ───────────────────────────────────────────────
  let plannerResult: Awaited<ReturnType<typeof analyzeProducts>>;
  try {
    plannerResult = await analyzeProducts(params);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Error al ejecutar el análisis del planner.",
      },
      { status: 500 },
    );
  }

  // ── 4. Build draft groups ─────────────────────────────────────────────────
  const { groups, summary } = createDraftOrdersFromAnnualPlan(
    plannerResult.annualPurchasePlan,
  );

  // ── 5. Build draft previews (no DB writes) ────────────────────────────────
  const drafts: DraftPreview[] = groups.map(buildDraftPreview);

  // ── 6. Return preview ─────────────────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    stats: plannerResult.stats,
    summary,
    groups,
    drafts,
  });
}
