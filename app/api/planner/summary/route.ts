import { NextResponse } from "next/server";
import { analyzeProducts } from "@/modules/planner/services/analyzeProducts";
import { enrichPlannerSummary } from "@/modules/planner/services/enrichPlannerSummary";
import { buildPlannerFundingSummary } from "@/modules/planner/services/buildPlannerFundingSummary";
import { buildPlannerAnnualChart } from "@/modules/planner/services/buildPlannerAnnualChart";
import { buildFinancialPlanning } from "@/modules/finance/services/buildFinancialPlanning";
import { fetchAgentsMap } from "@/modules/planner/repositories/plannerRepository";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { PlannerParams } from "@/modules/planner/types/planner.types";

const SCENARIOS = new Set<PlannerParams["scenario"]>([
  "conservative",
  "base",
  "optimistic",
]);

const CHANNELS = new Set<PlannerParams["channel"]>([
  "AMAZON_FBA",
  "AMAZON_FBM",
  "ALL",
]);

type ParseResult =
  | { ok: true; params: PlannerParams }
  | { ok: false; error: string };

function parseOptionalInt(
  raw: string | null,
  label: string,
  min: number,
  max: number,
): { value?: number; error?: string } {
  if (raw === null || raw === "") {
    return {};
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    return {
      error: `${label} debe ser un entero entre ${min} y ${max}.`,
    };
  }
  return { value: n };
}

function parsePlannerAnalyzeQuery(req: Request): ParseResult {
  const url = new URL(req.url);
  const params: PlannerParams = {};

  const wd = parseOptionalInt(
    url.searchParams.get("windowDays"),
    "windowDays",
    1,
    365,
  );
  if (wd.error) return { ok: false, error: wd.error };
  if (wd.value !== undefined) params.windowDays = wd.value;

  const hm = parseOptionalInt(
    url.searchParams.get("horizonMonths"),
    "horizonMonths",
    1,
    24,
  );
  if (hm.error) return { ok: false, error: hm.error };
  if (hm.value !== undefined) params.horizonMonths = hm.value;

  const scenarioRaw = url.searchParams.get("scenario")?.trim();
  if (scenarioRaw) {
    if (!SCENARIOS.has(scenarioRaw as PlannerParams["scenario"])) {
      return {
        ok: false,
        error: "scenario inválido; use conservative, base u optimistic.",
      };
    }
    params.scenario = scenarioRaw as PlannerParams["scenario"];
  }

  const country = url.searchParams.get("country")?.trim();
  if (country) {
    params.country = country;
  }

  const channelRaw = url.searchParams.get("channel")?.trim();
  if (channelRaw) {
    if (!CHANNELS.has(channelRaw as PlannerParams["channel"])) {
      return {
        ok: false,
        error: "channel inválido; use AMAZON_FBA, AMAZON_FBM o ALL.",
      };
    }
    params.channel = channelRaw as PlannerParams["channel"];
  }

  const incRaw = url.searchParams.get("includeNewProducts");
  if (incRaw !== null && incRaw !== "") {
    if (incRaw === "true") {
      params.includeNewProducts = true;
    } else if (incRaw === "false") {
      params.includeNewProducts = false;
    } else {
      return {
        ok: false,
        error: "includeNewProducts debe ser true o false.",
      };
    }
  }

  return { ok: true, params };
}

export async function GET(req: Request) {
  try {
    const parsed = parsePlannerAnalyzeQuery(req);
    if (parsed.ok === false) {
      return NextResponse.json(
        { ok: false, error: parsed.error },
        { status: 400 },
      );
    }

    const result = await analyzeProducts(parsed.params);

    const agentIds = Array.from(
      new Set(
        result.annualPurchasePlan.lines
          .map((l) => l.agentId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const supabase = createSupabaseRouteClient();
    const agentsMap = await fetchAgentsMap(supabase, agentIds);

    const enriched = await enrichPlannerSummary(
      result,
      parsed.params,
      agentsMap,
    );

    let funding:ReturnType<typeof buildPlannerFundingSummary>|null=null;
    let fundingWarning:string|null=null;
    try{
      const finance=await buildFinancialPlanning({months:parsed.params.horizonMonths??12});
      funding=buildPlannerFundingSummary({
        purchaseCapitalRequired:result.annualPurchasePlan.totalPurchaseCapitalRequired,
        capitalAlreadyCommitted:result.annualPurchasePlan.capitalAlreadyCommitted,
        operatingCashAvailableAboveReserveEur:finance.summary.operatingCashAvailableAboveReserveEur,
        totalCreditAvailableEur:finance.summary.totalCreditAvailable,
        amazonExpectedEur:finance.summary.amazonExpected,
      });
    }catch(error){
      fundingWarning=error instanceof Error?error.message:"Financiación no disponible";
      console.error("[planner/summary] financial capacity unavailable",error);
    }

    const carlyDebug = enriched.lines
      .filter((l) => (l.sku ?? "").toUpperCase().includes("CARLY"))
      .map((l) => ({
        sku: l.sku,
        proveedor_id: l.supplierId ?? null,
        puerto_preferido_id: l.supplierPreferredPortId,
        supplierPreferredPortName: l.supplierPreferredPortName,
        displayPortName: l.displayPortName,
      }));
    if (carlyDebug.length > 0) {
      console.table(carlyDebug);
    }

    return NextResponse.json({
      ok: true,
      stats: enriched.stats,
      annualPurchasePlan: {
        ...result.annualPurchasePlan,
        lines: enriched.lines,
      },
      purchasePlan: {
        portGroups: enriched.portGroups,
        containerGroups: enriched.containerGroups,
      },
      funding,
      fundingWarning,
      annualChart: buildPlannerAnnualChart({
        products: result.products,
        replenishmentLines: enriched.lines,
        newProductBudgetEur: funding?.suggestedNewProductBudgetEur ?? 0,
        horizonMonths: parsed.params.horizonMonths ?? 12,
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error interno al obtener resumen planner";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
