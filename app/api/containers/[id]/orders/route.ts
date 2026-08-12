/**
 * Módulo   : containers
 * Archivo  : app/api/containers/[id]/orders/route.ts
 * Qué hace : POST   — Añade una orden confirmada al contenedor.
 *            DELETE — Elimina el vínculo entre una orden y el contenedor.
 */

import { NextResponse } from "next/server";
import { linkOrdersToContainer } from "@/modules/containers/repositories/containerOrdersRepository";
import { propagateOrderFieldsToContainer } from "@/modules/containers/services/propagateOrderFieldsToContainer";
import { refreshSupplierPaymentsFromContainer } from "@/modules/finance/services/syncSupplierPaymentsForOrder";
import { supabaseAdmin } from "@/server/supabase/adminClient";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

type Params = { params: { id: string } };

export async function POST(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

  let body: { orden_id?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 }); }

  const { orden_id } = body;
  if (!orden_id) return NextResponse.json({ ok: false, error: "orden_id es obligatorio" }, { status: 400 });

  const linkResult = await linkOrdersToContainer(supabase, params.id, [orden_id]);
  if (linkResult.ok === false) {
    return NextResponse.json(
      { ok: false, code: linkResult.code, error: linkResult.error },
      { status: linkResult.status },
    );
  }

  try {
    await propagateOrderFieldsToContainer(supabase, params.id, [orden_id], true);
  } catch (propagateError) {
    const msg = propagateError instanceof Error ? propagateError.message : "Error propagando datos de la orden";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  try {
    await refreshSupplierPaymentsFromContainer(supabase, params.id);
  } catch (syncError) {
    console.error("refreshSupplierPaymentsFromContainer:", syncError);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

  const url      = new URL(req.url);
  const orden_id = url.searchParams.get("orden_id");
  if (!orden_id) return NextResponse.json({ ok: false, error: "orden_id es obligatorio" }, { status: 400 });

  const { error } = await supabase
    .from("contenedor_ordenes").delete().eq("contenedor_id", params.id).eq("orden_id", orden_id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  const { error: assignmentError } = await supabaseAdmin
    .from("orden_logistics_assignments")
    .update({ status: "inactive" })
    .eq("orden_id", orden_id)
    .eq("contenedor_id", params.id)
    .eq("assignment_type", "contenedor_propio")
    .eq("status", "active");
  if (assignmentError) {
    return NextResponse.json({ ok: false, error: assignmentError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
