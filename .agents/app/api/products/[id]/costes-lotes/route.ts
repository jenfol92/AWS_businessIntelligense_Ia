/**
 * GET /api/products/[id]/costes-lotes
 * Costes por lote desde producto_costos y cantidades en orden_items.
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

type RouteContext = { params: { id: string } };

function firstRelation<T>(rel: T | T[] | null | undefined): T | null {
  if (rel == null) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

export async function GET(_req: Request, { params }: RouteContext) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const productoId = params.id;

  try {
    const { data: resumen } = await supabase
      .from("v_producto_coste_medio")
      .select("*")
      .eq("producto_id", productoId)
      .maybeSingle();

    const { data: lotesRaw, error: lotesErr } = await supabase
      .from("producto_costos")
      .select(
        `id, fecha, lote_producto, contenedor_id, pais_destino,
         costo_fabrica_eur, costo_flete_unit_eur, gastos_llegada_puerto_eur_unit,
         transito_eur_unit, costo_unitario_total_eur,
         contenedores:contenedor_id(identificador_embarque, puerto_llegada, fecha_eta_estimada)`,
      )
      .eq("producto_id", productoId)
      .not("contenedor_id", "is", null)
      .order("fecha", { ascending: false })
      .limit(50);

    if (lotesErr) {
      return NextResponse.json({ ok: false, error: lotesErr.message }, { status: 400 });
    }

    const lotes: Record<string, unknown>[] = [];

    for (const pc of lotesRaw ?? []) {
      const row = pc as Record<string, unknown>;
      let cantidad = 0;

      if (row.contenedor_id) {
        const { data: linkOrdenes } = await supabase
          .from("contenedor_ordenes")
          .select("orden_id")
          .eq("contenedor_id", row.contenedor_id as string);

        const ordenIds = (linkOrdenes ?? []).map(
          (l: { orden_id: string }) => l.orden_id,
        );

        if (ordenIds.length > 0) {
          let q = supabase
            .from("orden_items")
            .select("cantidad, lote_producto")
            .in("orden_id", ordenIds)
            .eq("producto_id", productoId);

          if (row.lote_producto) {
            q = q.eq("lote_producto", row.lote_producto as string);
          }

          const { data: its } = await q;
          cantidad = (its ?? []).reduce(
            (s: number, it: { cantidad: number | null }) =>
              s + Number(it.cantidad ?? 0),
            0,
          );
        }
      }

      const contInfo = firstRelation(
        row.contenedores as
          | Record<string, unknown>
          | Record<string, unknown>[]
          | null,
      );

      lotes.push({
        id: row.id,
        fecha: row.fecha,
        lote_producto: row.lote_producto,
        contenedor_id: row.contenedor_id,
        pais_destino: row.pais_destino,
        numero_embarque: contInfo?.identificador_embarque ?? null,
        puerto_llegada: contInfo?.puerto_llegada ?? null,
        eta: contInfo?.fecha_eta_estimada ?? null,
        cantidad,
        costo_fabrica_eur:
          row.costo_fabrica_eur != null ? Number(row.costo_fabrica_eur) : null,
        costo_flete_unit_eur:
          row.costo_flete_unit_eur != null
            ? Number(row.costo_flete_unit_eur)
            : null,
        gastos_llegada_puerto_eur_unit:
          row.gastos_llegada_puerto_eur_unit != null
            ? Number(row.gastos_llegada_puerto_eur_unit)
            : null,
        transito_eur_unit:
          row.transito_eur_unit != null ? Number(row.transito_eur_unit) : null,
        costo_unitario_total_eur:
          row.costo_unitario_total_eur != null
            ? Number(row.costo_unitario_total_eur)
            : null,
      });
    }

    return NextResponse.json({
      ok: true,
      resumen: resumen ?? null,
      lotes,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al cargar costes por lote";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
