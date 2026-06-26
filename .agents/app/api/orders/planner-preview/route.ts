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
import { buildPlannerOrderPreviewService } from "@/modules/orders/services/buildPlannerOrderPreviewService";
import type { PlannerParams } from "@/modules/planner/types/planner.types";

// ─────────────────────────────────────────────────────────────────────────────
// Defaults y validación de query params
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PARAMS: PlannerParams = {
  windowDays: 90,
  horizonMonths: 12,
  scenario: "base",
  country: "ALL",
  channel: "ALL",
  includeNewProducts: true,
};

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
// Route handler
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
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

  // ── 2. Parse query params ──────────────────────────────────────────────────
  const url = new URL(req.url);
  const parsed = parseQueryParams(url);
  if (!parsed.ok) {
    const { error } = parsed as Extract<ParseQueryResult, { ok: false }>;
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }

  const { params } = parsed as Extract<ParseQueryResult, { ok: true }>;

  // ── 3. Orquestación delegada al service ────────────────────────────────────
  try {
    const { stats, summary, groups, drafts } =
      await buildPlannerOrderPreviewService(params);

    return NextResponse.json({ ok: true, stats, summary, groups, drafts });
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
}
