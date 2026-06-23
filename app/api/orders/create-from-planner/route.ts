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
import {
  createOrderFromPlannerService,
} from "@/modules/orders/services/createOrderFromPlannerService";
import type { PlannerParams } from "@/modules/planner/types/planner.types";

// ─────────────────────────────────────────────────────────────────────────────
// Default planner params (applied when not provided in request body)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PARAMS: PlannerParams = {
  windowDays: 90,
  horizonMonths: 12,
  scenario: "base",
  country: "ALL",
  channel: "ALL",
  includeNewProducts: true,
};

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
// Body type + validation
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

type ParseBodyResult =
  | { ok: true; groupKey: string; plannerParams: PlannerParams }
  | { ok: false; error: string };

function parseBody(raw: unknown): ParseBodyResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "El body debe ser un objeto JSON." };
  }

  const body = raw as Record<string, unknown>;

  if (typeof body.groupKey !== "string" || body.groupKey.trim() === "") {
    return {
      ok: false,
      error: "groupKey es obligatorio y debe ser un string no vacío.",
    };
  }
  const groupKey = body.groupKey.trim();

  const params: PlannerParams = { ...DEFAULT_PARAMS };

  if (body.windowDays !== undefined) {
    const n = Number(body.windowDays);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      return { ok: false, error: "windowDays debe ser un entero entre 1 y 365." };
    }
    params.windowDays = n;
  }

  if (body.horizonMonths !== undefined) {
    const n = Number(body.horizonMonths);
    if (!Number.isInteger(n) || n < 1 || n > 24) {
      return { ok: false, error: "horizonMonths debe ser un entero entre 1 y 24." };
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
      return { ok: false, error: "includeNewProducts debe ser true o false." };
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
    const { error } = parsed as Extract<ParseBodyResult, { ok: false }>;
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }

  const { groupKey, plannerParams } = parsed;

  // ── 3. Orquestación delegada al service ────────────────────────────────────
  const result = await createOrderFromPlannerService(groupKey, plannerParams);

  // ── 4. Mapping de errores del service a respuestas HTTP ────────────────────
  // NOTE: The switch is inside `if (!result.ok)` so TypeScript correctly narrows
  //       `result` to the error-union variants before accessing `result.code`.
  if (result.ok === false) {
    switch (result.code) {
      case "PLANNER_ERROR":
        return NextResponse.json(
          { ok: false, error: result.error },
          { status: 500 },
        );

      case "GROUP_NOT_FOUND":
        return NextResponse.json(
          {
            ok: false,
            error: result.error,
            availableGroupKeys: result.availableGroupKeys,
          },
          { status: 404 },
        );

      case "DRAFT_NOT_READY":
        return NextResponse.json(
          {
            ok: false,
            error: result.error,
            warnings: result.warnings,
            groupKey: result.groupKey,
            draft: result.draft,
          },
          { status: 422 },
        );

      case "ORDER_DRAFT_NOT_READY":
        return NextResponse.json(
          { ok: false, error: result.error, code: result.code },
          { status: 422 },
        );

      case "ORDER_HEADER_INSERT_FAILED":
      case "ORDER_ITEMS_INSERT_FAILED":
      default:
        return NextResponse.json(
          { ok: false, error: result.error, code: result.code },
          { status: 500 },
        );
    }
  }

  // ── 5. Éxito ───────────────────────────────────────────────────────────────
  return NextResponse.json(
    {
      ok: true,
      groupKey: result.groupKey,
      draft: result.draft,
      orden: result.orden,
      items: result.items,
    },
    { status: 201 },
  );
}
