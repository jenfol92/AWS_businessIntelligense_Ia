/**
 * Módulo   : containers
 * Archivo  : app/api/containers/[id]/route.ts
 * Qué hace : GET    — detalle completo del contenedor con órdenes e ítems.
 *            PUT    — actualizar campos del contenedor.
 *            DELETE — eliminar el contenedor y sus vínculos.
 * No debe  : contener lógica de negocio ni queries Supabase directas.
 */

import { NextResponse } from "next/server";
import { getContainerDetailService } from "@/modules/containers/services/getContainerDetailService";
import { updateContainerService } from "@/modules/containers/services/updateContainerService";
import { deleteContainerWithLinks } from "@/modules/containers/repositories/containerOrdersRepository";
import type { UpdateContainerBody } from "@/modules/containers/types/updateContainer.types";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

type Params = { params: { id: string } };

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(_req: Request, { params }: Params) {
  try {
    const supabase = createSupabaseRouteClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const result = await getContainerDetailService(supabase, params.id);

    if (result.ok === false) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Error inesperado cargando contenedor",
      },
      { status: 500 },
    );
  }
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

export async function PUT(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  let body: UpdateContainerBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const result = await updateContainerService(supabase, params.id, body, user.id);

  if (result.ok === false) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    contenedor: result.contenedor,
    stockActivation: result.stockActivation,
  });
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(_req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const result = await deleteContainerWithLinks(supabase, params.id);

  if (result.ok === false) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
