/**
 * Módulo   : orders
 * Archivo  : app/api/orders/suggestions/route.ts
 * Qué hace : GET — devuelve los productos que necesitan reposición urgente.
 *
 * Flujo (por prioridad):
 *  0. CAMINO PLANNER (prioritario): llama a analyzeProducts y usa las líneas
 *     de annualPurchasePlan como fuente principal si devuelve al menos 1 producto.
 *     Enriquece los resultados con imagen y stock desde Supabase.
 *
 *  1. Si el planner falla o no devuelve líneas, consulta la vista
 *     v_stock_seguridad_sugerido (camino stock principal).
 *     Incluye riesgo 'sin_ventas' además de 'critico' y 'bajo'.
 *
 *  2. Si la vista devuelve filas pero todas tienen unidades_a_pedir = 0
 *     (señal de que avg_daily_used = 0 en la BD), se activa el FALLBACK:
 *     calcula unidades_sugeridas leyendo ventas_diarias de los últimos 90 días.
 *
 *  3. Si se llama con ?debug=true devuelve información de diagnóstico.
 *
 * Criterio fallback por producto:
 *   - stock_total <= 0          → riesgo "critico", sugerir según ventas o pedido mínimo
 *   - stock_total > 0 y ventas  → calcular días cobertura
 *       cobertura <= 30 d       → "critico"
 *       cobertura <= 60 d       → "bajo"
 *       > 60 d                  → ignorar
 *   - stock_total > 0, sin ventas → ignorar (sin_ventas no accionable)
 */

import { NextResponse }              from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { analyzeProducts }           from "@/modules/planner/services/analyzeProducts";
import type { AnnualPurchasePlanLine } from "@/modules/planner/types/planner.types";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

/** Fila de sugerencia de compra devuelta por este endpoint. */
export type SugerenciaRow = {
  // ── Campos base (siempre presentes) ──────────────────────────────────────
  producto_id:        string;
  sku:                string;
  nombre:             string;
  imagen_url:         string | null;
  categoria:          string | null;
  proveedor_id:       string | null;
  proveedor_nombre:   string | null;
  puerto_preferido:   string | null;
  dias_produccion:    number;
  dias_transito:      number;
  lead_time_total:    number;
  stock_fba:          number;
  stock_fbm:          number;
  stock_actual:       number;
  dias_cobertura:     number | null;
  unidades_sugeridas: number;
  cbm_unitario:       number;
  cbm_total_sugerido: number;
  coste_unitario_usd: number | null;
  riesgo:             "critico" | "bajo" | null;
  // ── Campos extendidos del planner (presentes solo cuando fuente="planner") ─
  /** Fuente de la sugerencia: planner o stock. */
  fuente?:                  "planner" | "stock";
  /** Fecha recomendada para emitir el pedido (ISO YYYY-MM-DD). */
  recommended_order_date?:  string | null;
  /** Fecha estimada de llegada a almacén (ISO YYYY-MM-DD). */
  estimated_arrival_date?:  string | null;
  /** ID del agente logístico. */
  agente_id?:               string | null;
  /** Nombre del agente logístico. */
  agente_nombre?:           string | null;
  /** ID del puerto de origen. */
  origin_port_id?:          string | null;
  /** Estado de temporización del pedido según el planner. */
  order_timing_status?:     "ON_TIME" | "DUE_NOW" | "OVERDUE";
  /** Días de retraso acumulados si el pedido está vencido. */
  days_late?:               number;
  /** Indica si el producto puede consolidarse en un contenedor compartido. */
  consolidation_eligible?:  boolean;
  /** Peso total en kg del pedido sugerido. */
  peso_kg_total?:           number | null;
  /** Capital de compra estimado necesario (USD). */
  capital_requerido?:       number | null;
  /** Nombre legible del puerto de origen (resuelto desde puertos_china). Nunca UUID. */
  origin_port_name?:        string | null;
};

