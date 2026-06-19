/**
 * POST /api/orders/create-from-planner
 *
 * Endpoint de prueba / control interno.
 *
 * TODO: Este endpoint es temporal. Cuando el dashboard de pedidos esté implementado
 *       será sustituido por el flujo estándar:
 *         1. El usuario revisa los DraftOrderGroups en la UI de pedidos.
 *         2. Selecciona un grupo y confirma la creación desde el formulario.
 *         3. La UI llama a POST /api/orders con el OrderDraft completo ya validado.
 *       Por ahora este endpoint ejecuta todo el pipeline en un solo request para
 *       poder verificar la integración planner → orders en entorno real.
 *
 * Flujo:
 *   body.groupKey  ─┐
 *   body.params    ─┤→ analyzeProducts → createDraftOrdersFromAnnualPlan
 *                   └→ find group → createOrderDraftFromGroup → createOrderFromDraft
 *
 * Restricciones:
 *   - Solo crea UNA orden por request (la del groupKey indicado).
 *   - Requiere usuario autenticado.
 *   - No toca contenedores ni planner.
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { analyzeProducts } from "@/modules/planner/services/analyzeProducts";
import { createDraftOrdersFromAnnualPlan } from "@/modules/orders/services/createDraftOrdersFromAnnualPlan";
import { createOrderDraftFromGroup } from "@/modules/orders/services/createOrderDraftFromGroup";
import {
  createOrderFromDraft,
  type CreateOrderFromDraftResult,
} from "@/modules/orders/services/createOrderFromDraft";
import type { PlannerParams } from "@/modules/planner/types/planner.types";

// ─────────────────────────────────────────────────────────────────────────────
// Default planner params (applied when not provided in request body)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PARAMS = {
  windowDays: 90,
  horizonMonths: 12,
  scenario: "base" as const,
  country: "ALL",
  channel: "ALL" as const,
  includeNewProducts: true,
} satisfies PlannerParams;

// ─────────────────────────────────────────────────────────────────────────────
// Default supplier payment terms
// Applied when the group's supplier has no payment config in proveedores table.
// TODO: Replace with a real lookup to proveedores.deposito_porcentaje etc.
//       once suppliers module is fully implemented.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PAYMENT = {
  depositPercentage: 30,
  balanceDaysBeforeArrival: 10,
  balanceConditionsText:
    "The balance will be paid 10 days before the vessel arrives at the port",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Valid enum sets (mirrors planning/analyze/route.ts pattern)
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

// ─────────────────────────────────────────────────────────────────────────────
// Body type
// ─────────────────────────────────────────────────────────────────────────────

type RequestBody = {
  groupKey: string;
  scenario?: PlannerParams["scenario"];
  windowDays?: number;
  horizonMonths?: number;
  country?: string;
  channel?: PlannerParams["channel"];
  includeNewProducts?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Body validation
// ─────────────────────────────────────────────────────────────────────────────

type ParseBodyResult =
  | { ok: true; groupKey: string; plannerParams: PlannerParams }
  | { ok: false; error: string };

function parseBody(raw: unknown): ParseBodyResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "El body debe ser un objeto JSON." };
  }

  const body = raw as Record<string, unknown>;

  // ── groupKey (required) ────────────────────────────────────────────────────
  if (typeof body.groupKey !== "string" || body.groupKey.trim() === "") {
    return {
      ok: false,
      error: "groupKey es obligatorio y debe ser un string no vacío.",
    };
  }
  const groupKey = body.groupKey.trim();

  // ── plannerParams (all optional — fall back to defaults) ──────────────────
  const params: PlannerParams = { ...DEFAULT_PARAMS };

  if (body.windowDays !== undefined) {
    const n = Number(body.windowDays);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      return {
        ok: false,
        error: "windowDays debe ser un entero entre 1 y 365.",
      };
    }
    params.windowDays = n;
  }

  if (body.horizonMonths !== undefined) {
    const n = Number(body.horizonMonths);
    if (!Number.isInteger(n) || n < 1 || n > 24) {
      return {
        ok: false,
        error: "horizonMonths debe ser un entero entre 1 y 24.",
      };
    }
    params.horizonMonths = n;
  }

  if (body.scenario !== undefined) {
    if (!VALID_SCENARIOS.has(body.scenario as PlannerParams["scenario"])) {
      return {
        ok: false,
        error: "scenario inválido. Use: conservative | base | optimistic.",
      };
    }
    params.scenario = body.scenario as PlannerParams["scenario"];
  }

  if (body.country !== undefined) {
    if (typeof body.country !== "string" || body.country.trim() === "") {
      return { ok: false, error: "country debe ser un string no vacío." };
    }
    params.country = body.country.trim();
  }

  if (body.channel !== undefined) {
    if (!VALID_CHANNELS.has(body.channel as PlannerParams["channel"])) {
      return {
        ok: false,
        error: "channel inválido. Use: AMAZON_FBA | AMAZON_FBM | ALL.",
      };
    }
    params.channel = body.channel as PlannerParams["channel"];
  }

  if (body.includeNewProducts !== undefined) {
    if (typeof body.includeNewProducts !== "boolean") {
      return {
        ok: false,
        error: "includeNewProducts debe ser true o false.",
      };
    }
    params.includeNewProducts = body.includeNewProducts;
  }

  return { ok: true, groupKey, plannerParams: params };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
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

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body inválido. Se esperaba JSON." },
      { status: 400 },
    );
  }

  const parsed = parseBody(rawBody);
  if (!parsed.ok) {
    // Explicit cast: strict:false + incremental tsconfig doesn't always narrow
    // discriminated unions inside !x.ok guards.
    const { error } = parsed as Extract<ParseBodyResult, { ok: false }>;
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }

  const { groupKey, plannerParams } = parsed;

  // ── 3. Run planner analysis ────────────────────────────────────────────────
  let annualPurchasePlan: Awaited<ReturnType<typeof analyzeProducts>>["annualPurchasePlan"];
  try {
    const result = await analyzeProducts(plannerParams);
    annualPurchasePlan = result.annualPurchasePlan;
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

  // ── 4. Build draft groups ──────────────────────────────────────────────────
  const { groups } = createDraftOrdersFromAnnualPlan(annualPurchasePlan);

  // ── 5. Find the requested group ────────────────────────────────────────────
  const group = groups.find((g) => g.groupKey === groupKey);
  if (!group) {
    return NextResponse.json(
      {
        ok: false,
        error: "Grupo no encontrado.",
        availableGroupKeys: groups.map((g) => ({
          groupKey: g.groupKey,
          supplierName: g.supplierName,
          originPortId: g.originPortId,
          productCount: g.productCount,
        })),
      },
      { status: 404 },
    );
  }

  // ── 6. Convert group to OrderDraft ─────────────────────────────────────────
  const draft = createOrderDraftFromGroup(group, DEFAULT_PAYMENT);

  // ── 7. Check draft is ready ────────────────────────────────────────────────
  if (!draft.isReadyToSubmit) {
    return NextResponse.json(
      {
        ok: false,
        error: "El borrador no está listo para crear orden.",
        warnings: draft.warnings,
        groupKey,
        draft,
      },
      { status: 422 },
    );
  }

  // ── 8. Persist order ───────────────────────────────────────────────────────
  const orderResult = await createOrderFromDraft(draft);

  if (!orderResult.ok) {
    // Explicit cast: same strict:false narrowing limitation as above.
    const errResult = orderResult as Extract<
      CreateOrderFromDraftResult,
      { ok: false }
    >;
    const status = errResult.code === "ORDER_DRAFT_NOT_READY" ? 422 : 500;
    return NextResponse.json(
      { ok: false, error: errResult.message, code: errResult.code },
      { status },
    );
  }

  // ── 9. Return created order ────────────────────────────────────────────────
  return NextResponse.json(
    {
      ok: true,
      groupKey,
      draft,
      orden: orderResult.orden,
      items: orderResult.items,
    },
    { status: 201 },
  );
}
