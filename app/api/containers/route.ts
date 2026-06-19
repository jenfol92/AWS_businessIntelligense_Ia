/**
 * Módulo   : containers
 * Archivo  : app/api/containers/route.ts
 * Qué hace : GET  — lista contenedores con sus órdenes asignadas.
 *            POST — crea un contenedor y lo vincula con las órdenes confirmadas.
 * No debe  : contener lógica de negocio ni queries Supabase directas.
 */

import { NextResponse } from "next/server";
import { createContainerWithOrders } from "@/modules/containers/services/createContainerWithOrders";
import { listContainersService } from "@/modules/containers/services/listContainersService";
import type { CreateContainerFromOrderPayload } from "@/modules/containers/types/createContainer.types";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export async function GET(req: Request) {
  const supabase = createSupabaseRouteClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const estado = new URL(req.url).searchParams.get("estado");

  try {
    const rows = await listContainersService(supabase, estado);
    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Error listando contenedores" },
      { status: 400 },
    );
  }
}

export async function POST(req: Request) {
  const supabase = createSupabaseRouteClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  let body: CreateContainerFromOrderPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body invalido" }, { status: 400 });
  }

  const result = await createContainerWithOrders(supabase, user.id, body);
  if (result.ok === false) {
    return NextResponse.json(
      { ok: false, code: result.code ?? undefined, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, contenedor: result.contenedor }, { status: 201 });
}