// ─── Tipo interno de la vista ─────────────────────────────────────────────────

type ViewRow = {
  producto_id:      string;
  sku:              string | null;
  stock_actual:     number;
  stock_fba:        number;
  stock_fbm:        number;
  avg_daily_used:   number;
  dias_cobertura:   number | null;
  unidades_a_pedir: number;
  riesgo:           string | null;
};

// ─── Helper: ordenar sugerencias ──────────────────────────────────────────────

function ordenarSugerencias(rows: SugerenciaRow[]): SugerenciaRow[] {
  return rows.sort((a, b) => {
    const rOrder = (r: string | null) => (r === "critico" ? 0 : r === "bajo" ? 1 : 2);
    const rd = rOrder(a.riesgo) - rOrder(b.riesgo);
    if (rd !== 0) return rd;
    return (a.dias_cobertura ?? 999) - (b.dias_cobertura ?? 999);
  });
}

// ─── Handler principal ────────────────────────────────────────────────────────

/**
 * GET /api/orders/suggestions
 * GET /api/orders/suggestions?debug=true  — incluye bloque de diagnóstico
 */
export async function GET(req: Request) {
  const supabase = createSupabaseRouteClient();
  const url      = new URL(req.url);
  const isDebug  = url.searchParams.get("debug") === "true";

  // ── Verificar sesión ─────────────────────────────────────────────────────────
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CAMINO 0 — PLANNER: fuente prioritaria si devuelve líneas a pedir
  // ══════════════════════════════════════════════════════════════════════════
  try {
    const plannerResult = await analyzeProducts({
      windowDays:        90,
      horizonMonths:     12,
      scenario:          "base",
      country:           "ALL",
      channel:           "ALL",
      includeNewProducts: true,
    });

    const lines: AnnualPurchasePlanLine[] = plannerResult.annualPurchasePlan.lines;

    if (lines.length > 0) {
      // Enriquecer con datos de imagen y stock que el planner no expone
      const plannerProductIds = Array.from(new Set(lines.map((l) => l.productId)));

      const [detPlanRes, stockPlanRes] = await Promise.all([
        supabase
          .from("producto_detalle")
          .select("producto_id, imagen_url, categoria")
          .in("producto_id", plannerProductIds),
        supabase
          .from("inventario_paises")
          .select("producto_id, stock_fba, stock_fbm")
          .in("producto_id", plannerProductIds),
      ]);

      // Mapa de detalles visuales
      const detallePlanMap: Record<string, { imagen_url: string | null; categoria: string | null }> = {};
      for (const d of detPlanRes.data ?? []) {
        const r = d as Record<string, unknown>;
        detallePlanMap[r["producto_id"] as string] = {
          imagen_url: (r["imagen_url"] as string | null) ?? null,
          categoria:  (r["categoria"]  as string | null) ?? null,
        };
      }

      // Mapa de stock agregado por producto
      const stockPlanMap: Record<string, { fba: number; fbm: number }> = {};
      for (const s of stockPlanRes.data ?? []) {
        const r   = s as Record<string, unknown>;
        const pid = r["producto_id"] as string;
        if (!stockPlanMap[pid]) stockPlanMap[pid] = { fba: 0, fbm: 0 };
        stockPlanMap[pid].fba += Number(r["stock_fba"] ?? 0);
        stockPlanMap[pid].fbm += Number(r["stock_fbm"] ?? 0);
      }

      // Resolver nombres de puertos de origen desde puertos_china
      // El planner almacena UUIDs en originPortId; ordenes_compra.fob_puerto debe ser texto.
      const originPortIds = Array.from(
        new Set(lines.map((l) => l.originPortId).filter((id): id is string => !!id)),
      );
      const portNameById: Record<string, string> = {};
      if (originPortIds.length > 0) {
        const { data: portRows } = await supabase
          .from("puertos_china")
          .select("id, nombre, code")
          .in("id", originPortIds);
        for (const p of portRows ?? []) {
          const r    = p as Record<string, unknown>;
          const pid  = r["id"] as string;
          const name = (r["nombre"] ?? r["code"] ?? "") as string;
          if (pid && name) portNameById[pid] = name;
        }
      }

      // Mapear cada línea del plan a SugerenciaRow
      const plannerRows: SugerenciaRow[] = lines.map((line) => {
        const det   = detallePlanMap[line.productId] ?? { imagen_url: null, categoria: null };
        const stock = stockPlanMap[line.productId]   ?? { fba: 0, fbm: 0 };

        // CBM unitario derivado del total y la cantidad sugerida
        const cbmUnitario =
          line.cbmTotal != null && line.recommendedOrderUnits > 0
            ? line.cbmTotal / line.recommendedOrderUnits
            : 0;

        // Traducir estado de temporización a nivel de riesgo visual
        const riesgo: "critico" | "bajo" | null =
          line.orderTimingStatus === "OVERDUE" ? "critico" :
          line.orderTimingStatus === "DUE_NOW"  ? "bajo"   : null;

        // Nombre del puerto de origen (texto legible, no UUID)
        const portName = line.originPortId ? portNameById[line.originPortId] ?? null : null;

        return {
          // ── Campos base ────────────────────────────────────────────────
          producto_id:        line.productId,
          sku:                line.sku,
          nombre:             line.productName ?? line.sku,
          imagen_url:         det.imagen_url,
          categoria:          det.categoria,
          proveedor_id:       line.supplierId   ?? null,
          proveedor_nombre:   line.supplierName ?? null,
          // Guardar el nombre del puerto, nunca el UUID
          puerto_preferido:   portName ?? null,
          dias_produccion:    0,
          dias_transito:      0,
          lead_time_total:    0,
          stock_fba:          stock.fba,
          stock_fbm:          stock.fbm,
          stock_actual:       stock.fba + stock.fbm,
          dias_cobertura:     null,
          unidades_sugeridas: line.recommendedOrderUnits,
          cbm_unitario:       cbmUnitario,
          cbm_total_sugerido: line.cbmTotal ?? 0,
          coste_unitario_usd: line.unitPurchaseCost ?? null,
          riesgo,
          // ── Campos extendidos del planner ──────────────────────────────
          fuente:                 "planner",
          recommended_order_date: line.recommendedOrderDate ?? null,
          estimated_arrival_date: line.estimatedArrivalDate ?? null,
          agente_id:              line.agentId   ?? null,
          agente_nombre:          line.agentName ?? null,
          origin_port_id:         line.originPortId ?? null,
          origin_port_name:       portName,
          order_timing_status:    line.orderTimingStatus,
          days_late:              line.daysLate,
          consolidation_eligible: line.consolidationEligible,
          peso_kg_total:          line.weightKgTotal          ?? null,
          capital_requerido:      line.purchaseCapitalRequired ?? null,
        };
      });

      const sortedPlannerRows = ordenarSugerencias(plannerRows);

      const plannerResult2 = {
        ok:               true,
        rows:             sortedPlannerRows,
        fallbackActivado: false,
        fuente:           "planner" as const,
      };

      return isDebug
        ? NextResponse.json({ ...plannerResult2, debug: { plannerLines: lines.length } })
        : NextResponse.json(plannerResult2);
    }
    // El planner no tiene líneas → continuar con el camino de stock
  } catch (plannerError) {
    // Si el planner falla (BD sin datos, timeout, etc.) usar el fallback de stock
    console.error("[suggestions] Error en planner, usando camino stock:", plannerError);
  }

  // ── 1. Consultar vista principal ─────────────────────────────────────────────
  // Se amplía el filtro a 'sin_ventas' y se elimina gt("unidades_a_pedir", 0)
  // porque la vista produce 0 cuando no hay historial de ventas.
  const { data: viewRows, error: viewError } = await supabase
    .from("v_stock_seguridad_sugerido")
    .select("*")
    .in("riesgo", ["critico", "bajo", "sin_ventas"]);

  if (viewError) {
    return NextResponse.json({ ok: false, error: viewError.message }, { status: 400 });
  }

  const rows = (viewRows ?? []) as ViewRow[];

  // ── Debug: recopilar métricas antes de procesar ───────────────────────────────
  let debugInfo: Record<string, unknown> | undefined;
  if (isDebug) {
    const { data: allRows } = await supabase
      .from("v_stock_seguridad_sugerido")
      .select("*");

    debugInfo = {
      viewTotalRows:         allRows?.length ?? 0,
      rowsWithRisk:          rows.length,
      rowsWithUnitsToOrder:  rows.filter((r) => Number(r.unidades_a_pedir) > 0).length,
      sampleRows: rows.slice(0, 5).map((r) => ({
        producto_id:      r.producto_id,
        sku:              r.sku              ?? null,
        stock_fba:        r.stock_fba,
        stock_fbm:        r.stock_fbm,
        stock_actual:     r.stock_actual,
        dias_cobertura:   r.dias_cobertura   ?? null,
        unidades_a_pedir: r.unidades_a_pedir,
        riesgo:           r.riesgo           ?? null,
        avg_daily_used:   r.avg_daily_used,
      })),
    };
  }

  if (rows.length === 0) {
    const result = { ok: true, rows: [], fallbackActivado: false };
    return isDebug
      ? NextResponse.json({ ...result, debug: debugInfo })
      : NextResponse.json(result);
  }

  // ── 2. Decidir si se usa el camino principal o el fallback ────────────────────
  //
  // El fallback se activa cuando la vista no puede calcular unidades_a_pedir
  // útiles, lo que ocurre cuando avg_daily_used = 0 para todos los productos
  // (ausencia de datos de ventas).
  const hayUnidadesEnVista = rows.some((r) => Number(r.unidades_a_pedir) > 0);

  // IDs únicos de los productos con riesgo
  const productIds = Array.from(
    new Set(rows.filter((r) => !!r.producto_id).map((r) => r.producto_id)),
  );

  // ── 3. Datos comunes (ambos caminos los necesitan) ────────────────────────────

  const [prodRes, logRes, detRes, costRes] = await Promise.all([
    supabase
      .from("productos")
      .select(
        `id, sku, nombre, estado, proveedor_id, pedido_minimo_unidades,
         proveedores(id, nombre, puerto_preferido, dias_produccion_estandar, dias_transito_estandar)`,
      )
      .in("id", productIds)
      .eq("estado", "activo"),

    supabase
      .from("producto_logistica")
      .select("producto_id, cubicaje_unitario_m3")
      .in("producto_id", productIds),

    supabase
      .from("producto_detalle")
      .select("producto_id, imagen_url, categoria")
      .in("producto_id", productIds),

    supabase
      .from("producto_costos")
      .select("producto_id, costo_fabrica_usd")
      .in("producto_id", productIds)
      .order("fecha", { ascending: false }),
  ]);

  // Mapas de datos comunes
  const cbmMap: Record<string, number> = {};
  for (const l of logRes.data ?? []) {
    const r = l as Record<string, unknown>;
    cbmMap[r["producto_id"] as string] = Number(r["cubicaje_unitario_m3"] ?? 0);
  }

  const detalleMap: Record<string, { imagen_url: string | null; categoria: string | null }> = {};
  for (const d of detRes.data ?? []) {
    const r = d as Record<string, unknown>;
    detalleMap[r["producto_id"] as string] = {
      imagen_url: r["imagen_url"] as string | null,
      categoria:  r["categoria"]  as string | null,
    };
  }

  const costoMap: Record<string, number> = {};
  for (const c of costRes.data ?? []) {
    const r = c as Record<string, unknown>;
    const pid = r["producto_id"] as string;
    if (!costoMap[pid]) costoMap[pid] = Number(r["costo_fabrica_usd"] ?? 0);
  }

  const viewMap: Record<string, ViewRow> = {};
  for (const r of rows) viewMap[r.producto_id] = r;

  const prodMap: Record<string, Record<string, unknown>> = {};
  for (const p of prodRes.data ?? []) {
    prodMap[(p as Record<string, unknown>)["id"] as string] = p as Record<string, unknown>;
  }

  // ── Helper para extraer info de proveedor ─────────────────────────────────────
  function extraerProv(p: Record<string, unknown>) {
    const raw = p["proveedores"];
    return Array.isArray(raw)
      ? (raw[0] as Record<string, unknown> | undefined)
      : (raw as Record<string, unknown> | null);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMINO A — Vista tiene unidades_a_pedir > 0: usar directamente
  // ═══════════════════════════════════════════════════════════════════════════

  if (hayUnidadesEnVista) {
    const resultado: SugerenciaRow[] = [];

    for (const pid of productIds) {
      const s = viewMap[pid];
      const p = prodMap[pid];
      if (!p || Number(s.unidades_a_pedir) <= 0) continue;

      const prov           = extraerProv(p);
      const diasProduccion = Number(prov?.["dias_produccion_estandar"] ?? 0);
      const diasTransito   = Number(prov?.["dias_transito_estandar"]   ?? 0);
      const cbm            = cbmMap[pid] ?? 0;
      const cantSugerida   = Number(s.unidades_a_pedir);
      const det            = detalleMap[pid] ?? { imagen_url: null, categoria: null };

      resultado.push({
        producto_id:        pid,
        sku:                p["sku"] as string,
        nombre:             p["nombre"] as string,
        imagen_url:         det.imagen_url ?? null,
        categoria:          det.categoria  ?? null,
        proveedor_id:       p["proveedor_id"] as string | null,
        proveedor_nombre:   prov ? String(prov["nombre"] ?? "") : null,
        puerto_preferido:   prov ? String(prov["puerto_preferido"] ?? "") || null : null,
        dias_produccion:    diasProduccion,
        dias_transito:      diasTransito,
        lead_time_total:    diasProduccion + diasTransito,
        stock_fba:          Number(s.stock_fba  ?? 0),
        stock_fbm:          Number(s.stock_fbm  ?? 0),
        stock_actual:       Number(s.stock_actual ?? 0),
        dias_cobertura:     s.dias_cobertura != null ? Number(s.dias_cobertura) : null,
        unidades_sugeridas: cantSugerida,
        cbm_unitario:       cbm,
        cbm_total_sugerido: cbm * cantSugerida,
        coste_unitario_usd: costoMap[pid] ?? null,
        riesgo:             (s.riesgo === "critico" || s.riesgo === "bajo") ? s.riesgo : null,
        fuente:             "stock",
      });
    }

    const result = { ok: true, rows: ordenarSugerencias(resultado), fallbackActivado: false, fuente: "stock" as const };
    return isDebug
      ? NextResponse.json({ ...result, debug: debugInfo })
      : NextResponse.json(result);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMINO B — FALLBACK: calcular unidades desde ventas_diarias 90d
  // Se activa cuando la vista tiene avg_daily_used = 0 para todos los productos.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── B.1. Ventas de los últimos 90 días ────────────────────────────────────────
  const fecha90 = new Date();
  fecha90.setDate(fecha90.getDate() - 90);

  const { data: ventas } = await supabase
    .from("ventas_diarias")
    .select("producto_id, unidades_vendidas")
    .in("producto_id", productIds)
    .gte("fecha", fecha90.toISOString().slice(0, 10));

  const ventasMap: Record<string, number> = {};
  for (const v of ventas ?? []) {
    const r   = v as Record<string, unknown>;
    const pid = r["producto_id"] as string;
    ventasMap[pid] = (ventasMap[pid] ?? 0) + Number(r["unidades_vendidas"] ?? 0);
  }

  // ── B.2. Calcular sugerencias con la fórmula de fallback ──────────────────────
  const resultado: SugerenciaRow[] = [];

  for (const pid of productIds) {
    const vRow = viewMap[pid];
    const p    = prodMap[pid];
    if (!p) continue; // producto no activo, omitir

    const stockFba   = Number(vRow?.stock_fba    ?? 0);
    const stockFbm   = Number(vRow?.stock_fbm    ?? 0);
    const stockTotal = Number(vRow?.stock_actual ?? stockFba + stockFbm);

    // Promedio diario de ventas real (90 días)
    const avgDailySales = (ventasMap[pid] ?? 0) / 90;

    let riesgo:            "critico" | "bajo" | null = null;
    let diasCobertura:     number | null             = null;
    let unidadesSugeridas: number                    = 0;

    if (stockTotal <= 0) {
      // Sin stock: crítico, siempre se debe pedir
      riesgo        = "critico";
      diasCobertura = 0;

      if (avgDailySales > 0) {
        unidadesSugeridas = Math.ceil(avgDailySales * 90);
      } else {
        // Sin ventas y sin stock: usar pedido mínimo del producto o 1
        const pedidoMinimo = Number(p["pedido_minimo_unidades"] ?? 0);
        unidadesSugeridas  = pedidoMinimo > 0 ? pedidoMinimo : 1;
      }
    } else if (avgDailySales > 0) {
      // Stock > 0 con ventas: evaluar cobertura
      diasCobertura = stockTotal / avgDailySales;

      if (diasCobertura <= 30) {
        riesgo = "critico";
      } else if (diasCobertura <= 60) {
        riesgo = "bajo";
      } else {
        continue; // cobertura suficiente, no sugerir
      }

      unidadesSugeridas = Math.max(1, Math.ceil(avgDailySales * 90 - stockTotal));
    } else {
      // Stock > 0 y sin ventas (sin_ventas): no se puede calcular cantidad útil
      continue;
    }

    if (unidadesSugeridas <= 0) continue;

    const cbm  = cbmMap[pid] ?? 0;
    const det  = detalleMap[pid] ?? { imagen_url: null, categoria: null };
    const prov = extraerProv(p);

    const diasProduccion = Number(prov?.["dias_produccion_estandar"] ?? 0);
    const diasTransito   = Number(prov?.["dias_transito_estandar"]   ?? 0);

    resultado.push({
      producto_id:        pid,
      sku:                p["sku"] as string,
      nombre:             p["nombre"] as string,
      imagen_url:         det.imagen_url ?? null,
      categoria:          det.categoria  ?? null,
      proveedor_id:       p["proveedor_id"] as string | null,
      proveedor_nombre:   prov ? String(prov["nombre"] ?? "") : null,
      puerto_preferido:   prov ? String(prov["puerto_preferido"] ?? "") || null : null,
      dias_produccion:    diasProduccion,
      dias_transito:      diasTransito,
      lead_time_total:    diasProduccion + diasTransito,
      stock_fba:          stockFba,
      stock_fbm:          stockFbm,
      stock_actual:       stockTotal,
      dias_cobertura:     diasCobertura,
      unidades_sugeridas: unidadesSugeridas,
      cbm_unitario:       cbm,
      cbm_total_sugerido: cbm * unidadesSugeridas,
      coste_unitario_usd: costoMap[pid] ?? null,
      riesgo,
      fuente:             "stock",
    });
  }

  const result = {
    ok:               true,
    rows:             ordenarSugerencias(resultado),
    fallbackActivado: true,
    fuente:           "stock" as const,
  };

  return isDebug
    ? NextResponse.json({ ...result, debug: debugInfo })
    : NextResponse.json(result);
}
